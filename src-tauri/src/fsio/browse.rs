use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct BrowseLocation { name: String, path: String, kind: &'static str }

#[tauri::command]
pub async fn browse_locations(app: tauri::AppHandle) -> Result<Vec<BrowseLocation>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resolver = app.path();
        let mut locations = Vec::new();
        for (name, path) in [("个人文件夹", resolver.home_dir()), ("桌面", resolver.desktop_dir()),
            ("文档", resolver.document_dir()), ("下载", resolver.download_dir())] {
            if let Ok(path) = path { locations.push(BrowseLocation { name: name.into(), path: path.to_string_lossy().into(), kind: "folder" }); }
        }
        #[cfg(windows)] {
            // Enumerate the drive mask without probing removable/network media.
            let mask = unsafe { windows::Win32::Storage::FileSystem::GetLogicalDrives() };
            for index in 0..26 { if mask & (1 << index) != 0 {
                let letter = (b'A' + index) as char;
                locations.push(BrowseLocation { name: format!("{letter}:"), path: format!("{letter}:\\"), kind: "drive" });
            } }
        }
        locations
    }).await.map_err(|error| error.to_string())
}
