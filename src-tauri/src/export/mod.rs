//! One export session owns a render window and immutable document. Revisions
//! change layout options; old PDFs stay readable while their replacement loads.
pub mod pandoc;
mod pdf;
mod pdf_document;
mod output;

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::{Read, Seek, SeekFrom}, sync::{Arc, Mutex, mpsc, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPayload { pub html: String, pub options: PdfOptions, pub title: String, pub font_css: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "RawPdfOptions")]
pub struct PdfOptions {
    pub paper: String, pub landscape: bool, pub margin_mm: f64,
    pub horizontal_margin_mm: f64,
    pub font_pt: f64, pub line_height: f64,
    pub paragraph_spacing_em: f64,
    pub page_numbers: bool,
    pub page_number_position: String, pub page_number_style: String,
    pub items: HashMap<String, String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPdfOptions {
    paper: String, landscape: bool, margin_mm: f64,
    #[serde(default)] horizontal_margin_mm: Option<f64>,
    font_pt: f64, line_height: f64,
    #[serde(default = "default_paragraph_spacing")] paragraph_spacing_em: f64,
    page_numbers: bool,
    #[serde(default = "default_position")] page_number_position: String,
    #[serde(default = "default_number_style")] page_number_style: String,
    items: HashMap<String, String>,
}
impl From<RawPdfOptions> for PdfOptions {
    fn from(raw: RawPdfOptions) -> Self {
        Self { paper: raw.paper, landscape: raw.landscape, margin_mm: raw.margin_mm,
            horizontal_margin_mm: raw.horizontal_margin_mm.unwrap_or(raw.margin_mm),
            font_pt: raw.font_pt, line_height: raw.line_height,
            paragraph_spacing_em: raw.paragraph_spacing_em, page_numbers: raw.page_numbers,
            page_number_position: raw.page_number_position, page_number_style: raw.page_number_style,
            items: raw.items }
    }
}
impl PdfOptions {
    fn vertical_margins_mm(&self) -> (f64, f64) {
        let top = if self.page_numbers && self.page_number_position.starts_with("top") { self.margin_mm.max(8.0) } else { self.margin_mm };
        let bottom = if self.page_numbers && self.page_number_position.starts_with("bottom") { self.margin_mm.max(8.0) } else { self.margin_mm };
        (top, bottom)
    }
}
fn default_position() -> String { "bottom-center".into() }
fn default_number_style() -> String { "number".into() }
fn default_paragraph_spacing() -> f64 { 0.65 }
#[derive(Clone, Serialize, Deserialize)]
pub struct LayoutIssue { pub id: String, pub message: String, pub blocking: bool }
#[derive(Serialize)]
pub struct PdfReceipt {
    id: String, revision: u64, size: u64, pages: u32,
    issues: Vec<LayoutIssue>, adjustable: Vec<String>, locations: Vec<pdf_document::ItemLocation>,
}
type Completion = mpsc::Sender<Result<PdfReceipt, String>>;
#[derive(Clone)]
struct LayoutReport { issues: Vec<LayoutIssue>, adjustable: Vec<String> }
struct Run {
    revision: u64, keep_revision: Option<u64>, options: PdfOptions,
    completion: Option<Completion>, printing: bool,
    raw_revision: Option<u64>, report: Option<LayoutReport>,
}
struct Job { owner: String, cancelled: AtomicBool, payload: Mutex<Option<PdfPayload>>, directory: tempfile::TempDir, run: Mutex<Run>, files: Mutex<Vec<u64>> }
#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum PdfPhase { Resources, Layout, Printing, Finishing }
#[derive(Clone, Serialize)]
struct PdfProgress<'a> { id: &'a str, revision: u64, phase: PdfPhase }

// Phase boundaries only: no polling, per-page traffic or locks held while
// emitting. The owning window additionally checks the active id/revision.
fn progress(app: &AppHandle, job: &Job, id: &str, revision: u64, phase: PdfPhase) {
    if job.cancelled.load(Ordering::Acquire) { return; }
    {
        let run = job.run.lock().unwrap();
        if run.revision != revision || run.completion.is_none()
            || (phase == PdfPhase::Layout && run.printing) { return; }
    }
    let _ = app.emit_to(job.owner.as_str(), "pdf-progress", PdfProgress { id, revision, phase });
}
impl Job {
    fn path(&self, revision: u64) -> std::path::PathBuf { self.directory.path().join(format!("document-{revision}.pdf")) }
    fn raw_path(&self, revision: u64) -> std::path::PathBuf { self.directory.path().join(format!("raw-{revision}.pdf")) }
}
#[derive(Default)]
pub struct ExportJobs(Mutex<HashMap<String, Arc<Job>>>);

