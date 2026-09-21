use super::PdfOptions;
use std::{path::Path, sync::{Arc, Mutex}};
use tauri::WebviewWindow;

#[cfg(windows)]
pub fn print(window: &WebviewWindow, path: &Path, options: &PdfOptions, done: impl FnOnce(Result<(), String>) + Send + 'static) -> Result<(), String> {
    use windows61::core::{HSTRING, Interface};
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, PrintToPdfCompletedHandler};
    let path = path.to_string_lossy().into_owned(); let options = options.clone();
    let complete = Arc::new(Mutex::new(Some(done)));
    let fail = complete.clone();
    window.with_webview(move |webview| {
        let invoke = || -> windows61::core::Result<()> { unsafe {
            let core = webview.controller().CoreWebView2()?.cast::<ICoreWebView2_7>()?;
            let settings = webview.environment().cast::<ICoreWebView2Environment6>()?.CreatePrintSettings()?;
            let (mut width, mut height) = if options.paper == "Letter" { (215.9, 279.4) } else { (210.0, 297.0) };
            if options.landscape { std::mem::swap(&mut width, &mut height); }
            settings.SetPageWidth(width / 25.4)?; settings.SetPageHeight(height / 25.4)?;
            settings.SetScaleFactor(1.0)?;
            let margin = options.margin_mm / 25.4;
            let (top, bottom) = options.vertical_margins_mm();
            settings.SetMarginTop(top / 25.4)?; settings.SetMarginBottom(bottom / 25.4)?;
            settings.SetMarginLeft(margin)?; settings.SetMarginRight(margin)?;
            settings.SetShouldPrintBackgrounds(true)?;
            settings.SetShouldPrintHeaderAndFooter(false)?;
            settings.SetHeaderTitle(&HSTRING::from(""))?; settings.SetFooterUri(&HSTRING::from(""))?;
            let completed = complete.clone();
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
                if let Some(done) = completed.lock().unwrap().take() {
                    done(result.map_err(|e| e.to_string()).and_then(|_| if success { Ok(()) } else { Err("PDF 生成失败".into()) }));
                } Ok(())
            }));
            core.PrintToPdf(&HSTRING::from(path), &settings, &handler)
        } };
        if let Err(error) = invoke() { if let Some(done) = fail.lock().unwrap().take() { done(Err(error.to_string())); } }
    }).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn print(_window: &WebviewWindow, _path: &Path, _options: &PdfOptions, _done: impl FnOnce(Result<(), String>) + Send + 'static) -> Result<(), String> {
    Err("PDF 导出需要 Windows WebView2".into())
}
