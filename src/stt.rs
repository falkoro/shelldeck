use crate::config::Config;
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{fs, process::Command, time::timeout};

#[derive(Deserialize)]
pub struct TranscribeRequest {
    // base64 data URL produced by the browser (e.g. "data:audio/webm;codecs=opus;base64,...").
    #[serde(rename = "dataUrl")]
    pub data_url: String,
}

#[derive(Serialize)]
pub struct Transcript {
    pub text: String,
}

pub async fn transcribe(config: Arc<Config>, payload: TranscribeRequest) -> Result<Transcript, String> {
    let model = config
        .stt_model
        .as_ref()
        .ok_or("Speech-to-text is not configured on this ShellDeck. Set DASHBOARD_STT_MODEL to a whisper.cpp model.")?;
    let text = decode_and_transcribe(
        &config.ffmpeg_cmd,
        &config.stt_cmd,
        model,
        &config.stt_language,
        config.max_audio_bytes,
        &payload.data_url,
    )
    .await?;
    Ok(Transcript { text })
}

// Config-free core: decode a base64 audio data URL, transcode to 16 kHz wav, run whisper.cpp,
// and return the cleaned transcript. Kept separate from `Config` so it can be tested directly.
pub(crate) async fn decode_and_transcribe(
    ffmpeg_cmd: &str,
    stt_cmd: &str,
    model: &std::path::Path,
    language: &str,
    max_audio_bytes: usize,
    data_url: &str,
) -> Result<String, String> {
    if !model.exists() {
        return Err(format!("Whisper model not found at {}", model.display()));
    }

    // Reject oversized uploads on the ENCODED length before decoding (base64 is ~4/3 of raw),
    // so we never allocate a huge buffer just to discover it's over the cap.
    let (_, encoded) = data_url
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(";base64,"))
        .ok_or("Audio must be a base64 data URL")?;
    if encoded.len() / 4 * 3 > max_audio_bytes {
        return Err(format!(
            "Recording is too long. Limit is {} MB",
            max_audio_bytes / 1024 / 1024
        ));
    }
    let bytes = STANDARD
        .decode(encoded.replace(char::is_whitespace, ""))
        .map_err(|_| "Invalid audio data")?;
    if bytes.is_empty() {
        return Err("Recording was empty".to_string());
    }

    let work = TempDir::new()?;
    let input = work.path.join("in");
    let wav = work.path.join("audio.wav");
    fs::write(&input, &bytes).await.map_err(|e| e.to_string())?;

    // ffmpeg decodes whatever container the browser produced (webm/opus, ogg, mp4) into the
    // 16 kHz mono 16-bit PCM wav that whisper.cpp expects.
    run(
        ffmpeg_cmd,
        &[
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            &input.to_string_lossy(),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            &wav.to_string_lossy(),
        ],
        "Could not decode the recorded audio",
    )
    .await?;

    // whisper.cpp: -nt drops timestamps, -np suppresses everything but the transcript on stdout.
    let stdout = run(
        stt_cmd,
        &[
            "-m",
            &model.to_string_lossy(),
            "-f",
            &wav.to_string_lossy(),
            "-l",
            language,
            "-nt",
            "-np",
        ],
        "Speech-to-text failed. Check that whisper-cli is installed.",
    )
    .await?;

    Ok(clean_transcript(&stdout))
}

fn clean_transcript(raw: &str) -> String {
    // Whisper marks non-speech (silence, noise, music) with bracketed/parenthesized annotations
    // like "[BLANK_AUDIO]", "(silence)", "(electronic beeping)", "(dramatic music)". Strip every
    // BALANCED () and [] run (these are always balanced) so they never land in the input — but
    // leave an unbalanced opener alone so a stray "(" can't swallow the rest of a real sentence.
    let stripped = strip_balanced(&strip_balanced(raw, '[', ']'), '(', ')');
    // Drop lone musical-note / asterisk glyphs and collapse whitespace runs to single spaces.
    stripped
        .split_whitespace()
        .filter(|tok| *tok != "♪" && *tok != "*")
        .collect::<Vec<_>>()
        .join(" ")
}

