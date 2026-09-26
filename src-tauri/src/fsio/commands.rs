// NoteBoard fsio 命令 — IPC 接口
// 所有文件 I/O 命令的 Tauri command 封装

use crate::dto::{
    DocumentPayload, FileTreeNode, PathExistsResult, ProbeResult, WriteResult,
};
use crate::path as nbpath;
use std::path::{Path, PathBuf};
use tauri_plugin_fs::FsExt;

use super::dir;
use super::read;
use super::trash;
use super::write;

/// 读取文档
#[tauri::command]
pub async fn read_document(path: String) -> Result<DocumentPayload, String> {
    tauri::async_runtime::spawn_blocking(move || read_document_on_worker(path)).await.map_err(|error| error.to_string())?
}

fn read_document_on_worker(path: String) -> Result<DocumentPayload, String> {
    super::native_documents::ensure_recovered_before_read()?;
    let p = Path::new(&path);

    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    let result = read::read_file(p).map_err(|e| e.to_string())?;

    let (kind, language) = crate::dto::kind_from_path(&path);
    let key = nbpath::normalize_key(&path);
    let display_name = nbpath::basename(&path);
    let dir_path = nbpath::parent_dir(&path).unwrap_or_default();

    Ok(DocumentPayload {
        key,
        display_name,
        dir_path,
        kind,
        language,
        content: Some(result.content),
        encoding: result.encoding,
        eol: result.eol,
        size: result.size,
        mtime: result.mtime,
        readonly: result.readonly,
    })
}

/// 探测文件（读盘前）
#[tauri::command]
pub fn probe_document(path: String) -> Result<ProbeResult, String> {
    let p = Path::new(&path);

    if !p.exists() {
        return Ok(ProbeResult {
            exists: false,
            ..Default::default()
        });
    }

    if p.is_dir() {
        return Ok(ProbeResult {
            exists: true,
            is_dir: true,
            ..Default::default()
        });
    }

    let metadata = std::fs::metadata(p).map_err(|e| e.to_string())?;
    let (kind, _lang) = crate::dto::kind_from_path(&path);
    let is_text = read::is_text_file(p).unwrap_or(false);

    Ok(ProbeResult {
        size: metadata.len(),
        kind,
        is_text,
        exists: true,
        is_dir: false,
    })
}

/// 写入文档（原子写）
#[tauri::command]
pub fn write_document(
    path: String,
    content: String,
    encoding: crate::dto::Encoding,
    eol: crate::dto::Eol,
) -> Result<WriteResult, String> {
    let p = Path::new(&path);

    match write::write_with_encoding(p, &content, encoding, eol) {
        Ok((size, mtime)) => Ok(WriteResult {
            ok: true,
            mtime,
            size,
            error: None,
        }),
        Err(e) => Ok(WriteResult {
            ok: false,
            mtime: 0,
            size: 0,
            error: Some(e),
        }),
    }
}

/// 保存二进制文件（如粘贴或插入的图片，自动创建父级目录）
#[tauri::command]
pub fn save_binary_file(path: String, data: Vec<u8>) -> Result<WriteResult, String> {
    let p = Path::new(&path);

    // 确保目标父级目录存在
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建图片存储目录失败: {}", e))?;
        }
    }

    // 写入二进制字节数据
    std::fs::write(p, &data).map_err(|e| format!("写入二进制文件失败: {}", e))?;

    let metadata = std::fs::metadata(p).map_err(|e| e.to_string())?;
    let mtime = metadata
        .modified()
        .map(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        })
        .unwrap_or(0);

    Ok(WriteResult {
        ok: true,
        mtime: mtime as i64,
        size: metadata.len(),
        error: None,
    })
}

