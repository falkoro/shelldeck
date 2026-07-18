"use strict";
// frontend/actions-dictation.ts
function browserMicHelp() {
    if (/Edg\//.test(navigator.userAgent)) {
        return 'In Edge, open the lock icon, set Microphone to Allow for this site, then reload ShellDeck.';
    }
    return 'Allow Microphone for this site in the browser address bar, then try Mic again.';
}
// Map a getUserMedia/MediaRecorder DOMException (or our own thrown Error) to a plain-language hint.
function micErrorMessage(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || error || '');
    if (name === 'NotAllowedError' || /not.?allowed|permission|denied/i.test(message)) {
        return `Microphone is blocked. ${browserMicHelp()}`;
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || /no .*(microphone|device|audio)/i.test(message)) {
        return 'No microphone was found. Check your input device, then try Mic again.';
    }
    if (name === 'NotReadableError') {
        return 'The microphone is in use by another app. Close it, then try Mic again.';
    }
    if (name === 'SecurityError' || /secure|https/i.test(message)) {
        return 'Microphone dictation needs HTTPS or localhost. Open ShellDeck over HTTPS or 127.0.0.1.';
    }
    return message || 'Dictation failed. Check microphone permissions for this site and try again.';
}
function reportDictationError(name, error) {
    const message = micErrorMessage(error);
    setShellStatus(name, message);
    toast(message);
}
function appendDictationText(base, transcript) {
    const clean = transcript.trim().replace(/\s+/g, ' ');
    if (!clean)
        return base;
    return `${base}${base && !/\s$/.test(base) ? ' ' : ''}${clean}`;
}
function setDictationState(name, listening) {
    document.querySelectorAll('[data-dictate-shell]').forEach((button) => {
        const active = listening && button.dataset.dictateShell === name;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.setAttribute('aria-label', active ? 'Stop recording and transcribe' : 'Mic dictation');
        button.title = active
            ? 'Stop recording and transcribe into this input'
            : 'Record your voice; click again to stop and transcribe into this input';
        const label = button.querySelector('.mic-label');
        if (label)
            label.textContent = active ? 'Stop' : 'Mic';
    });
}
function mediaDictationSupported() {
    const media = navigator.mediaDevices;
    return !!(media && typeof media.getUserMedia === 'function' && typeof window.MediaRecorder !== 'undefined');
}
function pickRecorderMime() {
    const MR = window.MediaRecorder;
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    if (MR?.isTypeSupported) {
        for (const type of candidates) {
            if (MR.isTypeSupported(type))
                return type;
        }
    }
    return undefined;
}
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read the recording'));
        reader.readAsDataURL(blob);
    });
}
// Discard any in-progress recording WITHOUT transcribing (used when switching shells or sending).
function stopDictation() {
    const current = activeDictation;
    activeDictation = null;
    if (!current)
        return;
    current.stopMonitor?.();
    setDictationState(current.name, false);
    try {
        if (current.recorder.state !== 'inactive')
            current.recorder.stop();
    }
    catch { }
    current.stream.getTracks().forEach((track) => track.stop());
}
// Stop the recorder and resolve with the combined audio Blob once the final chunk has landed.
function finalizeRecording(recorder, chunks) {
    return new Promise((resolve) => {
        const done = () => {
            if (!chunks.length) {
                resolve(null);
                return;
            }
            resolve(new Blob(chunks, { type: chunks[0].type || recorder.mimeType || 'audio/webm' }));
        };
        recorder.addEventListener('stop', done, { once: true });
        if (recorder.state !== 'inactive')
            recorder.stop();
        else
            done();
    });
}
async function transcribeAndInsert(name, recorder, stream, chunks) {
    setShellStatus(name, 'Transcribing…');
    let blob = null;
    try {
        blob = await finalizeRecording(recorder, chunks);
    }
    finally {
        stream.getTracks().forEach((track) => track.stop());
    }
    if (!blob || !blob.size) {
        setShellStatus(name, 'No audio captured. Try Mic again.');
        return;
    }
    try {
        const dataUrl = await blobToDataUrl(blob);
        const payload = await postJson('/api/transcribe', { dataUrl });
        const text = String(payload.text || '').trim();
        if (!text) {
            setShellStatus(name, 'No speech detected. Speak closer to the mic and try again.');
            return;
        }
        const input = inputFor(name);
        if (input) {
            input.value = appendDictationText(input.value, text);
            input.focus();
            updateUnlockState();
        }
        setShellStatus(name, 'Dictation added to the input.');
    }
    catch (error) {
        reportDictationError(name, error);
    }
}
// Stop the active recording and transcribe it — shared by the manual second click and auto-stop.
async function finishActiveDictation() {
    const current = activeDictation;
    if (!current)
        return;
    activeDictation = null;
    current.stopMonitor?.();
    setDictationState(current.name, false);
    await transcribeAndInsert(current.name, current.recorder, current.stream, current.chunks);
}
// Watch the mic level and auto-finish once the speaker goes quiet, so dictation is a single click:
// click → speak → pause → text drops in. Returns a teardown fn. Degrades gracefully — the manual
// Mic-to-stop click always works, and on browsers without Web Audio this is a no-op.
function monitorSilence(stream, onDone) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC)
        return () => { };
    let ctx;
    try {
        ctx = new AC();
    }
    catch {
        return () => { };
    }
    ctx.resume?.();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const SPEECH_RMS = 0.02; // RMS above this counts as speech
    const SILENCE_MS = 1200; // auto-stop after this much quiet, once speech was heard
    const NO_SPEECH_MS = 8000; // give up if nothing is ever said
    const MAX_MS = 30000; // hard safety cap on a single take
    const startedAt = Date.now();
    let lastLoud = startedAt;
    let heardSpeech = false;
    let stopped = false;
    let timer;
    const cleanup = () => {
        if (stopped)
            return;
        stopped = true;
        clearInterval(timer);
        try {
            source.disconnect();
        }
        catch { }
        try {
            ctx.close();
        }
        catch { }
    };
    timer = setInterval(() => {
        if (stopped)
            return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > SPEECH_RMS) {
            lastLoud = now;
            if (now - startedAt > 200)
                heardSpeech = true;
        }
        const elapsed = now - startedAt;
        if ((heardSpeech && now - lastLoud > SILENCE_MS) || elapsed > MAX_MS || (!heardSpeech && elapsed > NO_SPEECH_MS)) {
            cleanup();
            onDone();
        }
    }, 120);
    return cleanup;
}
async function toggleDictation(name) {
    if (!targetReady(name))
        throw new Error('Choose a running unlocked shell');
    // Second click on the recording shell: stop and transcribe what was captured.
    if (activeDictation?.name === name) {
        await finishActiveDictation();
        return;
    }
    stopDictation();
    if (!mediaDictationSupported()) {
        throw new Error('This browser cannot record audio for dictation. Update your browser and try again.');
    }
    if (!window.isSecureContext) {
        throw new Error('Microphone dictation needs HTTPS or localhost. Open ShellDeck over HTTPS or 127.0.0.1.');
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    catch (error) {
        throw new Error(micErrorMessage(error));
    }
    const mime = pickRecorderMime();
    let recorder;
    try {
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    }
    catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(micErrorMessage(error));
    }
    const chunks = [];
    recorder.ondataavailable = (event) => {
        if (event.data && event.data.size)
            chunks.push(event.data);
    };
    recorder.onerror = (event) => {
        if (activeDictation?.recorder !== recorder)
            return;
        reportDictationError(name, event?.error || new Error('Recording failed'));
        stopDictation();
    };
    activeDictation = { name, recorder, stream, chunks };
    recorder.start();
    setDictationState(name, true);
    setShellStatus(name, "Recording — pause when you're done, or click Mic to stop.");
    // Auto-finish on a natural pause so it's one click; the manual stop click still works.
    activeDictation.stopMonitor = monitorSilence(stream, () => { void finishActiveDictation(); });
}
