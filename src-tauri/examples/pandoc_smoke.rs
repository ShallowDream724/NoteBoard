//! Uses normal executable discovery and the production conversion adapter.
//! cargo run --release --example pandoc_smoke -- source.json output-prefix
use noteboard_lib::export::pandoc;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert!(args.len() == 3, "usage: pandoc_smoke source.json output-prefix");
    let source = std::fs::read_to_string(&args[1]).unwrap();
    let mut context = tauri::generate_context!(); context.config_mut().app.windows.clear();
    tauri::Builder::default().manage(pandoc::PandocJobs::default()).setup(move |app| {
        let app = app.handle().clone();
        std::thread::spawn(move || {
            let result = tauri::async_runtime::block_on(async {
                let window = WebviewWindowBuilder::new(&app, "pandoc-probe", WebviewUrl::External("about:blank".parse().unwrap()))
                    .visible(false).focused(false).skip_taskbar(true).build().map_err(|e| e.to_string())?;
                let status = pandoc::pandoc_status(String::new()).await?;
                println!("{}", serde_json::to_string(&status).unwrap());
                for (format, extension) in [("docx", "docx"), ("html5", "html"), ("latex", "tex")] {
                    let id = uuid::Uuid::new_v4().to_string();
                    pandoc::begin_pandoc(app.clone(), window.clone(), id.clone())?;
                    let messages = pandoc::pandoc_export(app.clone(), window.clone(), id, String::new(), format.into(), source.clone(), String::new(), format!("{}.{}", args[2], extension)).await?;
                    println!("{format}: {messages}");
                }
                Ok::<(), String>(())
            });
            pandoc::release_owner(&app, "pandoc-probe");
            if let Err(error) = &result { eprintln!("{error}"); }
            app.exit(if result.is_ok() { 0 } else { 1 });
        }); Ok(())
    }).run(context).expect("Pandoc probe startup");
}