/// Prepare the exact directory selected by the explorer/open-document watcher.
/// A watch capability permits the command, but does not grant any filesystem scope.
#[tauri::command]
pub async fn prepare_directory_watch(app: tauri::AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = Path::new(&path);
        if !directory.is_absolute() || !directory.is_dir() {
            return Err(format!("无法监听目录: {path}"));
        }
        // Non-recursive: no disk-wide wildcard or implicit access to descendants.
        app.fs_scope().allow_directory(directory, false).map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

/// 读取目录
#[tauri::command]
pub async fn read_dir(path: String, show_hidden: bool) -> Result<Vec<FileTreeNode>, String> {
    tauri::async_runtime::spawn_blocking(move || dir::read_directory(Path::new(&path), show_hidden))
        .await.map_err(|error| error.to_string())?
}

/// 创建文件
#[tauri::command]
pub fn create_file(
    dir: String,
    name: String,
    template: String,
) -> Result<DocumentPayload, String> {
    let mut path = PathBuf::from(&dir);
    path.push(&name);

    // 检查是否已存在
    if path.exists() {
        return Err(format!("文件已存在: {}", path.display()));
    }

    // 创建文件
    std::fs::write(&path, "").map_err(|e| format!("创建文件失败: {}", e))?;

    // 读取返回
    let result = read::read_file(&path).map_err(|e| e.to_string())?;
    let (kind, language) = if template == "markdown" {
        (crate::dto::DocumentKind::Markdown, crate::dto::LanguageId::Markdown)
    } else if template == "board" {
        (crate::dto::DocumentKind::Board, crate::dto::LanguageId::Plaintext)
    } else {
        crate::dto::kind_from_path(&path.to_string_lossy())
    };

    let key = nbpath::normalize_key(&path.to_string_lossy());
    let display_name = nbpath::basename(&path.to_string_lossy());
    let dir_path = nbpath::parent_dir(&path.to_string_lossy()).unwrap_or_default();

    Ok(DocumentPayload {
        key,
        display_name,
        dir_path,
        kind,
        language,
        content: Some(result.content),
        encoding: result.encoding,
        eol: result.eol,
        size: result.size,
        mtime: result.mtime,
        readonly: result.readonly,
    })
}

/// 创建目录
#[tauri::command]
pub fn create_dir(dir: String, name: String) -> Result<(), String> {
    let mut path = PathBuf::from(&dir);
    path.push(&name);
    std::fs::create_dir(&path).map_err(|e| format!("创建目录失败: {}", e))
}

/// 重命名
#[tauri::command]
pub fn rename_path(
    state: tauri::State<'_, std::sync::Mutex<crate::state::AppState>>,
    label: String,
    from: String,
    to: String,
    expected_keys: Vec<String>,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "文档归属状态不可用".to_string())?;
    rename_registered_path(&mut state, &label, &from, &to, &expected_keys)
}

/// The filesystem rename and native identity commit share the registry lock.
/// Other windows and in-flight opens must finish first: their editor authority
/// has not been captured by this caller and cannot be moved on their behalf.
fn rename_registered_path(
    state: &mut crate::state::AppState,
    label: &str,
    from: &str,
    to: &str,
    expected_keys: &[String],
) -> Result<(), String> {
    let from_key = nbpath::normalize_key(from);
    // Preserve the requested filename's spelling for case-only renames.
    let to_key = to.replace('/', "\\");
    let from_lower = from_key.trim_end_matches('\\').to_lowercase();
    let to_lower = nbpath::normalize_key(to).trim_end_matches('\\').to_lowercase();
    let within = |key: &str, root: &str| key == root || key.strip_prefix(root).is_some_and(|tail| tail.starts_with('\\'));
    let expected: std::collections::HashSet<String> = expected_keys.iter()
        .map(|key| key.replace('/', "\\").to_lowercase()).collect();
    let mut moved = Vec::new();
    let prefix_parts = from_key.trim_end_matches('\\').split('\\').count();
    for (key, record) in &state.documents {
        if within(key, &from_lower) {
            if record.owner_window != label {
                return Err(format!("目录或文件仍在其它窗口打开（{}），请先关闭后重试", record.owner_window));
            }
            if !expected.contains(key) {
                return Err("重命名期间有文档刚被打开，请稍后重试".into());
            }
            let suffix = record.key.replace('/', "\\").split('\\').skip(prefix_parts).collect::<Vec<_>>().join("\\");
            let next = if suffix.is_empty() { to_key.clone() } else { format!("{}\\{}", to_key.trim_end_matches('\\'), suffix) };
            let mut migrated = record.clone();
            migrated.key = next.clone();
            migrated.lower_key = next.to_lowercase();
            if nbpath::extension(&record.key) != nbpath::extension(&next) {
                migrated.kind = crate::dto::kind_from_path(&next).0;
            }
            moved.push((key.clone(), migrated));
        } else if within(key, &to_lower) {
            return Err("目标路径已有打开的文档，请先关闭后重试".into());
        }
    }
    let pending_keys: Vec<_> = state.pending_prepares.keys().cloned().collect();
    for key in pending_keys {
        if (within(&key, &from_lower) || within(&key, &to_lower)) && state.live_pending_prepare(&key).is_some() {
            return Err("目录或文件正在打开，请稍后重试".into());
        }
    }
    if state.transfers.values().any(|transfer| {
        transfer.payload.is_some() && (within(&transfer.key.to_lowercase(), &from_lower) || within(&transfer.key.to_lowercase(), &to_lower))
    }) {
        return Err("目录或文件正在跨窗口迁移，请稍后重试".into());
    }
    if from_lower != to_lower && Path::new(to).exists() {
        return Err("目标路径已存在，未执行重命名".into());
    }
    std::fs::rename(from, to).map_err(|error| format!("重命名失败: {}", error))?;
    for (old, record) in moved {
        state.documents.remove(&old);
        state.documents.insert(record.lower_key.clone(), record);
    }
    Ok(())
}

