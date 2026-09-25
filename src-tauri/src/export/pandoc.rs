use std::{collections::HashMap, io::{Read, Write}, path::{Path, PathBuf}, process::{Child, Command, Output, Stdio},
    sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

struct PandocJob { owner: String, cancelled: AtomicBool, started: AtomicBool, child: Mutex<Option<Child>> }
#[derive(Default)]
pub struct PandocJobs(Mutex<HashMap<String, Arc<PandocJob>>>);
impl PandocJob {
    fn check(&self) -> Result<(), String> { if self.cancelled.load(Ordering::Acquire) { Err("导出已取消".into()) } else { Ok(()) } }
    fn cancel(&self) {
        let mut child = self.child.lock().unwrap();
        self.cancelled.store(true, Ordering::Release);
        if let Some(child) = child.as_mut() { let _ = child.kill(); }
    }
}
fn lookup(app: &AppHandle, id: &str, owner: &str) -> Result<Arc<PandocJob>, String> {
    app.state::<PandocJobs>().0.lock().unwrap().get(id).filter(|job| job.owner == owner).cloned().ok_or_else(|| "导出任务已结束".into())
}
#[tauri::command]
pub fn begin_pandoc(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "无效的导出任务")?;
    let state = app.state::<PandocJobs>(); let mut jobs = state.0.lock().unwrap();
    if jobs.contains_key(&id) || jobs.len() >= 4 || jobs.values().any(|job| job.owner == window.label()) { return Err("请等待当前导出结束".into()); }
    jobs.insert(id, Arc::new(PandocJob { owner: window.label().into(), cancelled: AtomicBool::new(false), started: AtomicBool::new(false), child: Mutex::new(None) }));
    Ok(())
}
#[tauri::command]
pub fn cancel_pandoc(app: AppHandle, window: WebviewWindow, id: String) {
    if let Ok(job) = lookup(&app, &id, window.label()) {
        job.cancel();
        if !job.started.load(Ordering::Acquire) { app.state::<PandocJobs>().0.lock().unwrap().remove(&id); }
    }
}
pub fn release_owner(app: &AppHandle, owner: &str) {
    let state = app.state::<PandocJobs>(); let mut jobs = state.0.lock().unwrap();
    jobs.retain(|_, job| {
        if job.owner != owner { return true; }
        job.cancel(); job.started.load(Ordering::Acquire)
    });
}

// Always drain child pipes, but bound retained warning/version output. The child
// remains accessible to cancellation while the waiter polls and reaps it.
fn drain(mut reader: impl Read) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new(); let mut buffer = [0; 8192];
    loop { let read = reader.read(&mut buffer)?; if read == 0 { return Ok(bytes); }
        let keep = read.min((1024 * 1024_usize).saturating_sub(bytes.len())); bytes.extend_from_slice(&buffer[..keep]); }
}
fn run(job: &PandocJob, cmd: &mut Command, input: Vec<u8>, timeout: Duration) -> Result<Output, String> {
    let (mut stdin, stdout, stderr) = {
        let mut slot = job.child.lock().unwrap(); job.check()?;
        let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("无法运行 Pandoc，请在「设置 → 导出」选择程序：{e}"))?;
        let pipes = (child.stdin.take().unwrap(), child.stdout.take().unwrap(), child.stderr.take().unwrap());
        *slot = Some(child); pipes
    };
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let out = std::thread::spawn(move || drain(stdout));
    let err = std::thread::spawn(move || drain(stderr));
    let started = Instant::now();
    let status = loop {
        let mut slot = job.child.lock().unwrap();
        let child = slot.as_mut().ok_or("Pandoc 进程已结束")?;
        if started.elapsed() > timeout { job.cancelled.store(true, Ordering::Release); let _ = child.kill(); }
        match child.try_wait() {
            Ok(Some(status)) => { *slot = None; break Ok(status); }
            Ok(None) => {},
            Err(error) => { let _ = child.kill(); let _ = child.wait(); *slot = None; break Err(error.to_string()); }
        }
        drop(slot); std::thread::sleep(Duration::from_millis(20));
    };
    let written = writer.join().map_err(|_| "Pandoc 输入失败")?;
    let stdout = out.join().map_err(|_| "Pandoc 输出失败")?.map_err(|e| e.to_string())?;
    let stderr = err.join().map_err(|_| "Pandoc 输出失败")?.map_err(|e| e.to_string())?;
    job.check()?;
    let status = status?;
    if status.success() { written.map_err(|e| e.to_string())?; }
    Ok(Output { status, stdout, stderr })
}

fn command(path: &str) -> Command {
    let mut cmd = Command::new(resolve_program(path));
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
    cmd
}

