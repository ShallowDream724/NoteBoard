//! Import undo moves the original copy out of the workspace without touching
//! its source. Redo moves that same copy back, with no destination replacement.
use super::{
    copy_entry::{copy_entry_with_proof, fingerprint_tree, ordinary, CopyProof},
    guarded_rename, trash,
};
use crate::state::AppState;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
};
use tauri::{Manager, WebviewWindow};

#[derive(serde::Serialize)]
pub struct ImportedPath {
    path: String,
    receipt: Option<String>,
}

struct StashedImport {
    directory: PathBuf,
    directory_identity: String,
    copy: PathBuf,
}

struct ImportRecord {
    path: PathBuf,
    parent_identity: String,
    proof: CopyProof,
    stashed: Option<StashedImport>,
}

struct OwnedReceipt {
    window: String,
    record: Arc<Mutex<ImportRecord>>,
}

static RECEIPTS: LazyLock<Mutex<HashMap<String, OwnedReceipt>>> = LazyLock::new(Mutex::default);
static LIVE_STASHES: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Mutex::default);
const STASH_PREFIX: &str = ".noteboard-import-recovery-";

fn key(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

pub(super) fn is_live_stash(path: &Path) -> bool {
    if !path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with(STASH_PREFIX))
    {
        return false;
    }
    let identity = LIVE_STASHES
        .lock()
        .ok()
        .and_then(|entries| entries.get(&key(&path.to_string_lossy())).cloned());
    identity.is_some_and(|expected| {
        guarded_rename::identity(path).is_some_and(|identity| identity == expected)
    })
}

fn contains(root: &str, path: &str) -> bool {
    root == path
        || path
            .strip_prefix(root)
            .is_some_and(|tail| tail.starts_with('\\'))
}

fn reject_busy_documents(
    state: &mut AppState,
    owner: &str,
    path: &Path,
    expected_keys: Option<&HashSet<String>>,
) -> Result<(), String> {
    if !state.windows.contains_key(owner) || state.is_closing(owner) {
        return Err("导入操作所属窗口已关闭".into());
    }
    let root = key(&path.to_string_lossy());
    for (document_key, record) in &state.documents {
        if contains(&root, document_key)
            && (record.owner_window != owner
                || record.is_dirty
                || expected_keys.is_some_and(|keys| !keys.contains(document_key)))
        {
            return Err(
                "导入副本包含在其他窗口打开、正在打开或尚未保存的文档，请处理后重试。".into(),
            );
        }
    }
    let pending: Vec<_> = state
        .pending_prepares
        .keys()
        .filter(|path| contains(&root, path))
        .cloned()
        .collect();
    if pending
        .iter()
        .any(|path| state.live_pending_prepare(path).is_some())
        || state
            .transfers
            .values()
            .any(|transfer| transfer.payload.is_some() && contains(&root, &key(&transfer.key)))
    {
        return Err("导入副本包含正在打开或迁移的文档，请稍后重试。".into());
    }
    Ok(())
}

impl ImportRecord {
    fn new(path: PathBuf, proof: CopyProof) -> Option<Self> {
        let parent = path.parent()?;
        ordinary(parent).ok()?.is_dir().then_some(())?;
        let parent_identity = guarded_rename::identity(parent)?;
        Some(Self {
            path,
            parent_identity,
            proof,
            stashed: None,
        })
    }

    fn check_parent(&self) -> Result<&Path, String> {
        let parent = self.path.parent().ok_or("无法确定导入位置")?;
        if ordinary(parent).is_ok_and(|metadata| metadata.is_dir())
            && guarded_rename::identity(parent).as_deref() == Some(self.parent_identity.as_str())
        {
            return Ok(parent);
        }
        Err("导入位置的文件夹已移动或被替换。".into())
    }

    fn matches_copy(&self, copy: &Path) -> bool {
        fingerprint_tree(copy).is_ok_and(|actual| actual == self.proof)
    }

    fn move_copy(&self, from: &Path, to: &Path) -> Result<(), String> {
        self.check_parent()?;
        guarded_rename::rename(from, to, Some(&self.proof.root_identity))?;
        Ok(())
    }

