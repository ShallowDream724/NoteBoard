//! Uses normal executable discovery and the production conversion adapter.
//! cargo run --release --example pandoc_smoke -- source.json output-prefix
use noteboard_lib::export::pandoc;

fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert!(args.len() == 3, "usage: pandoc_smoke source.json output-prefix");
    let source = std::fs::read_to_string(&args[1]).unwrap();
    tauri::async_runtime::block_on(async {
        let status = pandoc::pandoc_status(String::new()).await.unwrap();
        println!("{}", serde_json::to_string(&status).unwrap());
        for (format, extension) in [("docx", "docx"), ("html5", "html"), ("latex", "tex")] {
            let messages = pandoc::pandoc_export(String::new(), format.into(), source.clone(), String::new(), format!("{}.{}", args[2], extension)).await.unwrap();
            println!("{format}: {messages}");
        }
    });
}
