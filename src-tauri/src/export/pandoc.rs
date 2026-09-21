use std::{io::Write, process::{Command, Stdio}};
use serde::Serialize;

fn command(path: &str) -> Command {
    let mut cmd = Command::new(if path.trim().is_empty() { "pandoc" } else { path.trim() });
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
    cmd
}
#[derive(Serialize)]
pub struct PandocStatus { available: bool, version: String }
#[tauri::command]
pub async fn pandoc_status(path: String) -> Result<PandocStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        match command(&path).arg("--version").output() {
            Ok(output) if output.status.success() => Ok(PandocStatus { available: true,
                version: String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or("Pandoc").into() }),
            _ => Ok(PandocStatus { available: false, version: String::new() }),
        }
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn pandoc_export(path: String, format: String, source: String, directory: String, destination: String) -> Result<String, String> {
    if !["docx", "html5", "latex"].contains(&format.as_str()) { return Err("不支持的导出格式".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let template = command(&path).args(["--from=markdown", "--to=json"]).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        if !template.status.success() { return Err("无法读取 Pandoc 格式版本".into()); }
        let template: serde_json::Value = serde_json::from_slice(&template.stdout).map_err(|e| e.to_string())?;
        let mut document: serde_json::Value = serde_json::from_str(&source).map_err(|e| e.to_string())?;
        document["pandoc-api-version"] = template["pandoc-api-version"].clone();
        let input = serde_json::to_vec(&document).map_err(|e| e.to_string())?;
        let mut cmd = command(&path);
        cmd.args(["--from=json", "--standalone", "--wrap=none", "--to", &format, "--output", &destination]);
        if !directory.is_empty() { cmd.arg("--resource-path").arg(&directory).current_dir(directory); }
        if format == "html5" { cmd.args(["--embed-resources", "--mathml"]); }
        let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
        child.stdin.take().ok_or("Pandoc 输入不可用")?.write_all(&input).map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        let messages = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.success() { Ok(messages) } else { Err(messages) }
    }).await.map_err(|e| e.to_string())?
}
