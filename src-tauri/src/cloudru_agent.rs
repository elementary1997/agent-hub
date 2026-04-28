//! Install the bundled Cloud.ru lane (stub provider) as a managed agent,
//! mirroring `openrouter_agent.rs` but defaulting the upstream provider to
//! `cloudru` so users can drop in auth later without renaming files.

use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tauri::AppHandle;
use tauri::Manager;

use crate::npm_util;

const AGENT_ID: &str = "cloudru-agent";
const AGENT_PORT: u16 = 8763;
const AGENT_VERSION: &str = "0.1.0";

const PACKAGE_JSON: &str = r#"{
  "name": "@agent-hub/cloudru-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Cloud.ru AI agent stub for Agent Hub",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
"#;

const SERVER_JS: &str = include_str!("../../examples/cloud-bridge/src/server.js");
const PROVIDER_OPENROUTER: &str = include_str!("../../examples/cloud-bridge/src/providers/openrouter.js");
const PROVIDER_CLOUDRU: &str = include_str!("../../examples/cloud-bridge/src/providers/cloudru.js");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallCloudRuResult {
    pub project_dir: String,
    pub manifest_path: String,
    pub installed: bool,
}

#[tauri::command]
pub async fn install_cloudru_agent(app: AppHandle) -> Result<InstallCloudRuResult, String> {
    install_cloudru_agent_inner(&app).await.map_err(|e| e.to_string())
}

async fn install_cloudru_agent_inner(app: &AppHandle) -> Result<InstallCloudRuResult> {
    let app_data = app
        .path()
        .app_data_dir()
        .context("resolve app_data_dir")?;
    let project_dir = app_data.join("cloudru-agent");
    std::fs::create_dir_all(&project_dir).context("create cloudru-agent dir")?;

    let server_js = patch_server_js(SERVER_JS);
    std::fs::write(project_dir.join("package.json"), PACKAGE_JSON).context("write package.json")?;
    let prov = project_dir.join("providers");
    std::fs::create_dir_all(&prov).context("create providers/")?;
    std::fs::write(prov.join("openrouter.js"), PROVIDER_OPENROUTER)
        .context("write providers/openrouter.js")?;
    std::fs::write(prov.join("cloudru.js"), PROVIDER_CLOUDRU).context("write providers/cloudru.js")?;
    std::fs::write(project_dir.join("server.js"), server_js).context("write server.js")?;

    npm_util::ensure_node_available().await?;
    npm_util::npm_install(&project_dir).await?;

    let manifest_dir = manifest_dir()?;
    std::fs::create_dir_all(&manifest_dir).context("create manifest dir")?;
    let manifest_path = manifest_dir.join(format!("{AGENT_ID}.json"));
    std::fs::write(&manifest_path, build_manifest(&project_dir)?).context("write manifest")?;

    Ok(InstallCloudRuResult {
        project_dir: project_dir.display().to_string(),
        manifest_path: manifest_path.display().to_string(),
        installed: true,
    })
}

fn patch_server_js(src: &str) -> String {
    src.replace(
        "const HUB_PROVIDER_ENUM = [\"openrouter\", \"cloudru\"];",
        "const HUB_PROVIDER_ENUM = [\"cloudru\"];",
    )
    .replace(
        "const AGENT_ID = \"cloud-bridge\";",
        "const AGENT_ID = \"cloudru-agent\";",
    )
    .replace(
        "const PORT = portFromArgs() ?? Number(process.env.CLOUD_BRIDGE_PORT) ?? 8742;",
        &format!(
            "const PORT = portFromArgs() ?? Number(process.env.CLOUD_BRIDGE_PORT) ?? {AGENT_PORT};"
        ),
    )
    .replace(
        "const VERSION = \"0.1.0\";",
        &format!("const VERSION = \"{AGENT_VERSION}\";"),
    )
    .replace("name: \"Cloud Bridge\",", "name: \"Cloud.ru Agent\",")
    .replace(
        "tagline: \"Streams Claude / GPT / Gemini through OpenRouter\",",
        "tagline: \"Cloud.ru models (stub until wired)\",",
    )
    .replace(
        "tags: [\"ai\", \"reference\", \"openrouter\"],",
        "tags: [\"ai\", \"cloud.ru\"],",
    )
    .replace(
        "provider: process.env.CLOUD_BRIDGE_PROVIDER ?? \"openrouter\",",
        "provider: process.env.CLOUD_BRIDGE_PROVIDER ?? \"cloudru\",",
    )
    .replace("auto_start_on_hub_launch: true,", "auto_start_on_hub_launch: false,")
}

fn manifest_dir() -> Result<PathBuf> {
    let base = dirs::config_dir().ok_or_else(|| anyhow!("cannot resolve config dir"))?;
    Ok(base.join("agent-hub").join("agents"))
}

fn build_manifest(project_dir: &PathBuf) -> Result<String> {
    let server = project_dir.join("server.js");
    let payload = serde_json::json!({
        "id": AGENT_ID,
        "name": "Cloud.ru Agent",
        "version": AGENT_VERSION,
        "kind": "ai",
        "endpoint": format!("http://127.0.0.1:{AGENT_PORT}"),
        "lifecycle": "managed",
        "executable": "node",
        "args": [server.display().to_string(), "--port", AGENT_PORT.to_string()],
        "tagline": "Cloud.ru models via hub protocol (provider stub)",
        "tags": ["ai", "cloud.ru"],
        "accent": "#f59e0b",
        "protocol": "0.1",
        "auto_start_on_hub_launch": false,
        "ai": {
            "supports_streaming": true,
            "supports_tools": false,
            "supports_attachments": false,
            "models": ["gigachat-preview"],
            "default_model": "gigachat-preview",
            "system_prompt_editable": true
        }
    });
    serde_json::to_string_pretty(&payload).context("serialize manifest")
}
