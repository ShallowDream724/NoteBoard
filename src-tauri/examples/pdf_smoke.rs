//! Native export integration probe. No sessions, settings, or user documents are opened.
//! cargo run --release --example pdf_smoke -- payload.json output.pdf
use tauri::{WebviewUrl, WebviewWindowBuilder};
use noteboard_lib::export;

fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert!(args.len() == 3, "usage: pdf_smoke payload.json output.pdf");
    let payload: export::PdfPayload = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let destination = args[2].clone();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default().manage(export::ExportJobs::default())
        .invoke_handler(tauri::generate_handler![export::pdf_payload, export::pdf_ready])
        .setup(move |app| {
            let app = app.handle().clone();
            std::thread::spawn(move || {
                let result = tauri::async_runtime::block_on(async {
                    let window = WebviewWindowBuilder::new(&app, "nb-main", WebviewUrl::External("about:blank".parse().unwrap()))
                        .visible(false).focused(false).skip_taskbar(true).build().map_err(|e| e.to_string())?;
                    let id = uuid::Uuid::new_v4().to_string();
                    let receipt = export::create_pdf(app.clone(), window.clone(), id.clone(), payload).await?;
                    export::save_pdf(app.clone(), window.clone(), id.clone(), destination.clone())?;
                    std::fs::write(format!("{destination}.json"), serde_json::to_vec_pretty(&receipt).unwrap()).map_err(|e| e.to_string())?;
                    export::release_pdf(app.clone(), window, id)?;
                    Ok::<(), String>(())
                });
                if let Err(error) = &result { eprintln!("{error}"); }
                app.exit(if result.is_ok() { 0 } else { 1 });
            });
            Ok(())
        }).run(context).expect("export probe startup");
}
