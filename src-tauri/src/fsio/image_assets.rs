//! Managed images: one bounded reference scan per batch, individual recovery receipts.
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Manager;

static OPERATIONS: Mutex<()> = Mutex::new(());
static RECEIPTS: OnceLock<Mutex<HashMap<String, Recovery>>> = OnceLock::new();
struct Recovery {
    path: PathBuf,
    item: Option<trash::TrashItem>,
    // Shared by delayed shell receipts from one batch, never copied per image.
    previous_ids: Arc<HashSet<std::ffi::OsString>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTrashReceipt {
    pub ticket: String,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTrashResult {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ticket: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct CheckedImage {
    requested: String,
    path: PathBuf,
}

fn key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

// Conservative counterpart of imageReferences.ts. Decode all percent escapes,
// Markdown punctuation escapes and numeric/common HTML entities before matching.
// Unsupported/ambiguous encoding is unknown evidence, never permission to delete.
fn normalize_reference_text(content: &str) -> Result<String, String> {
    let mut unescaped = String::with_capacity(content.len());
    let mut chars = content.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' && chars.peek().is_some_and(|next| next.is_ascii_punctuation()) {
            unescaped.push(chars.next().unwrap());
        } else {
            unescaped.push(ch);
        }
    }
    let mut entities = String::with_capacity(unescaped.len());
    let mut chars = unescaped.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '&'
            || !chars
                .peek()
                .is_some_and(|next| *next == '#' || next.is_ascii_alphabetic())
        {
            entities.push(ch);
            continue;
        }
        let mut name = String::new();
        if chars.peek() == Some(&'#') {
            name.push(chars.next().unwrap());
            let hex = matches!(chars.peek(), Some('x' | 'X'));
            if hex {
                name.push(chars.next().unwrap());
            }
            while chars.peek().is_some_and(|next| {
                if hex {
                    next.is_ascii_hexdigit()
                } else {
                    next.is_ascii_digit()
                }
            }) {
                name.push(chars.next().unwrap());
            }
        } else {
            while chars.peek().is_some_and(char::is_ascii_alphanumeric) {
                name.push(chars.next().unwrap());
            }
        }
        if chars.peek() == Some(&';') {
            chars.next();
        }
        let decoded = match name.as_str() {
            "amp" | "AMP" => Some('&'),
            "quot" | "QUOT" => Some('"'),
            "apos" => Some('\''),
            "lt" | "LT" => Some('<'),
            "gt" | "GT" => Some('>'),
            "sol" => Some('/'),
            "bsol" => Some('\\'),
            "period" => Some('.'),
            "colon" => Some(':'),
            "percnt" => Some('%'),
            "lowbar" => Some('_'),
            "hyphen" => Some('-'),
            "num" => Some('#'),
            "quest" => Some('?'),
            "equals" => Some('='),
            "Tab" => Some('\t'),
            "NewLine" => Some('\n'),
            "nbsp" => Some('\u{a0}'),
            _ if name.starts_with('#') => {
                let hex = name.starts_with("#x") || name.starts_with("#X");
                u32::from_str_radix(&name[if hex { 2 } else { 1 }..], if hex { 16 } else { 10 })
                    .ok()
                    // HTML applies replacement/legacy mappings in this range.
                    .filter(|point| *point > 0 && !(0x80..=0x9f).contains(point))
                    .and_then(char::from_u32)
            }
            _ => None,
        }
        .ok_or("无法完整解码文档图片引用，已保留文件")?;
        entities.push(decoded);
    }
    let bytes = entities.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let digits = bytes
                .get(index + 1..index + 3)
                .ok_or("图片引用编码不完整，已保留文件")?;
            let hex = |digit: u8| (digit as char).to_digit(16);
            let high = hex(digits[0]).ok_or("图片引用编码无效，已保留文件")?;
            let low = hex(digits[1]).ok_or("图片引用编码无效，已保留文件")?;
            decoded.push((high * 16 + low) as u8);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded)
        .map(|value| value.to_lowercase())
        .map_err(|_| "图片引用编码无效，已保留文件".into())
}

