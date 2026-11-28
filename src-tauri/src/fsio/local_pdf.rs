use crate::{dto::DocumentKind, path::lower_key, state::AppState};
use serde::{Deserialize, Serialize};
use std::fs::{File, Metadata};
use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{ipc::Response, State, WebviewWindow};

const MAX_RANGE: usize = 1024 * 1024;

#[derive(Deserialize, PartialEq, Serialize)]
pub struct PdfSnapshot {
    size: u64,
    // Keep full filesystem timestamp precision without serializing a JS number.
    version: String,
}

fn snapshot(metadata: Metadata) -> Result<PdfSnapshot, String> {
    if !metadata.is_file() {
        return Err("此路径不是 PDF 文件。".into());
    }
    let version = metadata.modified().map_err(read_error)?;
    let version = match version.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_nanos().to_string(),
        Err(error) => format!("-{}", error.duration().as_nanos()),
    };
    Ok(PdfSnapshot {
        size: metadata.len(),
        version,
    })
}

fn read_error(error: std::io::Error) -> String {
    format!("无法读取 PDF 文件：{error}")
}

fn registered_path(state: &Mutex<AppState>, label: &str, key: &str) -> Result<String, String> {
    let state = state.lock().unwrap();
    state
        .documents
        .get(&lower_key(key))
        .filter(|record| record.owner_window == label && record.kind == DocumentKind::Pdf)
        .map(|record| record.key.clone())
        .ok_or_else(|| "当前窗口未打开此 PDF 文件。".into())
}

#[tauri::command]
pub async fn local_pdf_metadata(
    window: WebviewWindow,
    state: State<'_, Mutex<AppState>>,
    key: String,
) -> Result<PdfSnapshot, String> {
    let path = registered_path(&state, window.label(), &key)?;
    tauri::async_runtime::spawn_blocking(move || {
        snapshot(std::fs::metadata(path).map_err(read_error)?)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn read_range(
    mut file: File,
    expected: PdfSnapshot,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    if length == 0
        || length > MAX_RANGE
        || offset.checked_add(length as u64).is_none_or(|end| end > expected.size)
    {
        return Err("PDF 读取范围无效。".into());
    }
    let verify_snapshot = |file: &File| {
        if snapshot(file.metadata().map_err(read_error)?)? == expected {
            Ok(())
        } else {
            Err("PDF 文件已变更，请重新加载。".to_string())
        }
    };
    verify_snapshot(&file)?;
    file.seek(SeekFrom::Start(offset)).map_err(read_error)?;
    let mut bytes = vec![0; length];
    file.read_exact(&mut bytes).map_err(read_error)?;
    verify_snapshot(&file)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn read_local_pdf_range(
    window: WebviewWindow,
    state: State<'_, Mutex<AppState>>,
    key: String,
    expected: PdfSnapshot,
    offset: u64,
    length: usize,
) -> Result<Response, String> {
    let path = registered_path(&state, window.label(), &key)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_range(File::open(path).map_err(read_error)?, expected, offset, length)
            .map(Response::new)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::documents::DocumentRegistry;

    #[test]
    fn range_reads_only_the_requested_bytes_and_rejects_changed_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("paper.pdf");
        std::fs::write(&path, b"0123456789").unwrap();
        let expected = || snapshot(std::fs::metadata(&path).unwrap()).unwrap();
        let open = || File::open(&path).unwrap();
        assert_eq!(read_range(open(), expected(), 2, 3).unwrap(), b"234");
        assert!(read_range(open(), expected(), 9, 2).is_err());
        assert!(read_range(open(), expected(), 0, MAX_RANGE + 1).is_err());
        let old = expected();
        std::fs::write(&path, b"other content").unwrap();
        assert!(read_range(open(), old, 2, 3).is_err());
    }

    #[test]
    fn only_the_registered_pdf_owner_can_read() {
        let mut state = AppState::default();
        let key = "C:\\notes\\paper.pdf";
        DocumentRegistry::register(&mut state.documents, "reader", key, DocumentKind::Pdf);
        let state = Mutex::new(state);
        assert_eq!(registered_path(&state, "reader", key).unwrap(), key);
        assert!(registered_path(&state, "another", key).is_err());
        assert!(registered_path(&state, "reader", "C:\\notes\\other.pdf").is_err());
    }
}