fn job(app: &AppHandle, id: &str, owner: &str) -> Result<Arc<Job>, String> {
    app.state::<ExportJobs>().0.lock().unwrap().get(id)
        .filter(|job| job.owner == owner || owner == format!("nb-export-{id}"))
        .cloned().ok_or_else(|| "导出任务已结束".into())
}
fn finish(job: &Job, result: Result<PdfReceipt, String>) {
    let mut run = job.run.lock().unwrap(); run.printing = false;
    if let Some(sender) = run.completion.take() { let _ = sender.send(result); }
}
fn remove(app: &AppHandle, id: &str) {
    if let Some(job) = app.state::<ExportJobs>().0.lock().unwrap().remove(id) {
        job.cancelled.store(true, Ordering::Release); finish(&job, Err("导出已取消".into()));
    }
    if let Some(window) = app.get_webview_window(&format!("nb-export-{id}")) { let _ = window.destroy(); }
}
pub fn release_owner(app: &AppHandle, owner: &str) {
    pandoc::release_owner(app, owner);
    let ids: Vec<_> = app.state::<ExportJobs>().0.lock().unwrap().iter()
        .filter(|(_, job)| job.owner == owner).map(|(id, _)| id.clone()).collect();
    for id in ids { remove(app, &id); }
}
fn validate(o: &PdfOptions) -> Result<(), String> {
    if ![o.margin_mm, o.horizontal_margin_mm, o.font_pt, o.line_height, o.paragraph_spacing_em].iter().all(|v| v.is_finite())
        || !(0.0..=40.0).contains(&o.margin_mm) || !(0.0..=40.0).contains(&o.horizontal_margin_mm)
        || !(8.0..=24.0).contains(&o.font_pt)
        || !(1.0..=2.5).contains(&o.line_height) || !(0.0..=2.0).contains(&o.paragraph_spacing_em)
        || !["A4", "Letter"].contains(&o.paper.as_str())
        || !["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"].contains(&o.page_number_position.as_str())
        || !["number", "total", "dashes"].contains(&o.page_number_style.as_str()) {
        return Err("排版参数超出范围".into());
    }
    Ok(())
}
async fn wait(rx: mpsc::Receiver<Result<PdfReceipt, String>>) -> Result<PdfReceipt, String> {
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(1800))
        .map_err(|_| "PDF 排版超时".to_string()).and_then(|r| r)).await.map_err(|e| e.to_string())?
}

fn same_body_layout(a: &PdfOptions, b: &PdfOptions) -> bool {
    a.paper == b.paper && a.landscape == b.landscape && a.margin_mm == b.margin_mm
        && a.horizontal_margin_mm == b.horizontal_margin_mm
        && a.font_pt == b.font_pt && a.line_height == b.line_height
        && a.paragraph_spacing_em == b.paragraph_spacing_em && a.items == b.items
        && a.vertical_margins_mm() == b.vertical_margins_mm()
}

fn process_pdf(app: AppHandle, job: Arc<Job>, id: String, revision: u64, raw_revision: u64, options: PdfOptions, report: LayoutReport, printed: Result<(), String>) {
    std::thread::spawn(move || {
        if job.cancelled.load(Ordering::Acquire) { return; }
        if printed.is_ok() { progress(&app, &job, &id, revision, PdfPhase::Finishing); }
        let result = printed.and_then(|_| pdf_document::prepare(&job.raw_path(raw_revision), &job.path(revision), &options, &job.cancelled))
            .map(|processed| PdfReceipt { id, revision, size: processed.size, pages: processed.pages,
                issues: report.issues.clone(), adjustable: report.adjustable.clone(), locations: processed.locations });
        if result.is_ok() && !job.cancelled.load(Ordering::Acquire) {
            let (keep, previous_raw) = {
                let mut run = job.run.lock().unwrap();
                let previous = run.raw_revision.replace(raw_revision); run.report = Some(report);
                (run.keep_revision, previous)
            };
            if let Some(old) = previous_raw.filter(|old| *old != raw_revision) { let _ = std::fs::remove_file(job.raw_path(old)); }
            let mut files = job.files.lock().unwrap(); files.push(revision);
            files.retain(|old| { if *old == revision || Some(*old) == keep { true } else { let _ = std::fs::remove_file(job.path(*old)); false } });
        }
        finish(&job, result);
    });
}