fn checked_paths(
    document: &Path,
    image_paths: &[String],
    directory_name: &str,
    reference_root: Option<&Path>,
) -> Result<(PathBuf, Vec<CheckedImage>), String> {
    let document = dunce::canonicalize(document).map_err(|e| format!("文档尚未保存：{e}"))?;
    let parent = document.parent().ok_or("文档没有有效目录")?;
    let managed = dunce::canonicalize(parent.join(directory_name))
        .map_err(|e| format!("图片目录不可用：{e}"))?;
    if !managed.starts_with(parent) || managed == parent {
        return Err("仅清理文档下专用图片目录中的文件".into());
    }
    let root = match reference_root {
        Some(path) => {
            let root = dunce::canonicalize(path)
                .map_err(|e| format!("引用目录无法核对，已保留文件：{e}"))?;
            if parent.starts_with(&root) {
                root
            } else {
                parent.to_path_buf()
            }
        }
        None => parent.to_path_buf(),
    };
    let mut seen = HashSet::new();
    let mut images = Vec::new();
    for requested in image_paths {
        let image = dunce::canonicalize(requested).map_err(|e| format!("图片不可用：{e}"))?;
        if !image.is_file() || !image.starts_with(&managed) {
            return Err("外部图片保留在原位置".into());
        }
        if seen.insert(key(&image)) {
            images.push(CheckedImage {
                requested: requested.clone(),
                path: image,
            });
        }
    }
    Ok((root, images))
}

fn scan_references(
    root: PathBuf,
    images: &[CheckedImage],
) -> Result<HashMap<String, String>, String> {
    let filenames: Vec<_> = images
        .iter()
        .map(|image| {
            (
                key(&image.path),
                image
                    .path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase(),
            )
        })
        .collect();
    let mut referenced = HashMap::new();
    let mut stack = vec![root];
    let mut scanned = 0usize;
    let mut entries = 0usize;
    let mut bytes = 0u64;
    while let Some(dir) = stack.pop() {
        for entry in
            std::fs::read_dir(&dir).map_err(|e| format!("无法核对图片引用，已保留文件：{e}"))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if [".git", "node_modules", "target", ".venv"].contains(&name.as_str()) {
                continue;
            }
            entries += 1;
            if entries > 32768 {
                return Err("引用检查范围过大，图片已保留；可在文件目录中手动清理".into());
            }
            // A linked document/directory is unscanned evidence, not absence.
            if kind.is_symlink() {
                return Err("引用目录包含链接，无法完整核对，图片已保留".into());
            }
            if kind.is_dir() {
                stack.push(path);
                continue;
            }
            let ext = path
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            if !["md", "markdown", "mdown", "mdx", "html", "htm", "nbdoc"].contains(&ext.as_str()) {
                continue;
            }
            scanned += 1;
            bytes += entry.metadata().map_err(|e| e.to_string())?.len();
            if scanned > 4096 || bytes > 64 * 1024 * 1024 {
                return Err("引用检查范围过大，图片已保留；可在文件目录中手动清理".into());
            }
            let text = std::fs::read_to_string(&path)
                .map_err(|e| format!("无法核对文档引用，图片已保留：{e}"))?;
            let text = if ext == "nbdoc" {
                serde_json::from_str::<serde_json::Value>(&text)
                    .map_err(|_| "无法读取 NoteBoard 文档引用，图片已保留")?.to_string()
            } else { text };
            let text = normalize_reference_text(&text)?;
            for (image_key, filename) in &filenames {
                if text.contains(filename) {
                    referenced.insert(
                        image_key.clone(),
                        format!(
                            "文档「{}」仍可能引用此图片，已保留文件",
                            path.file_name().unwrap_or_default().to_string_lossy()
                        ),
                    );
                }
            }
        }
    }
    Ok(referenced)
}