// Remove every `open`..`close` run that has a matching close; keep an unmatched `open` verbatim.
fn strip_balanced(s: &str, open: char, close: char) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == open {
            if let Some(rel) = chars[i + 1..].iter().position(|&c| c == close) {
                out.push(' ');
                i += rel + 2; // skip past the matching close
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

async fn run(cmd: &str, args: &[&str], friendly: &str) -> Result<String, String> {
    // kill_on_drop so a timed-out ffmpeg/whisper is reaped instead of left running detached.
    let output = timeout(
        Duration::from_secs(120),
        Command::new(cmd).args(args).kill_on_drop(true).output(),
    )
    .await
        .map_err(|_| format!("{friendly} (timed out)"))?
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => format!("{friendly} (`{cmd}` not found on PATH)"),
            _ => format!("{friendly} ({e})"),
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.lines().rev().take(3).collect::<Vec<_>>().join("; ");
        return Err(format!("{friendly}: {tail}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

// Self-cleaning temp directory: removes itself (and the audio files inside) on drop, so a
// recording never lingers on disk after the request that transcribed it.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Result<Self, String> {
        let mut rnd = [0u8; 12];
        OsRng.fill_bytes(&mut rnd);
        let name = format!("shelldeck-stt-{}", hex(&rnd));
        let path = std::env::temp_dir().join(name);
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        Ok(Self { path })
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_transcript_collapses_whitespace_and_strips_non_speech() {
        assert_eq!(clean_transcript("  hello   world \n"), "hello world");
        assert_eq!(clean_transcript("[BLANK_AUDIO]"), "");
        assert_eq!(clean_transcript(" [ Silence ] really  there "), "really there");
        // parenthesized non-speech annotations (the real-world failure) are stripped,
        // including multi-word ones
        assert_eq!(clean_transcript("(dramatic music)"), "");
        assert_eq!(clean_transcript("(electronic beeping)"), "");
        assert_eq!(clean_transcript("run the (silence) build now"), "run the build now");
        // an UNBALANCED opener must not swallow the rest of a real sentence
        assert_eq!(clean_transcript("build the (oops never closed"), "build the (oops never closed");
    }

    #[tokio::test]
    async fn rejects_non_data_url() {
        let err = decode_and_transcribe("ffmpeg", "whisper-cli", std::path::Path::new("/dev/null"), "en", 1024, "not-a-data-url")
            .await
            .unwrap_err();
        assert!(err.contains("data URL"), "got: {err}");
    }

    // Real end-to-end pipeline (ffmpeg -> whisper.cpp). Opt-in: set SHELLDECK_TEST_WAV to a speech
    // clip and SHELLDECK_TEST_MODEL to a whisper.cpp model. Skips when those are absent so CI passes.
    #[tokio::test]
    async fn transcribes_sample_when_assets_present() {
        let (Ok(wav), Ok(model)) = (
            std::env::var("SHELLDECK_TEST_WAV"),
            std::env::var("SHELLDECK_TEST_MODEL"),
        ) else {
            eprintln!("skip: set SHELLDECK_TEST_WAV + SHELLDECK_TEST_MODEL to run the live STT test");
            return;
        };
        let bytes = std::fs::read(&wav).expect("read test wav");
        let data_url = format!("data:audio/wav;base64,{}", STANDARD.encode(&bytes));
        let text = decode_and_transcribe(
            "ffmpeg",
            "whisper-cli",
            std::path::Path::new(&model),
            "en",
            25 * 1024 * 1024,
            &data_url,
        )
        .await
        .expect("transcribe");
        assert!(
            text.to_lowercase().contains("country"),
            "unexpected transcript: {text}"
        );
    }
}
