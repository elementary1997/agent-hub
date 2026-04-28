//! Cross-platform helpers for running Node/npm from Tauri child processes.
//!
//! Windows note: `npm` is usually `npm.cmd` and must be invoked via
//! `cmd.exe /C npm …` so `CreateProcess` can find it from PATH.

use std::path::Path;

use anyhow::{anyhow, Context, Result};
use tokio::process::Command;

pub async fn ensure_node_available() -> Result<()> {
    let ok = try_command("node", &["--version"]).await.is_ok();
    if ok {
        return Ok(());
    }
    Err(anyhow!(
        "Node.js не найден в PATH. Установите Node.js 20+ (https://nodejs.org/) и перезапустите Agent Hub."
    ))
}

pub async fn npm_install(project_dir: &Path) -> Result<()> {
    let mut cmd = npm_command();
    cmd.current_dir(project_dir);

    let output = cmd
        .output()
        .await
        .context("не удалось запустить npm install")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(anyhow!(
            "npm install завершился с ошибкой ({}).\n{}\n{}",
            output.status,
            stderr.trim(),
            stdout.trim()
        ));
    }
    Ok(())
}

fn npm_command() -> Command {
    #[cfg(windows)]
    {
        let mut c = Command::new("cmd");
        c.args([
            "/C",
            "npm",
            "install",
            "--no-audit",
            "--no-fund",
            "--omit=dev",
        ]);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("npm");
        c.args(["install", "--no-audit", "--no-fund", "--omit=dev"]);
        c
    }
}

async fn try_command(program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .with_context(|| format!("spawn {program}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("{program} exited with {status}"))
    }
}
