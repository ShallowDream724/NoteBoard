//! Native export integration probe. No sessions, settings, or user documents are opened.
//! cargo run --release --example pdf_smoke -- payload.json output.pdf
use tauri::{WebviewUrl, WebviewWindowBuilder};
use noteboard_lib::export;

fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert!(args.len() == 3 || args.len() == 4, "usage: pdf_smoke payload.json output.pdf [updated-options.json]");
    let payload: export::PdfPayload = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let destination = args[2].clone();
    let update: Option<export::PdfOptions> = args.get(3).map(|path| serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap());
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
                    export::save_pdf(app.clone(), window.clone(), id.clone(), None, destination.clone())?;
                    std::fs::write(format!("{destination}.json"), serde_json::to_vec_pretty(&receipt).unwrap()).map_err(|e| e.to_string())?;
                    if let Some(options) = update {
                        let receipt = export::update_pdf(app.clone(), window.clone(), id.clone(), options.clone(), Some(0)).await?;
                        export::save_pdf(app.clone(), window.clone(), id.clone(), Some(1), format!("{destination}.updated.pdf"))?;
                        std::fs::write(format!("{destination}.updated.json"), serde_json::to_vec_pretty(&receipt).unwrap()).map_err(|e| e.to_string())?;
                        // The displayed revision must remain readable during replacement.
                        export::read_pdf(app.clone(), window.clone(), id.clone(), Some(0), Some(0), Some(32))?;
                        let mut numbers = options; numbers.page_number_position = "top-right".into(); numbers.page_number_style = "dashes".into();
                        let start = std::time::Instant::now();
                        let numbered = export::update_pdf(app.clone(), window.clone(), id.clone(), numbers, Some(1)).await?;
                        println!("page-number-only update: {} ms", start.elapsed().as_millis());
                        export::save_pdf(app.clone(), window.clone(), id.clone(), Some(2), format!("{destination}.numbered.pdf"))?;
                        std::fs::write(format!("{destination}.numbered.json"), serde_json::to_vec_pretty(&numbered).unwrap()).map_err(|e| e.to_string())?;
                    }
                    export::release_pdf(app.clone(), window, id)?;
                    Ok::<(), String>(())
                });
                if let Err(error) = &result { eprintln!("{error}"); }
                app.exit(if result.is_ok() { 0 } else { 1 });
            });
            Ok(())
        }).run(context).expect("export probe startup");
}