// Detection and conversion must resolve the same executable. A configured path
// is authoritative; otherwise check PATH and standard Windows installer locations.
fn resolve_program(configured: &str) -> PathBuf {
    if !configured.trim().is_empty() { return PathBuf::from(configured.trim()); }
    let name = if cfg!(windows) { "pandoc.exe" } else { "pandoc" };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(name);
            if candidate.is_file() { return candidate; }
        }
    }
    for variable in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(dir) = std::env::var_os(variable) {
            let candidate = PathBuf::from(dir).join("Pandoc").join(name);
            if candidate.is_file() { return candidate; }
        }
    }
    PathBuf::from(name)
}

fn check_api_version(version: &serde_json::Value) -> Result<(), String> {
    let parts = version.as_array().ok_or("无法读取 Pandoc 格式版本")?;
    let major = parts.first().and_then(|value| value.as_u64()).unwrap_or(0);
    let minor = parts.get(1).and_then(|value| value.as_u64()).unwrap_or(0);
    // The source uses the modern Table/Cell representation, introduced in 1.22.
    if major != 1 || minor < 22 { return Err("请使用 Pandoc 3.0 或更新版本导出文档。".into()); }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocStatus { available: bool, version: String, resolved_path: Option<String> }
#[tauri::command]
pub async fn pandoc_status(path: String) -> Result<PandocStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let job = PandocJob { owner: String::new(), cancelled: AtomicBool::new(false), started: AtomicBool::new(true), child: Mutex::new(None) };
        let mut cmd = command(&path);
        let resolved_path = cmd.get_program().to_string_lossy().into_owned();
        match run(&job, cmd.arg("--version"), Vec::new(), Duration::from_secs(10)) {
            Ok(output) if output.status.success() => Ok(PandocStatus { available: true,
                version: String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or("Pandoc").into(), resolved_path: Some(resolved_path) }),
            _ => Ok(PandocStatus { available: false, version: String::new(), resolved_path: None }),
        }
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn pandoc_export(app: AppHandle, window: WebviewWindow, id: String, path: String, format: String, source: String, directory: String, destination: String) -> Result<String, String> {
    if !["docx", "html5", "latex"].contains(&format.as_str()) { return Err("不支持的导出格式".into()); }
    let job = lookup(&app, &id, window.label())?; job.check()?;
    if job.started.swap(true, Ordering::AcqRel) { return Err("导出已开始".into()); }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let template = run(&job, command(&path).args(["--from=markdown", "--to=json"]), Vec::new(), Duration::from_secs(10))?;
        if !template.status.success() { return Err("无法读取 Pandoc 格式版本".into()); }
        let template: serde_json::Value = serde_json::from_slice(&template.stdout).map_err(|e| e.to_string())?;
        check_api_version(&template["pandoc-api-version"])?;
        let mut document: serde_json::Value = serde_json::from_str(&source).map_err(|e| e.to_string())?;
        document["pandoc-api-version"] = template["pandoc-api-version"].clone();
        let adapter = if ["docx", "latex"].contains(&format.as_str()) {
            document["meta"]["noteboard-target"] = serde_json::json!({"t":"MetaString", "c":format});
            let mut file = tempfile::Builder::new().prefix("noteboard-pandoc-").suffix(".lua").tempfile().map_err(|e| e.to_string())?;
            file.write_all(include_bytes!("pandoc-targets.lua")).map_err(|e| e.to_string())?;
            file.flush().map_err(|e| e.to_string())?;
            Some(file)
        } else { None };
        let input = serde_json::to_vec(&document).map_err(|e| e.to_string())?;
        job.check()?;
        let destination = Path::new(&destination);
        let output = super::output::create(destination)?;
        let mut cmd = command(&path);
        cmd.args(["--from=json", "--standalone", "--wrap=none", "--to"]);
        if let Some(adapter) = &adapter { cmd.arg(adapter.path()); } else { cmd.arg(&format); }
        cmd.arg("--output").arg(output.path());
        if !directory.is_empty() { cmd.arg("--resource-path").arg(&directory).current_dir(directory); }
        if format == "html5" {
            let title = destination.file_stem().unwrap_or_default().to_string_lossy();
            cmd.args(["--embed-resources", "--mathml", "--metadata"]).arg(format!("pagetitle:{title}"));
        }
        let result = run(&job, &mut cmd, input, Duration::from_secs(1800))?;
        let messages = String::from_utf8_lossy(&result.stderr).trim().to_string();
        if !result.status.success() { return Err(messages); }
        // Cancellation and the final atomic replacement share a lock. A failed
        // or cancelled converter never truncates an existing destination.
        let _guard = job.child.lock().unwrap(); job.check()?;
        super::output::publish(output, destination)?;
        Ok(messages)
    }).await.map_err(|e| e.to_string());
    app.state::<PandocJobs>().0.lock().unwrap().remove(&id);
    result?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_the_modern_table_api_instead_of_relabeling_legacy_ast() {
        assert!(check_api_version(&serde_json::json!([1, 23, 1])).is_ok());
        assert!(check_api_version(&serde_json::json!([1, 22, 2, 1])).is_ok());
        assert!(check_api_version(&serde_json::json!([1, 21])).is_err());
        assert!(check_api_version(&serde_json::json!([2, 0])).is_err());
    }
}
