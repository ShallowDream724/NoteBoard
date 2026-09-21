//! Managed image cleanup. Document UI requests a decision; only this boundary mutates files.
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static OPERATIONS: Mutex<()> = Mutex::new(());
static RECEIPTS: OnceLock<Mutex<HashMap<String, Recovery>>> = OnceLock::new();
struct Recovery {
    path: PathBuf,
    item: Option<trash::TrashItem>,
    // Only retained if the shell has not exposed the newly deleted item yet.
    previous_ids: HashSet<std::ffi::OsString>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTrashReceipt {
    pub ticket: String,
    pub path: String,
}

fn key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

fn checked_image(
    document: &Path, image: &Path, directory_name: &str, reference_root: Option<&Path>,
) -> Result<(PathBuf, PathBuf), String> {
    let document = dunce::canonicalize(document).map_err(|e| format!("文档尚未保存：{e}"))?;
    let parent = document.parent().ok_or("文档没有有效目录")?;
    let managed = dunce::canonicalize(parent.join(directory_name)).map_err(|e| format!("图片目录不可用：{e}"))?;
    if !managed.starts_with(parent) || managed == parent {
        return Err("仅清理文档下专用图片目录中的文件".into());
    }
    let image = dunce::canonicalize(image).map_err(|e| format!("图片不可用：{e}"))?;
    if !image.is_file() || !image.starts_with(&managed) {
        return Err("外部图片保留在原位置".into());
    }
    let root = reference_root.and_then(|p| dunce::canonicalize(p).ok())
        .filter(|p| parent.starts_with(p)).unwrap_or_else(|| parent.to_path_buf());
    let filename = image.file_name().ok_or("图片文件名无效")?.to_string_lossy().to_lowercase();
    let encoded = url::Url::from_file_path(&image).ok()
        .and_then(|u| u.path_segments().and_then(|mut parts| parts.next_back()).map(str::to_lowercase));
    let mut stack = vec![root];
    let mut scanned = 0usize;
    let mut bytes = 0u64;
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).map_err(|e| format!("无法核对图片引用，已保留文件：{e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() { continue; }
            if kind.is_dir() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if ![".git", "node_modules", "target", ".venv"].contains(&name.as_str()) {
                    stack.push(path);
                }
                continue;
            }
            let ext = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
            if !["md", "markdown", "mdown", "mdx", "html", "htm"].contains(&ext.as_str()) { continue; }
            scanned += 1;
            bytes += entry.metadata().map_err(|e| e.to_string())?.len();
            if scanned > 4096 || bytes > 64 * 1024 * 1024 {
                return Err("引用检查范围过大，图片已保留；可在文件目录中手动清理".into());
            }
            let text = std::fs::read_to_string(&path).map_err(|e| format!("无法核对文档引用，图片已保留：{e}"))?.to_lowercase();
            // Conservative matching also protects HTML and reference-style Markdown images.
            if text.contains(&filename) || encoded.as_ref().is_some_and(|name| text.contains(name)) {
                return Err(format!("文档「{}」仍可能引用此图片，已保留文件", path.file_name().unwrap_or_default().to_string_lossy()));
            }
        }
    }
    Ok((document, image))
}

#[tauri::command]
pub async fn recycle_document_image(
    document_path: String, image_path: String, image_directory: String, reference_root: Option<String>,
) -> Result<ImageTrashReceipt, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = OPERATIONS.lock().map_err(|_| "图片操作状态不可用")?;
        let mut receipts = RECEIPTS.get_or_init(Default::default).lock().map_err(|_| "恢复记录不可用")?;
        if receipts.len() >= 1024 {
            return Err("本次会话的图片恢复记录已满，已保留文件".into());
        }
        let (_, image) = checked_image(Path::new(&document_path), Path::new(&image_path),
            &image_directory, reference_root.as_deref().map(Path::new))?;
        let before: HashSet<_> = trash::os_limited::list().map_err(|e| e.to_string())?
            .into_iter().map(|item| item.id).collect();
        trash::delete(&image).map_err(|e| format!("无法移入回收站：{e}"))?;
        // A successful deletion always gets a receipt, even when the Windows shell
        // enumerates the recycled item late. Restore can resolve it on demand.
        let item = trash::os_limited::list().ok().and_then(|items| items.into_iter()
            .find(|item| key(&item.original_path()) == key(&image) && !before.contains(&item.id)));
        let ticket = uuid::Uuid::new_v4().to_string();
        let previous_ids = if item.is_some() { HashSet::new() } else { before };
        receipts.insert(ticket.clone(), Recovery { path: image.clone(), item, previous_ids });
        Ok(ImageTrashReceipt { ticket, path: image.to_string_lossy().into_owned() })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_document_image(ticket: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = OPERATIONS.lock().map_err(|_| "图片操作状态不可用")?;
        let mut receipts = RECEIPTS.get_or_init(Default::default).lock().map_err(|_| "恢复记录不可用")?;
        let recovery = receipts.get_mut(&ticket).ok_or("该图片的恢复记录已失效")?;
        if recovery.path.exists() { return Err("原位置已有文件，未覆盖现有图片".into()); }
        if recovery.item.is_none() {
            for attempt in 0..5 {
                recovery.item = trash::os_limited::list().ok().and_then(|items| items.into_iter()
                    .find(|item| key(&item.original_path()) == key(&recovery.path) && !recovery.previous_ids.contains(&item.id)));
                if recovery.item.is_some() { recovery.previous_ids.clear(); break; }
                if attempt < 4 { std::thread::sleep(std::time::Duration::from_millis(100)); }
            }
        }
        let item = recovery.item.as_ref().ok_or("系统回收站暂未提供此图片的恢复记录，请稍后重试")?;
        trash::os_limited::restore_all([item.clone()]).map_err(|e| format!("无法恢复图片：{e}"))?;
        receipts.remove(&ticket);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_unreferenced_managed_images_are_eligible() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("img")).unwrap();
        let document = dir.path().join("note.md");
        let image = dir.path().join("img/picture.png");
        std::fs::write(&document, "正文").unwrap();
        std::fs::write(&image, [1, 2, 3]).unwrap();
        assert!(checked_image(&document, &image, "img", None).is_ok());
        std::fs::write(dir.path().join("peer.md"), "![共享](img/picture.png)").unwrap();
        assert!(checked_image(&document, &image, "img", None).is_err());
        assert!(image.exists()); // Validation itself never deletes.
    }
    #[test]
    fn unsafe_directory_and_unsaved_deletion_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let document = dir.path().join("note.md");
        let image = dir.path().join("picture.png");
        std::fs::write(&document, "![引用](picture.png)").unwrap();
        std::fs::write(&image, [1]).unwrap();
        assert!(checked_image(&document, &image, ".", None).is_err());
    }
    #[test]
    fn recycling_and_restore_preserve_test_asset_bytes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("img")).unwrap();
        let document = dir.path().join("note.md");
        let image = dir.path().join("img/recycle-test.png");
        std::fs::write(&document, "正文").unwrap();
        std::fs::write(&image, b"private-test-asset").unwrap();
        tauri::async_runtime::block_on(async {
            let receipt = recycle_document_image(
                document.to_string_lossy().into_owned(), image.to_string_lossy().into_owned(),
                "img".into(), None,
            ).await.unwrap();
            assert!(!image.exists());
            restore_document_image(receipt.ticket).await.unwrap();
            assert_eq!(std::fs::read(&image).unwrap(), b"private-test-asset");
        });
    }
}
