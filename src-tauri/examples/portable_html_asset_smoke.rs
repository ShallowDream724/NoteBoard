//! Hidden WebView2 probe of the production portable HTML asset reader.
//! Run from the repository root: node scripts/probe-portable-html-assets.mjs
use std::{borrow::Cow, path::PathBuf, sync::atomic::{AtomicI32, Ordering}};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

static EXIT_CODE: AtomicI32 = AtomicI32::new(2);

#[tauri::command]
fn probe_result(result: String, app: AppHandle) {
    println!("portable HTML asset probe: {result}");
    let ok = serde_json::from_str::<serde_json::Value>(&result)
        .ok().and_then(|value| value.get("ok").and_then(|ok| ok.as_bool())).unwrap_or(false);
    EXIT_CODE.store(if ok { 0 } else { 1 }, Ordering::SeqCst);
    app.exit(if ok { 0 } else { 1 });
}

fn main() {
    let bundle = std::env::args().nth(1).expect("probe bundle path required");
    let script = std::fs::read_to_string(bundle).expect("read probe bundle");
    let app_data = PathBuf::from(std::env::var_os("APPDATA").expect("APPDATA required"));
    let staging_root = app_data.join("NoteBoard").join("staging");
    std::fs::create_dir_all(&staging_root).expect("create staging root");
    let stage = tempfile::Builder::new().prefix("asset-probe-").tempdir_in(staging_root).expect("create staging fixture");
    let stage_assets = stage.path().join(".noteboard-assets");
    std::fs::create_dir(&stage_assets).expect("create asset directory");
    let staged = stage_assets.join("中文 空格.png");
    let saved_directory = tempfile::Builder::new().prefix("noteboard-saved-probe-").tempdir().expect("create saved fixture");
    let saved_assets = saved_directory.path().join("已保存 笔记").join(".noteboard-assets");
    std::fs::create_dir_all(&saved_assets).expect("create saved asset directory");
    let saved = saved_assets.join("已保存 图片.png");
    std::fs::write(&staged, [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).expect("write staged image");
    std::fs::write(&saved, [137, 80, 78, 71, 13, 10, 4, 5]).expect("write saved image");
    let paths = serde_json::to_string(&[staged.to_string_lossy().to_string(), saved.to_string_lossy().to_string()]).unwrap();
    let initialization = format!("window.__assetProbePaths={paths};\n{script}");

    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![probe_result])
        .setup(move |app| {
            let timeout_app = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(30));
                eprintln!("portable HTML asset probe timed out");
                timeout_app.exit(2);
            });
            WebviewWindowBuilder::new(app, "asset-probe", WebviewUrl::App("index.html".into()))
                .visible(false).focused(false).skip_taskbar(true)
                .initialization_script(initialization)
                .on_web_resource_request(|request, response| {
                    if request.uri().path().ends_with("/index.html") {
                        response.headers_mut().insert("content-type", "text/html; charset=utf-8".parse().unwrap());
                        *response.body_mut() = Cow::Borrowed(b"<!doctype html><html><head></head><body>asset probe</body></html>");
                    }
                })
                .build()?;
            // Keep fixtures alive until the WebView exits.
            app.manage((stage, saved_directory));
            Ok(())
        })
        .run(context)
        .expect("asset probe startup");
    std::process::exit(EXIT_CODE.load(Ordering::SeqCst));
}