    fn undo(
        &mut self,
        relocate: impl FnOnce(&Self, &Path) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.stashed.is_some() {
            return Err("此导入副本已暂存。".into());
        }
        let parent = self.check_parent()?;
        let directory = tempfile::Builder::new()
            .prefix(STASH_PREFIX)
            .tempdir_in(parent)
            .map_err(|error| format!("无法创建导入暂存位置：{error}"))?;
        let directory_identity =
            guarded_rename::identity(directory.path()).ok_or("无法确认导入暂存位置")?;
        let copy = directory
            .path()
            .join(self.path.file_name().ok_or("无效的导入名称")?);
        // Keep the directory before moving data. TempDir's recursive cleanup
        // must never run on a directory once it can contain user data.
        let stashed = StashedImport {
            directory: directory.keep(),
            directory_identity,
            copy,
        };
        stashed.hide_while_tracked();
        if let Err(error) = relocate(self, &stashed.copy) {
            stashed.remove_empty();
            return Err(error);
        }
        if self.matches_copy(&stashed.copy) {
            self.stashed = Some(stashed);
            return Ok(());
        }
        if self.move_copy(&stashed.copy, &self.path).is_ok() {
            stashed.remove_empty();
            return Err("导入副本或其内容已改变，已保留在原位置。".into());
        }
        let message = format!(
            "导入副本已改变且原位置无法恢复，文件已保留在“{}”。",
            stashed.copy.display()
        );
        stashed.stop_hiding();
        self.stashed = Some(stashed);
        Err(message)
    }

    fn redo(
        &mut self,
        relocate: impl FnOnce(&Self, &Path) -> Result<(), String>,
    ) -> Result<(), String> {
        let stashed = self.stashed.as_ref().ok_or("此导入副本已在工作区。")?;
        if !stashed.directory_matches() || !self.matches_copy(&stashed.copy) {
            stashed.stop_hiding();
            return Err(format!(
                "暂存副本已改变或不可读取，已保留暂存位置“{}”。",
                stashed.directory.display()
            ));
        }
        relocate(self, &stashed.copy)?;
        if let Some(stashed) = self.stashed.take() {
            stashed.remove_empty();
        }
        Ok(())
    }

    fn recycle_released_copy(&self) {
        let Some(stashed) = &self.stashed else {
            return;
        };
        if self.check_parent().is_ok()
            && stashed.directory_matches()
            && fs::read_dir(&stashed.directory).is_ok_and(|mut entries| {
                entries
                    .next()
                    .is_some_and(|entry| entry.is_ok_and(|entry| entry.path() == stashed.copy))
                    && entries.next().is_none()
            })
            && self.matches_copy(&stashed.copy)
        {
            // Recycle the containing folder so the OS can restore it with the
            // copied item, even after the window's undo history is discarded.
            if let Err(error) = trash::move_to_trash(&stashed.directory) {
                log::warn!(
                    "导入暂存副本已保留在 {}：{}",
                    stashed.directory.display(),
                    error
                );
            }
        }
    }
}

impl StashedImport {
    fn hide_while_tracked(&self) {
        if let Ok(mut entries) = LIVE_STASHES.lock() {
            entries.insert(
                key(&self.directory.to_string_lossy()),
                self.directory_identity.clone(),
            );
        }
    }

    fn stop_hiding(&self) {
        if let Ok(mut entries) = LIVE_STASHES.lock() {
            let path = key(&self.directory.to_string_lossy());
            if entries.get(&path) == Some(&self.directory_identity) {
                entries.remove(&path);
            }
        }
    }

    fn directory_matches(&self) -> bool {
        ordinary(&self.directory).is_ok_and(|metadata| metadata.is_dir())
            && guarded_rename::identity(&self.directory).as_deref()
                == Some(self.directory_identity.as_str())
    }

    fn remove_empty(&self) {
        if self.directory_matches() {
            let _ = fs::remove_dir(&self.directory);
        }
    }
}

impl Drop for StashedImport {
    fn drop(&mut self) {
        self.stop_hiding();
    }
}

fn record_for(owner: &str, receipt: &str) -> Result<Arc<Mutex<ImportRecord>>, String> {
    RECEIPTS
        .lock()
        .ok()
        .and_then(|records| {
            records
                .get(receipt)
                .filter(|record| record.window == owner)
                .map(|record| Arc::clone(&record.record))
        })
        .ok_or_else(|| "导入记录不可用，请检查原文件和导入副本。".into())
}