/// 移到回收站
#[tauri::command]
pub fn move_to_trash(path: String) -> Result<(), String> {
    trash::move_to_trash(Path::new(&path))
}

/// 路径是否存在
#[tauri::command]
pub fn path_exists(path: String) -> Result<PathExistsResult, String> {
    let p = Path::new(&path);
    Ok(PathExistsResult {
        exists: p.exists(),
        is_dir: p.is_dir(),
    })
}

/// 在资源管理器中显示
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    // 用 std::process::Command 调用 explorer
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map_err(|e| format!("无法打开资源管理器: {}", e))?;
    Ok(())
}

/// 用系统默认程序打开
#[tauri::command]
pub fn open_with_default_app(path: String) -> Result<(), String> {
    // 用 Windows 的 start 命令
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("无法打开文件: {}", e))?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开文件: {}", e))?;
    }
    Ok(())
}


/// 取消监听
#[tauri::command]
pub fn unwatch_dir(_path: String) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod rename_tests {
    use super::*;
    use crate::{dto::DocumentKind, registry::documents::DocumentRegistry, state::AppState};

    #[test]
    fn rename_preserves_disk_body_and_native_dirty_owner() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("before.md");
        let target = directory.path().join("after.sql");
        std::fs::write(&source, "disk baseline").unwrap();
        let from = source.to_string_lossy().to_string();
        let to = target.to_string_lossy().to_string();
        let key = nbpath::normalize_key(&from);
        let mut state = AppState::default();
        DocumentRegistry::register(&mut state.documents, "window", &key, DocumentKind::Markdown);
        DocumentRegistry::set_dirty(&mut state.documents, &key, true);
        rename_registered_path(&mut state, "window", &from, &to, &[key.clone()]).unwrap();
        assert!(!source.exists());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "disk baseline");
        assert!(!state.documents.contains_key(&key.to_lowercase()));
        let moved = state.documents.get(&to.replace('/', "\\").to_lowercase()).unwrap();
        assert_eq!(moved.owner_window, "window");
        assert!(moved.is_dirty);
        assert_eq!(moved.kind, DocumentKind::Code);
    }

    #[test]
    fn rename_directory_refuses_foreign_or_uncaptured_open_children() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("before");
        let target = directory.path().join("after");
        std::fs::create_dir(&source).unwrap();
        let child = source.join("child.md");
        std::fs::write(&child, "body").unwrap();
        let key = nbpath::normalize_key(&child.to_string_lossy());
        let mut state = AppState::default();
        DocumentRegistry::register(&mut state.documents, "other", &key, DocumentKind::Markdown);
        assert!(rename_registered_path(&mut state, "window", &source.to_string_lossy(), &target.to_string_lossy(), &[key.clone()]).is_err());
        state.documents.get_mut(&key.to_lowercase()).unwrap().owner_window = "window".into();
        assert!(rename_registered_path(&mut state, "window", &source.to_string_lossy(), &target.to_string_lossy(), &[]).is_err());
        assert!(child.exists());
        assert!(!target.exists());
    }

    #[test]
    fn rename_refuses_existing_destination_without_overwriting_it() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.md");
        let target = directory.path().join("target.md");
        std::fs::write(&source, "source").unwrap();
        std::fs::write(&target, "target").unwrap();
        let mut state = AppState::default();
        assert!(rename_registered_path(&mut state, "window", &source.to_string_lossy(), &target.to_string_lossy(), &[]).is_err());
        assert_eq!(std::fs::read_to_string(source).unwrap(), "source");
        assert_eq!(std::fs::read_to_string(target).unwrap(), "target");
    }
}

#[cfg(test)]
mod image_asset_tests {
    use super::save_binary_file;

    #[test]
    fn binary_image_save_creates_fresh_recovery_and_document_directories() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2];
        for folder in ["recovery/.noteboard-assets", "documents/img"] {
            let target = directory.path().join(folder).join("image.png");
            assert!(!target.parent().unwrap().exists());
            let result = save_binary_file(target.to_string_lossy().to_string(), bytes.clone()).unwrap();
            assert!(result.ok);
            assert_eq!(std::fs::read(&target).unwrap(), bytes);
        }
    }
}