#[tauri::command]
pub async fn create_pdf(app: AppHandle, window: WebviewWindow, id: String, payload: PdfPayload) -> Result<PdfReceipt, String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "无效的导出任务")?; validate(&payload.options)?;
    let (tx, rx) = mpsc::channel();
    let job = Arc::new(Job { owner: window.label().into(), cancelled: AtomicBool::new(false), files: Mutex::new(Vec::new()), run: Mutex::new(Run { revision: 0, keep_revision: None, options: payload.options.clone(), completion: Some(tx), printing: false, raw_revision: None, report: None }), payload: Mutex::new(Some(payload)),
        directory: tempfile::Builder::new().prefix("noteboard-export-").tempdir().map_err(|e| e.to_string())? });
    {
        let state = app.state::<ExportJobs>(); let mut jobs = state.0.lock().unwrap();
        if jobs.contains_key(&id) || jobs.values().filter(|j| j.owner == window.label()).count() >= 2 { return Err("请等待当前预览完成".into()); }
        jobs.insert(id.clone(), job.clone());
    }
    let build_app = app.clone(); let label = format!("nb-export-{id}"); let url = format!("export.html#{id}");
    std::thread::spawn(move || {
        match WebviewWindowBuilder::new(&build_app, label, WebviewUrl::App(url.into()))
            .visible(false).focused(false).skip_taskbar(true).inner_size(1100.0, 900.0).build() {
            Err(error) => finish(&job, Err(error.to_string())),
            Ok(window) => { if job.run.lock().unwrap().completion.is_none() { let _ = window.destroy(); } }
        }
    });
    let result = wait(rx).await;
    if result.is_err() { remove(&app, &id); }
    result
}
#[derive(Clone, Serialize)]
struct Revision { revision: u64, options: PdfOptions }
#[tauri::command]
pub async fn update_pdf(app: AppHandle, window: WebviewWindow, id: String, options: PdfOptions, keep_revision: Option<u64>) -> Result<PdfReceipt, String> {
    validate(&options)?;
    let job = job(&app, &id, window.label())?;
    let (tx, rx) = mpsc::channel();
    let (revision, reuse) = {
        let mut run = job.run.lock().unwrap();
        if run.completion.is_some() { return Err("预览仍在更新".into()); }
        let reuse = if same_body_layout(&run.options, &options) { run.raw_revision.zip(run.report.clone()) } else { None };
        run.revision += 1; run.keep_revision = keep_revision; run.options = options.clone(); run.completion = Some(tx); run.printing = reuse.is_some();
        (run.revision, reuse)
    };
    if let Some((raw_revision, report)) = reuse {
        // Page number styling does not require another browser pagination pass.
        process_pdf(app.clone(), job.clone(), id.clone(), revision, raw_revision, options, report, Ok(()));
    } else { match app.get_webview_window(&format!("nb-export-{id}")) {
        Some(render) => if let Err(error) = render.emit("export-options", Revision { revision, options }) { finish(&job, Err(error.to_string())); },
        None => finish(&job, Err("排版窗口已关闭".into())),
    } }
    let result = wait(rx).await;
    if result.is_err() { remove(&app, &id); }
    result
}
#[tauri::command]
pub fn pdf_payload(app: AppHandle, window: WebviewWindow, id: String) -> Result<PdfPayload, String> {
    let job = job(&app, &id, window.label())?;
    let payload = job.payload.lock().unwrap().take().ok_or("文档已载入排版窗口")?;
    progress(&app, &job, &id, 0, PdfPhase::Resources);
    Ok(payload)
}
#[tauri::command]
pub fn pdf_layout_started(app: AppHandle, window: WebviewWindow, id: String, revision: u64) -> Result<(), String> {
    if window.label() != format!("nb-export-{id}") { return Err("无效的排版窗口".into()); }
    let job = job(&app, &id, window.label())?;
    progress(&app, &job, &id, revision, PdfPhase::Layout);
    Ok(())
}
#[tauri::command]
pub fn pdf_ready(app: AppHandle, window: WebviewWindow, id: String, revision: Option<u64>, issues: Vec<LayoutIssue>, adjustable: Option<Vec<String>>, error: Option<String>) -> Result<(), String> {
    if window.label() != format!("nb-export-{id}") { return Err("无效的排版窗口".into()); }
    let job = job(&app, &id, window.label())?;
    let revision = revision.unwrap_or(0);
    let options = { let mut run = job.run.lock().unwrap(); if run.revision != revision || run.completion.is_none() || run.printing { return Ok(()); } run.printing = true; run.options.clone() };
    if let Some(error) = error { finish(&job, Err(error)); return Ok(()); }
    let callback_job = job.clone(); let callback_options = options.clone();
    progress(&app, &job, &id, revision, PdfPhase::Printing);
    let callback_app = app.clone();
    let started = pdf::print(&window, &job.raw_path(revision), &options, move |result| {
        process_pdf(callback_app, callback_job, id, revision, revision, callback_options, LayoutReport { issues, adjustable: adjustable.unwrap_or_default() }, result);
    });
    if let Err(error) = started { finish(&job, Err(error)); }
    Ok(())
}
#[tauri::command]
pub fn read_pdf(app: AppHandle, window: WebviewWindow, id: String, revision: Option<u64>, offset: Option<u64>, length: Option<usize>) -> Result<tauri::ipc::Response, String> {
    let job = job(&app, &id, window.label())?;
    let revision = revision.unwrap_or_else(|| job.run.lock().unwrap().revision);
    let mut file = std::fs::File::open(job.path(revision)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    if let Some(length) = length {
        if length > 1024 * 1024 { return Err("读取范围过大".into()); }
        file.seek(SeekFrom::Start(offset.unwrap_or(0))).map_err(|e| e.to_string())?;
        file.take(length as u64).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    } else { file.read_to_end(&mut bytes).map_err(|e| e.to_string())?; }
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
pub fn save_pdf(app: AppHandle, window: WebviewWindow, id: String, revision: Option<u64>, path: String) -> Result<(), String> {
    let job = job(&app, &id, window.label())?;
    output::copy(&job.path(revision.unwrap_or_else(|| job.run.lock().unwrap().revision)), std::path::Path::new(&path))
}
#[tauri::command]
pub fn release_pdf(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    if job(&app, &id, window.label()).is_ok() { remove(&app, &id); } Ok(())
}

#[cfg(test)]
mod tests {
    use super::{PdfOptions, same_body_layout, validate};

    fn options() -> PdfOptions {
        serde_json::from_value(serde_json::json!({
            "paper": "A4", "landscape": false, "marginMm": 12.0,
            "horizontalMarginMm": 12.0, "fontPt": 10.5, "lineHeight": 1.4,
            "paragraphSpacingEm": 0.65, "pageNumbers": true,
            "pageNumberPosition": "bottom-center", "pageNumberStyle": "number", "items": {}
        })).unwrap()
    }

    #[test]
    fn legacy_uniform_margin_payload_keeps_both_axes_and_paragraph_default() {
        let mut legacy = serde_json::to_value(options()).unwrap();
        legacy.as_object_mut().unwrap().remove("horizontalMarginMm");
        legacy.as_object_mut().unwrap().remove("paragraphSpacingEm");
        legacy["marginMm"] = 17.0.into();
        let restored: PdfOptions = serde_json::from_value(legacy).unwrap();
        assert_eq!(restored.horizontal_margin_mm, 17.0);
        assert_eq!(restored.vertical_margins_mm(), (17.0, 17.0));
        assert_eq!(restored.paragraph_spacing_em, 0.65);
        assert!(validate(&restored).is_ok());
        let payload = serde_json::to_value(restored.clone()).unwrap();
        assert_eq!(payload["horizontalMarginMm"], 17.0);
        assert_eq!(payload["paragraphSpacingEm"], 0.65);
    }

    #[test]
    fn margin_axis_and_paragraph_changes_invalidate_body_cache() {
        let base = options();
        let mut horizontal = base.clone(); horizontal.horizontal_margin_mm = 20.0;
        let mut vertical = base.clone(); vertical.margin_mm = 20.0;
        let mut paragraph = base.clone(); paragraph.paragraph_spacing_em = 1.0;
        assert!(!same_body_layout(&base, &horizontal));
        assert!(!same_body_layout(&base, &vertical));
        assert!(!same_body_layout(&base, &paragraph));
        let mut page_style = base.clone(); page_style.page_number_style = "total".into();
        assert!(same_body_layout(&base, &page_style));
    }

    #[test]
    fn horizontal_margin_uses_same_range_as_vertical() {
        let mut value = options();
        value.horizontal_margin_mm = 41.0;
        assert!(validate(&value).is_err());
        value.horizontal_margin_mm = f64::NAN;
        assert!(validate(&value).is_err());
    }
}