fn recycle_images(
    document_path: String,
    image_paths: Vec<String>,
    image_directory: String,
    reference_root: Option<String>,
    check_windows: impl Fn() -> Result<(), String>,
) -> Result<Vec<ImageTrashResult>, String> {
    let _guard = OPERATIONS.lock().map_err(|_| "图片操作状态不可用")?;
    check_windows()?;
    let mut receipts = RECEIPTS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "恢复记录不可用")?;
    if image_paths.is_empty() {
        return Ok(Vec::new());
    }
    if image_paths.len() > 1024 || receipts.len() + image_paths.len() > 1024 {
        return Err("本次会话的图片恢复记录已满，已保留文件".into());
    }
    let (root, images) = checked_paths(
        Path::new(&document_path),
        &image_paths,
        &image_directory,
        reference_root.as_deref().map(Path::new),
    )?;
    let referenced = scan_references(root, &images)?;
    check_windows()?;
    let before: Arc<HashSet<_>> = Arc::new(
        trash::os_limited::list()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|item| item.id)
            .collect(),
    );
    let mut results = Vec::with_capacity(images.len());
    for image in images {
        if let Some(error) = referenced.get(&key(&image.path)) {
            results.push(ImageTrashResult {
                path: image.requested,
                ticket: None,
                error: Some(error.clone()),
            });
            continue;
        }
        if let Err(error) = trash::delete(&image.path) {
            results.push(ImageTrashResult {
                path: image.requested,
                ticket: None,
                error: Some(format!("无法移入回收站：{error}")),
            });
            continue;
        }
        let ticket = uuid::Uuid::new_v4().to_string();
        // Record immediately; a delayed/failed shell enumeration cannot lose it.
        receipts.insert(
            ticket.clone(),
            Recovery {
                path: image.path,
                item: None,
                previous_ids: before.clone(),
            },
        );
        results.push(ImageTrashResult {
            path: image.requested,
            ticket: Some(ticket),
            error: None,
        });
    }
    if let Ok(items) = trash::os_limited::list() {
        let mut new_items: HashMap<_, _> = items
            .into_iter()
            .filter(|item| !before.contains(&item.id))
            .map(|item| (key(&item.original_path()), item))
            .collect();
        for result in &results {
            if let Some(recovery) = result
                .ticket
                .as_ref()
                .and_then(|ticket| receipts.get_mut(ticket))
            {
                recovery.item = new_items.remove(&key(&recovery.path));
                if recovery.item.is_some() {
                    recovery.previous_ids = Arc::default();
                }
            }
        }
    }
    // A different window may have opened a document during shell I/O. Return
    // every receipt plus a rollback reason, so the caller restores all of them.
    if let Err(error) = check_windows() {
        for result in &mut results {
            if result.ticket.is_some() {
                result.error = Some(error.clone());
            }
        }
    }
    Ok(results)
}