#[tauri::command]
pub async fn copy_path_into_directory_with_receipt(
    window: WebviewWindow,
    source: String,
    directory: String,
) -> Result<ImportedPath, String> {
    let owner = window.label().to_owned();
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (path, proof) = copy_entry_with_proof(Path::new(&source), Path::new(&directory), true)?;
        let receipt = proof
            .and_then(|proof| ImportRecord::new(path.clone(), proof))
            .and_then(|record| {
                let state = app.state::<Mutex<AppState>>();
                let state = state.lock().ok()?;
                if !state.windows.contains_key(&owner) || state.is_closing(&owner) {
                    return None;
                }
                let receipt = uuid::Uuid::new_v4().to_string();
                RECEIPTS.lock().ok()?.insert(
                    receipt.clone(),
                    OwnedReceipt {
                        window: owner,
                        record: Arc::new(Mutex::new(record)),
                    },
                );
                Some(receipt)
            });
        Ok(ImportedPath {
            path: path.to_string_lossy().into_owned(),
            receipt,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn undo_copied_path(
    window: WebviewWindow,
    path: String,
    receipt: String,
    expected_keys: Option<Vec<String>>,
) -> Result<(), String> {
    let owner = window.label().to_owned();
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let record = record_for(&owner, &receipt)?;
        let mut record = record.lock().map_err(|_| "导入记录不可用")?;
        if key(&path) != key(&record.path.to_string_lossy()) {
            return Err("导入路径与当前记录不一致。".into());
        }
        let expected_keys = expected_keys
            .unwrap_or_default()
            .iter()
            .map(|path| key(path))
            .collect();
        record.undo(|record, target| {
            let state = app.state::<Mutex<AppState>>();
            let mut state = state.lock().map_err(|_| "文档归属状态不可用")?;
            reject_busy_documents(&mut state, &owner, &record.path, Some(&expected_keys))?;
            record.move_copy(&record.path, target)
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn redo_copied_path(
    window: WebviewWindow,
    path: String,
    receipt: String,
) -> Result<(), String> {
    let owner = window.label().to_owned();
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let record = record_for(&owner, &receipt)?;
        let mut record = record.lock().map_err(|_| "导入记录不可用")?;
        if key(&path) != key(&record.path.to_string_lossy()) {
            return Err("导入路径与当前记录不一致。".into());
        }
        record.redo(|record, source| {
            let state = app.state::<Mutex<AppState>>();
            let mut state = state.lock().map_err(|_| "文档归属状态不可用")?;
            reject_busy_documents(&mut state, &owner, &record.path, None)?;
            record.move_copy(source, &record.path)
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn release_copied_receipts(window: WebviewWindow, receipts: Vec<String>) {
    let receipts: HashSet<_> = receipts.into_iter().collect();
    let _ = release_matching(window.label(), |key| receipts.contains(key));
}

pub fn release_window(owner: &str) -> Option<tauri::async_runtime::JoinHandle<()>> {
    release_matching(owner, |_| true)
}

fn release_matching(
    owner: &str,
    selected: impl Fn(&str) -> bool,
) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let records = RECEIPTS
        .lock()
        .map(|mut receipts| {
            receipts
                .extract_if(|key, receipt| receipt.window == owner && selected(key))
                .map(|(_, receipt)| receipt.record)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    (!records.is_empty()).then(|| {
        tauri::async_runtime::spawn_blocking(move || {
            for record in records {
                if let Ok(record) = record.lock() {
                    record.recycle_released_copy();
                }
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{dto::DocumentKind, registry::documents::DocumentRegistry};

    fn tracked(source: &Path, workspace: &Path) -> ImportRecord {
        let (path, proof) = copy_entry_with_proof(source, workspace, true).unwrap();
        ImportRecord::new(path, proof.unwrap()).unwrap()
    }

    fn undo(record: &mut ImportRecord) -> Result<(), String> {
        record.undo(|entry, target| entry.move_copy(&entry.path, target))
    }

    fn redo(record: &mut ImportRecord) -> Result<(), String> {
        record.redo(|entry, source| entry.move_copy(source, &entry.path))
    }

    #[test]
    fn restores_the_same_copy_across_cycles_without_consulting_the_source() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("external.txt");
        let workspace = root.path().join("workspace");
        fs::write(&source, "imported").unwrap();
        fs::create_dir(&workspace).unwrap();
        let mut record = tracked(&source, &workspace);
        undo(&mut record).unwrap();
        assert!(!record.path.exists());
        fs::write(&source, "changed outside").unwrap();
        fs::write(&record.path, "new project file").unwrap();
        assert!(redo(&mut record).is_err());
        assert_eq!(
            fs::read_to_string(&record.path).unwrap(),
            "new project file"
        );
        fs::remove_file(&record.path).unwrap();
        redo(&mut record).unwrap();
        undo(&mut record).unwrap();
        redo(&mut record).unwrap();
        assert_eq!(fs::read_to_string(&record.path).unwrap(), "imported");
        assert_eq!(fs::read_to_string(&source).unwrap(), "changed outside");
    }

    #[test]
    fn edited_imports_and_replacements_are_left_in_place() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("notes");
        let workspace = root.path().join("workspace");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&workspace).unwrap();
        fs::write(source.join("original"), "before").unwrap();
        let mut record = tracked(&source, &workspace);

        fs::write(record.path.join("new"), "new content").unwrap();
        assert!(undo(&mut record).unwrap_err().contains("已改变"));
        assert_eq!(
            fs::read_to_string(record.path.join("new")).unwrap(),
            "new content"
        );
        fs::remove_file(record.path.join("new")).unwrap();
        fs::write(record.path.join("original"), "after!").unwrap();
        assert!(undo(&mut record).unwrap_err().contains("已改变"));
        assert_eq!(
            fs::read_to_string(record.path.join("original")).unwrap(),
            "after!"
        );

        let prior = workspace.join("prior-copy");
        fs::rename(&record.path, &prior).unwrap();
        fs::create_dir(&record.path).unwrap();
        fs::write(record.path.join("original"), "before").unwrap();
        assert!(undo(&mut record).is_err());
        assert_eq!(
            fs::read_to_string(record.path.join("original")).unwrap(),
            "before"
        );
        assert_eq!(
            fs::read_to_string(prior.join("original")).unwrap(),
            "after!"
        );
        assert_eq!(
            fs::read_to_string(source.join("original")).unwrap(),
            "before"
        );
    }

    #[test]
    fn only_the_registered_recovery_directory_is_hidden() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("external.txt");
        let workspace = root.path().join("workspace");
        fs::write(&source, "imported").unwrap();
        fs::create_dir(&workspace).unwrap();
        fs::create_dir(workspace.join(format!("{STASH_PREFIX}owned-by-user"))).unwrap();

        let mut record = tracked(&source, &workspace);
        undo(&mut record).unwrap();
        let stashed = record.stashed.as_ref().unwrap().directory.clone();
        assert!(is_live_stash(&stashed));
        let entries = super::super::dir::read_directory(&workspace, true).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, format!("{STASH_PREFIX}owned-by-user"));
        redo(&mut record).unwrap();
        assert!(!is_live_stash(&stashed));
    }

    #[test]
    fn undo_allows_only_captured_clean_documents_from_the_same_window() {
        let mut state = AppState::for_startup();
        let root = Path::new(r"C:\workspace\imported");
        let child = r"C:\workspace\imported\test.txt";
        DocumentRegistry::register(&mut state.documents, "nb-main", child, DocumentKind::Code);
        let child = key(child);
        let captured = HashSet::from([child.clone()]);
        assert!(reject_busy_documents(&mut state, "nb-main", root, Some(&captured)).is_ok());
        assert!(reject_busy_documents(&mut state, "nb-main", root, Some(&HashSet::new())).is_err());
        state.documents.get_mut(&child).unwrap().is_dirty = true;
        assert!(reject_busy_documents(&mut state, "nb-main", root, Some(&captured)).is_err());
        let record = state.documents.get_mut(&child).unwrap();
        record.is_dirty = false;
        record.owner_window = "nb-other".into();
        assert!(reject_busy_documents(&mut state, "nb-main", root, Some(&captured)).is_err());
    }
}
