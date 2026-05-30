use crate::{config::Config, webutil};
use axum::http::StatusCode;
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::fs;

#[derive(Deserialize)]
pub struct ImageUpload {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub mime_type: Option<String>,
    #[serde(rename = "dataUrl")]
    pub data_url: String,
}

#[derive(Serialize)]
pub struct SavedImage {
    pub name: String,
    pub path: String,
    pub bytes: usize,
    #[serde(rename = "type")]
    pub mime_type: String,
    pub url: String,
}

pub async fn save_image(config: Arc<Config>, payload: ImageUpload) -> Result<SavedImage, String> {
    fs::create_dir_all(&config.upload_dir)
        .await
        .map_err(|e| e.to_string())?;
    let (mime_type, encoded) = payload
        .data_url
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(";base64,"))
        .ok_or("Image upload must be a base64 data URL")?;
    let declared = payload
        .mime_type
        .unwrap_or_else(|| mime_type.to_string())
        .to_lowercase();
    let ext = config
        .image_types
        .get(&declared)
        .ok_or("Supported image types are PNG, JPEG, WebP, and GIF")?;
    // Reject oversized uploads on the ENCODED length before decoding, so we never
    // allocate a huge buffer just to discover it's over the cap. base64 is ~4/3 of raw.
    if encoded.len() / 4 * 3 > config.max_image_bytes {
        return Err(format!(
            "Image is too large. Limit is {} MB",
            config.max_image_bytes / 1024 / 1024
        ));
    }
    let bytes = STANDARD
        .decode(encoded.trim().replace(char::is_whitespace, ""))
        .map_err(|_| "Invalid image data")?;
    if bytes.is_empty() {
        return Err("Image upload was empty".to_string());
    }
    if bytes.len() > config.max_image_bytes {
        return Err(format!(
            "Image is too large. Limit is {} MB",
            config.max_image_bytes / 1024 / 1024
        ));
    }
    let file_name = format!(
        "{}-{}-{}{}",
        chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S"),
        nonce(),
        stem(payload.name),
        ext
    );
    let full_path = config.upload_dir.join(&file_name);
    fs::write(&full_path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SavedImage {
        name: file_name.clone(),
        path: full_path.to_string_lossy().to_string(),
        bytes: bytes.len(),
        mime_type: declared,
        url: format!("/uploads/{}", urlencoding::encode(&file_name)),
    })
}

pub async fn load_image(
    config: Arc<Config>,
    file_name: &str,
) -> Result<(&'static str, Vec<u8>), axum::response::Response> {
    let safe_name = Path::new(file_name)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or_default();
    if !safe_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(webutil::json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({ "error": "Not found" }),
        ));
    }
    let content_type = match Path::new(safe_name)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => {
            return Err(webutil::json_response(
                StatusCode::NOT_FOUND,
                &serde_json::json!({ "error": "Not found" }),
            ));
        }
    };
    let path = safe_upload_path(&config.upload_dir, safe_name).ok_or_else(|| {
        webutil::json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({ "error": "Not found" }),
        )
    })?;
    let bytes = fs::read(path).await.map_err(|_| {
        webutil::json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({ "error": "Not found" }),
        )
    })?;
    Ok((content_type, bytes))
}

fn stem(name: Option<String>) -> String {
    let raw = name.unwrap_or_else(|| "pasted-image".to_string());
    let value = Path::new(&raw)
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("pasted-image");
    let cleaned: String = value
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    cleaned
        .trim_matches('-')
        .chars()
        .take(48)
        .collect::<String>()
        .if_empty("pasted-image")
}

fn nonce() -> String {
    let mut bytes = [0_u8; 5];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn safe_upload_path(base: &Path, file_name: &str) -> Option<PathBuf> {
    let path = base.join(file_name);
    path.starts_with(base).then_some(path)
}

trait EmptyFallback {
    fn if_empty(self, fallback: &str) -> String;
}

impl EmptyFallback for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}