fn check_other_windows(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let state = app.state::<Mutex<crate::state::AppState>>();
    let state = state
        .lock()
        .map_err(|_| "无法确认其他窗口的文档引用，已保留文件")?;
    if state.documents.values().any(|doc| {
        doc.owner_window != label
            && (doc.kind == crate::dto::DocumentKind::Markdown
                || doc.kind == crate::dto::DocumentKind::Noteboard
                || ["html", "htm", "mdx"].contains(
                    &Path::new(&doc.key)
                        .extension()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase()
                        .as_str(),
                ))
    }) {
        return Err("其他窗口仍有可能引用图片的文档，已保留文件".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn recycle_document_images(
    window: tauri::WebviewWindow,
    document_path: String,
    image_paths: Vec<String>,
    image_directory: String,
    reference_root: Option<String>,
) -> Result<Vec<ImageTrashResult>, String> {
    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        recycle_images(
            document_path,
            image_paths,
            image_directory,
            reference_root,
            || check_other_windows(&app, &label),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

// Compatibility entry point; all checking and mutations use the batch boundary.
#[tauri::command]
pub async fn recycle_document_image(
    window: tauri::WebviewWindow,
    document_path: String,
    image_path: String,
    image_directory: String,
    reference_root: Option<String>,
) -> Result<ImageTrashReceipt, String> {
    let result = recycle_document_images(
        window,
        document_path,
        vec![image_path],
        image_directory,
        reference_root,
    )
    .await?
    .pop()
    .ok_or("图片回收未返回结果")?;
    if let Some(error) = result.error {
        if let Some(ticket) = result.ticket {
            restore_document_image(ticket).await?;
        }
        return Err(error);
    }
    match result.ticket {
        Some(ticket) => Ok(ImageTrashReceipt {
            ticket,
            path: result.path,
        }),
        None => Err("图片未回收".into()),
    }
}

#[tauri::command]
pub async fn restore_document_image(ticket: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = OPERATIONS.lock().map_err(|_| "图片操作状态不可用")?;
        let mut receipts = RECEIPTS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "恢复记录不可用")?;
        let recovery = receipts.get_mut(&ticket).ok_or("该图片的恢复记录已失效")?;
        if recovery.path.exists() {
            return Err("原位置已有文件，未覆盖现有图片".into());
        }
        if recovery.item.is_none() {
            for attempt in 0..5 {
                recovery.item = trash::os_limited::list().ok().and_then(|items| {
                    items.into_iter().find(|item| {
                        key(&item.original_path()) == key(&recovery.path)
                            && !recovery.previous_ids.contains(&item.id)
                    })
                });
                if recovery.item.is_some() {
                    recovery.previous_ids = Arc::default();
                    break;
                }
                if attempt < 4 {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }
        let item = recovery
            .item
            .as_ref()
            .ok_or("系统回收站暂未提供此图片的恢复记录，请稍后重试")?;
        trash::os_limited::restore_all([item.clone()]).map_err(|e| format!("无法恢复图片：{e}"))?;
        receipts.remove(&ticket);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoded_and_html_references_are_retained_in_one_scan() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("img")).unwrap();
        let document = dir.path().join("note.md");
        std::fs::write(&document, "正文").unwrap();
        let images: Vec<String> = ["picture.png", "other.png"]
            .iter()
            .map(|name| {
                let path = dir.path().join("img").join(name);
                std::fs::write(&path, [1, 2, 3]).unwrap();
                path.to_string_lossy().into_owned()
            })
            .collect();
        let (root, checked) = checked_paths(&document, &images, "img", None).unwrap();
        assert!(scan_references(root.clone(), &checked).unwrap().is_empty());
        std::fs::write(
            dir.path().join("peer.md"),
            "![共享](img/%70icture.png) <img src=\"img/other&#46;png\">",
        )
        .unwrap();
        assert_eq!(scan_references(root, &checked).unwrap().len(), 2);
        assert!(images.iter().all(|path| Path::new(path).exists()));
    }
    #[test]
    fn uncertain_encoding_cannot_prove_absence() {
        assert!(normalize_reference_text("![x](img/picture&unknown;png)").is_err());
        assert!(normalize_reference_text("![x](img/%ff.png)").is_err());
        assert!(normalize_reference_text("![x](img/&#128;.png)").is_err());
        assert_eq!(
            normalize_reference_text("picture\\.png &#x70;icture&period;png").unwrap(),
            "picture.png picture.png"
        );
    }
    #[test]
    fn unsafe_directory_and_unavailable_root_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let document = dir.path().join("note.md");
        let image = dir.path().join("picture.png");
        std::fs::write(&document, "正文").unwrap();
        std::fs::write(&image, [1]).unwrap();
        assert!(checked_paths(
            &document,
            &[image.to_string_lossy().into_owned()],
            ".",
            None
        )
        .is_err());
        std::fs::create_dir(dir.path().join("img")).unwrap();
        let image = dir.path().join("img/picture.png");
        std::fs::write(&image, [1]).unwrap();
        assert!(checked_paths(
            &document,
            &[image.to_string_lossy().into_owned()],
            "img",
            Some(&dir.path().join("missing"))
        )
        .is_err());
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
            let receipt = recycle_images(
                document.to_string_lossy().into_owned(),
                vec![image.to_string_lossy().into_owned()],
                "img".into(),
                None,
                || Ok(()),
            )
            .unwrap()
            .pop()
            .unwrap();
            assert!(!image.exists());
            restore_document_image(receipt.ticket.unwrap())
                .await
                .unwrap();
            assert_eq!(std::fs::read(&image).unwrap(), b"private-test-asset");
        });
    }
}
