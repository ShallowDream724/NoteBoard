//! Image exports use a raw binary IPC body and the shared atomic writer.
use std::path::Path;
use crate::dto::WriteResult;

fn write_export(path: &Path, data: &[u8]) -> Result<WriteResult, String> {
    if !path.is_absolute() { return Err("图片保存路径必须是绝对路径".into()); }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let matches = match extension.as_str() {
        "png" => data.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => data.starts_with(b"\xff\xd8\xff"),
        "webp" => data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP"),
        _ => return Err("请选择 PNG、JPEG 或 WebP 文件".into()),
    };
    if !matches { return Err("图片内容与文件格式不匹配，未写入文件".into()); }
    super::write::atomic_write(path, data).map_err(|error| error.to_string())?;
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    let mtime = metadata.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|value| value.as_millis() as i64).unwrap_or(0);
    Ok(WriteResult { ok: true, mtime, size: metadata.len(), error: None })
}

#[tauri::command]
pub async fn write_image_edit(request: tauri::ipc::Request<'_>) -> Result<WriteResult, String> {
    let metadata = request.headers().get("x-noteboard-image-edit").and_then(|value| value.to_str().ok()).ok_or("缺少图片保存路径")?;
    let parameters: std::collections::HashMap<_, _> = url::form_urlencoded::parse(metadata.as_bytes()).into_owned().collect();
    let path = parameters.get("path").filter(|value| !value.is_empty()).ok_or("图片保存路径无效")?.clone();
    let data = match request.body() { tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(), _ => return Err("图片需要二进制载荷".into()) };
    tauri::async_runtime::spawn_blocking(move || write_export(Path::new(&path), &data)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mismatched_format_never_replaces_original() {
        let root = tempfile::tempdir().unwrap(); let target = root.path().join("photo.png");
        std::fs::write(&target, b"original").unwrap();
        assert!(write_export(&target, b"not a png").is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        assert!(write_export(Path::new("relative.png"), b"\x89PNG\r\n\x1a\n").is_err());
    }
    #[test]
    fn exports_encoded_bytes_atomically_without_reencoding() {
        let root = tempfile::tempdir().unwrap();
        for (extension, bytes) in [("png", b"\x89PNG\r\n\x1a\nencoded".as_slice()), ("jpg", b"\xff\xd8\xffencoded".as_slice()), ("webp", b"RIFF1234WEBPencoded".as_slice())] {
            let target = root.path().join(format!("edited.{extension}"));
            let result = write_export(&target, bytes).unwrap();
            assert!(result.ok); assert_eq!(result.size, bytes.len() as u64);
            assert_eq!(std::fs::read(target).unwrap(), bytes);
        }
    }
}
