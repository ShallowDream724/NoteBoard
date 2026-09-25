use sha2::{Digest, Sha256};
use std::{fs::File, io::{Read, Write}, path::Path};

fn image_extension(extension: &str) -> bool { matches!(extension, "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "avif" | "ico") }
fn commit_image(temporary: tempfile::NamedTempFile, target: &Path, expected: &str) -> Result<(), String> {
    temporary.as_file().sync_all().map_err(|error| error.to_string())?;
    if let Err(error) = temporary.persist_noclobber(target) {
        if !target.exists() || digest(target)? != expected { return Err(format!("无法保存图片：{}", error.error)); }
    }
    Ok(())
}
fn store_bytes(directory: &Path, extension: &str, data: &[u8]) -> Result<String, String> {
    if !directory.is_absolute() { return Err("图片目录需要绝对路径".into()); }
    if !image_extension(extension) { return Err("图片扩展名无效".into()); }
    let hash = format!("{:x}", Sha256::digest(data));
    let filename = format!("{}.{}", hash, extension);
    let target = directory.join(&filename);
    if target.exists() {
        if digest(&target)? != hash { return Err("已有图片内容与资源标识不一致，未覆盖文件".into()); }
        return Ok(filename);
    }
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(|error| error.to_string())?;
    temporary.write_all(data).map_err(|error| error.to_string())?;
    commit_image(temporary, &target, &hash)?;
    Ok(filename)
}

#[tauri::command]
pub async fn store_image_asset(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    // Tauri 2 carries Uint8Array as a raw IPC body on desktop. Headers contain
    // only URI-encoded metadata, so Unicode/custom staging paths stay valid.
    let metadata = request.headers().get("x-noteboard-image").and_then(|value| value.to_str().ok()).ok_or("缺少图片目录参数")?;
    let parameters: std::collections::HashMap<_, _> = url::form_urlencoded::parse(metadata.as_bytes()).into_owned().collect();
    let directory = parameters.get("directory").filter(|value| !value.is_empty()).ok_or("图片目录无效")?.clone();
    let extension = parameters.get("extension").ok_or("图片扩展名无效")?.clone();
    let data = match request.body() { tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(), _ => return Err("图片需要二进制载荷".into()) };
    tauri::async_runtime::spawn_blocking(move || store_bytes(Path::new(&directory), &extension, &data))
        .await.map_err(|error| error.to_string())?
}

fn digest(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("无法读取图片 {}：{}", path.display(), error))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn publish(source: &Path, directory: &Path) -> Result<String, String> {
    if !source.is_absolute() || !directory.is_absolute() { return Err("恢复图片与目标目录需要绝对路径".into()); }
    let filename = source.file_name().and_then(|name| name.to_str()).ok_or("恢复图片路径无效")?;
    let stem = source.file_stem().and_then(|name| name.to_str()).ok_or("恢复图片路径无效")?;
    let extension = source.extension().and_then(|name| name.to_str()).unwrap_or("");
    if source.parent().and_then(Path::file_name).and_then(|name| name.to_str()) != Some(".noteboard-assets")
        || stem.len() != 64 || !stem.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !image_extension(extension) {
        return Err("仅可发布 NoteBoard 恢复图片".into());
    }
    let target = directory.join(filename);
    if target.exists() {
        if digest(source)? != stem || digest(&target)? != stem { return Err("图片内容与资源标识不一致，已保留现有文件".into()); }
        return Ok(filename.into());
    }
    std::fs::create_dir_all(directory).map_err(|error| format!("无法创建图片目录：{}", error))?;
    let mut input = File::open(source).map_err(|error| format!("无法读取恢复图片 {}：{}", source.display(), error))?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
        temporary.write_all(&buffer[..count]).map_err(|error| error.to_string())?;
    }
    if format!("{:x}", hash.finalize()) != stem { return Err("恢复图片内容已改变，未发布图片".into()); }
    // A concurrent save may publish identical content, but cannot replace an
    // unrelated destination or remove the durable recovery source.
    commit_image(temporary, &target, stem)?;
    Ok(filename.into())
}

/** The source is a durable recovery asset, including a user-selected staging
 * directory from an earlier process. No plugin-fs scope or JS binary copy. */
#[tauri::command]
pub async fn publish_recovery_image(source: String, directory: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || publish(Path::new(&source), Path::new(&directory)))
        .await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stores_data_images_once_and_refuses_an_existing_wrong_hash() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("fresh/.noteboard-assets");
        let filename = store_bytes(&target, "png", b"image bytes").unwrap();
        assert_eq!(store_bytes(&target, "png", b"image bytes").unwrap(), filename);
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 1);
        std::fs::write(target.join(&filename), b"different").unwrap();
        assert!(store_bytes(&target, "png", b"image bytes").is_err());
        assert_eq!(std::fs::read(target.join(filename)).unwrap(), b"different");
    }
    #[test]
    fn publishes_custom_recovery_directory_without_overwrite_or_source_deletion() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = directory.path().join("custom/recovery/.noteboard-assets");
        std::fs::create_dir_all(&recovery).unwrap();
        let bytes = vec![42u8; 256 * 1024 + 9];
        let filename = format!("{:x}.png", Sha256::digest(&bytes));
        let source = recovery.join(&filename);
        std::fs::write(&source, &bytes).unwrap();
        let target = directory.path().join("new-document/img");
        assert_eq!(publish(&source, &target).unwrap(), filename);
        assert_eq!(publish(&source, &target).unwrap(), filename);
        assert_eq!(std::fs::read(target.join(&filename)).unwrap(), bytes);
        assert!(source.exists());
        std::fs::write(target.join(&filename), "different image").unwrap();
        assert!(publish(&source, &target).is_err());
        assert_eq!(std::fs::read_to_string(target.join(&filename)).unwrap(), "different image");
    }
    #[test]
    fn missing_or_modified_recovery_images_never_publish_a_target() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = directory.path().join(".noteboard-assets");
        std::fs::create_dir(&recovery).unwrap();
        let source = recovery.join(format!("{}.png", "a".repeat(64)));
        let target = directory.path().join("img");
        assert!(publish(&source, &target).is_err());
        std::fs::write(&source, "wrong content").unwrap();
        assert!(publish(&source, &target).is_err());
        assert!(!target.join(source.file_name().unwrap()).exists());
    }
}
