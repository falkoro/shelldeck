use crate::{config::Config, persist};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::fs;

#[derive(Deserialize)]
pub struct ShareShotUpload {
    #[serde(rename = "dataUrl")]
    pub data_url: String,
}

#[derive(Serialize)]
pub struct SavedShareShot {
    pub path: String,
    pub bytes: usize,
}

pub async fn save(config: Arc<Config>, payload: ShareShotUpload) -> Result<SavedShareShot, String> {
    let encoded = payload
        .data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("Safe shot must be a PNG data URL")?;
    if encoded.len() / 4 * 3 > 4 * 1024 * 1024 {
        return Err("Safe shot image is too large".to_string());
    }
    let bytes = STANDARD
        .decode(encoded.trim().replace(char::is_whitespace, ""))
        .map_err(|_| "Invalid safe shot image data")?;
    if bytes.is_empty() {
        return Err("Safe shot image was empty".to_string());
    }
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("Safe shot image is too large".to_string());
    }
    if let Some(parent) = config
        .share_shot_file
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        if let Err(e) = fs::create_dir_all(parent).await {
            if !persist::continue_after_disk_error(parent, "create directory", &e) {
                return Err(e.to_string());
            }
        }
    }
    if let Err(e) = fs::write(&config.share_shot_file, &bytes).await {
        if !persist::continue_after_disk_error(&config.share_shot_file, "write file", &e) {
            return Err(e.to_string());
        }
    }
    Ok(SavedShareShot {
        path: config.share_shot_file.to_string_lossy().to_string(),
        bytes: bytes.len(),
    })
}
