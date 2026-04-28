//! Download the latest easySTT release asset and launch the native installer.
//!
//! GitHub: `elementary1997/easySTT` (same org as the hub). The API returns
//! the newest non-draft release; we pick a platform-appropriate asset.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Manager;

const REPO: &str = "elementary1997/easySTT";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EasysttInstallResult {
    pub downloaded_path: String,
    pub asset_name: String,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[tauri::command]
pub async fn install_easystt_latest(app: AppHandle) -> Result<EasysttInstallResult, String> {
    install_easystt_latest_inner(&app)
        .await
        .map_err(|e| e.to_string())
}

async fn install_easystt_latest_inner(app: &AppHandle) -> Result<EasysttInstallResult> {
    let client = reqwest::Client::builder()
        .user_agent("agent-hub/1.0 (easystt-installer)")
        .build()
        .context("reqwest client")?;

    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let rel: GhRelease = client
        .get(&url)
        .send()
        .await
        .context("GitHub releases/latest")?
        .error_for_status()
        .context("GitHub HTTP error")?
        .json()
        .await
        .context("parse GitHub JSON")?;

    let asset = pick_asset(&rel.assets).ok_or_else(|| {
        anyhow!(
            "Не нашёл подходящего файла в релизе {}. Откройте страницу релизов и установите вручную.",
            rel.tag_name
        )
    })?;

    let base_dir = app.path().app_data_dir().context("app_data_dir")?;
    let dl_dir = base_dir.join("easySTT-install");
    std::fs::create_dir_all(&dl_dir).context("mkdir easySTT-install")?;

    let dest = dl_dir.join(&asset.name);

    let bytes = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .context("download asset")?
        .error_for_status()
        .context("download HTTP error")?
        .bytes()
        .await
        .context("read body")?;

    tokio::fs::write(&dest, &bytes)
        .await
        .context("write installer")?;

    open::that(&dest).context("open installer")?;

    Ok(EasysttInstallResult {
        downloaded_path: dest.display().to_string(),
        asset_name: asset.name.clone(),
    })
}

fn pick_asset(assets: &[GhAsset]) -> Option<&GhAsset> {
    if assets.is_empty() {
        return None;
    }

    let lower: Vec<(String, &GhAsset)> = assets
        .iter()
        .map(|a| (a.name.to_lowercase(), a))
        .collect();

    #[cfg(target_os = "windows")]
    {
        if let Some(a) = lower.iter().find(|(n, _)| n.ends_with(".msi")) {
            return Some(a.1);
        }
        if let Some(a) = lower.iter().find(|(n, _)| n.ends_with(".exe")) {
            return Some(a.1);
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(a) = lower.iter().find(|(n, _)| n.ends_with(".deb")) {
            return Some(a.1);
        }
        if let Some(a) = lower
            .iter()
            .find(|(n, _)| n.ends_with(".appimage") || n.contains("appimage"))
        {
            return Some(a.1);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(a) = lower.iter().find(|(n, _)| n.ends_with(".dmg")) {
            return Some(a.1);
        }
    }

    // Fallback: first browser-downloadable asset
    Some(assets.first()?)
}
