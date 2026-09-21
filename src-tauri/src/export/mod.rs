//! Export jobs own temporary files and short-lived render windows. Never touch editor files.
pub mod pandoc;
mod pdf;

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::{Arc, Mutex, mpsc}, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPayload { pub html: String, pub options: PdfOptions, pub title: String, pub font_css: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOptions {
    pub paper: String, pub landscape: bool, pub margin_mm: f64, pub font_pt: f64,
    pub line_height: f64, pub minimum_pt: f64, pub page_numbers: bool,
    pub items: HashMap<String, String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct LayoutIssue { pub id: String, pub message: String, pub blocking: bool }
#[derive(Serialize)]
pub struct PdfReceipt { id: String, issues: Vec<LayoutIssue> }
struct Job {
    owner: String, payload: PdfPayload, directory: tempfile::TempDir,
    completion: Mutex<Option<mpsc::Sender<Result<Vec<LayoutIssue>, String>>>>,
}
impl Job { fn path(&self) -> std::path::PathBuf { self.directory.path().join("document.pdf") } }
#[derive(Default)]
pub struct ExportJobs(Mutex<HashMap<String, Arc<Job>>>);

fn job(app: &AppHandle, id: &str, owner: &str) -> Result<Arc<Job>, String> {
    let jobs = app.state::<ExportJobs>();
    let result = jobs.0.lock().unwrap().get(id).filter(|job| job.owner == owner || owner == format!("nb-export-{id}"))
        .cloned().ok_or_else(|| "导出任务已结束".into());
    result
}
fn finish(job: &Job, result: Result<Vec<LayoutIssue>, String>) {
    if let Some(sender) = job.completion.lock().unwrap().take() { let _ = sender.send(result); }
}
fn remove(app: &AppHandle, id: &str) {
    if let Some(window) = app.get_webview_window(&format!("nb-export-{id}")) { let _ = window.destroy(); }
    if let Some(job) = app.state::<ExportJobs>().0.lock().unwrap().remove(id) { finish(&job, Err("导出已取消".into())); }
}
pub fn release_owner(app: &AppHandle, owner: &str) {
    let ids: Vec<_> = app.state::<ExportJobs>().0.lock().unwrap().iter()
        .filter(|(_, job)| job.owner == owner).map(|(id, _)| id.clone()).collect();
    for id in ids { remove(app, &id); }
}

#[tauri::command]
pub async fn create_pdf(app: AppHandle, window: WebviewWindow, id: String, payload: PdfPayload) -> Result<PdfReceipt, String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "无效的导出任务")?;
    let o = &payload.options;
    if ![o.margin_mm, o.font_pt, o.line_height, o.minimum_pt].iter().all(|v| v.is_finite())
        || !(0.0..=40.0).contains(&o.margin_mm) || !(8.0..=24.0).contains(&o.font_pt)
        || !(6.0..=14.0).contains(&o.minimum_pt) || !(1.0..=2.5).contains(&o.line_height) {
        return Err("排版参数超出范围".into());
    }
    let (tx, rx) = mpsc::channel();
    let job = Arc::new(Job { owner: window.label().into(), payload, directory: tempfile::Builder::new()
        .prefix("noteboard-export-").tempdir().map_err(|e| e.to_string())?, completion: Mutex::new(Some(tx)) });
    {
        let jobs = app.state::<ExportJobs>(); let mut jobs = jobs.0.lock().unwrap();
        if jobs.contains_key(&id) || jobs.values().filter(|j| j.owner == window.label()).count() >= 3 {
            return Err("请等待当前预览完成".into());
        }
        jobs.insert(id.clone(), job.clone());
    }
    let build_app = app.clone(); let label = format!("nb-export-{id}");
    let url = format!("export.html#{id}");
    std::thread::spawn(move || {
        match WebviewWindowBuilder::new(&build_app, label, WebviewUrl::App(url.into()))
            .visible(false).focused(false).skip_taskbar(true).inner_size(1100.0, 900.0).build() {
            Err(error) => finish(&job, Err(error.to_string())),
            Ok(window) => {
                if job.completion.lock().unwrap().is_none() { let _ = window.destroy(); }
            }
        }
    });
    let result = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(300))
        .map_err(|_| "PDF 排版超时".to_string()).and_then(|r| r)).await.map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window(&format!("nb-export-{id}")) { let _ = window.destroy(); }
    match result { Ok(issues) => Ok(PdfReceipt { id, issues }), Err(error) => { remove(&app, &id); Err(error) } }
}
#[tauri::command]
pub fn pdf_payload(app: AppHandle, window: WebviewWindow, id: String) -> Result<PdfPayload, String> {
    Ok(job(&app, &id, window.label())?.payload.clone())
}
#[tauri::command]
pub fn pdf_ready(app: AppHandle, window: WebviewWindow, id: String, issues: Vec<LayoutIssue>, error: Option<String>) -> Result<(), String> {
    if window.label() != format!("nb-export-{id}") { return Err("无效的排版窗口".into()); }
    let job = job(&app, &id, window.label())?;
    if let Some(error) = error { finish(&job, Err(error)); return Ok(()); }
    let for_callback = job.clone();
    pdf::print(&window, &job.path(), &job.payload.options, move |result| {
        finish(&for_callback, result.map(|_| issues));
    })
}
#[tauri::command]
pub fn read_pdf(app: AppHandle, window: WebviewWindow, id: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(job(&app, &id, window.label())?.path()).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
pub fn save_pdf(app: AppHandle, window: WebviewWindow, id: String, path: String) -> Result<(), String> {
    std::fs::copy(job(&app, &id, window.label())?.path(), path).map(|_| ()).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn release_pdf(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    if job(&app, &id, window.label()).is_ok() { remove(&app, &id); } Ok(())
}
