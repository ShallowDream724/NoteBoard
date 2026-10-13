//! Explorer imports copy through a private staging directory. Sources are never
//! removed, existing destinations never replaced, and bytes stream from disk.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

fn ordinary(path: &Path) -> Result<fs::Metadata, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("暂不复制链接或目录联接，请选择实际文件夹".into());
        }
    }
    if meta.file_type().is_symlink() || !(meta.is_file() || meta.is_dir()) {
        return Err("暂不复制链接或特殊文件".into());
    }
    Ok(meta)
}

fn copy_tree(source: &Path, target: &Path, depth: usize, count: &mut usize) -> Result<(), String> {
    *count += 1;
    if depth > 128 || *count > 100_000 {
        return Err("文件夹层级或文件数量过多，请分批复制".into());
    }
    let meta = ordinary(source)?;
    if meta.is_dir() {
        fs::create_dir(target).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_tree(
                &entry.path(),
                &target.join(entry.file_name()),
                depth + 1,
                count,
            )?;
        }
    } else {
        let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|e| e.to_string())?;
        io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn copy_entry(source: &Path, directory: &Path) -> Result<PathBuf, String> {
    let source_kind = ordinary(source)?;
    let parent = dunce::canonicalize(directory).map_err(|e| format!("目标文件夹不可用: {e}"))?;
    if !parent.is_dir() {
        return Err("目标必须是文件夹".into());
    }
    let source = dunce::canonicalize(source).map_err(|e| e.to_string())?;
    if source_kind.is_dir() && contains_directory(&source, &parent) {
        return Err("不能把文件夹复制到它自己或子文件夹中".into());
    }
    let name = source.file_name().ok_or("不能复制磁盘根目录")?;
    let destination = parent.join(name);
    if fs::symlink_metadata(&destination).is_ok() {
        return Err("目标文件夹已有同名项目，未覆盖任何文件".into());
    }
    let staging = tempfile::Builder::new()
        .prefix(".noteboard-copy-")
        .tempdir_in(&parent)
        .map_err(|e| e.to_string())?;
    let staged = staging.path().join(name);
    copy_tree(&source, &staged, 0, &mut 0)?;
    // Windows rename refuses an existing destination, including a file created
    // concurrently after the initial collision check.
    if fs::symlink_metadata(&destination).is_ok() {
        return Err("目标文件夹已有同名项目，未覆盖任何文件".into());
    }
    fs::rename(&staged, &destination).map_err(|e| format!("复制失败: {e}"))?;
    Ok(destination)
}

fn contains_directory(source: &Path, destination: &Path) -> bool {
    #[cfg(windows)]
    {
        // Windows paths are case insensitive. Compare components so a sibling
        // named notes-2 is never mistaken for a descendant of notes.
        let source: Vec<_> = source
            .components()
            .map(|part| part.as_os_str().to_string_lossy().to_lowercase())
            .collect();
        let destination: Vec<_> = destination
            .components()
            .map(|part| part.as_os_str().to_string_lossy().to_lowercase())
            .collect();
        destination.starts_with(&source)
    }
    #[cfg(not(windows))]
    destination.starts_with(source)
}

#[tauri::command]
pub async fn copy_path_into_directory(source: String, directory: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_entry(Path::new(&source), Path::new(&directory))
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copies_tree_without_touching_source_or_overwriting_destination() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("notes");
        fs::create_dir(&source).unwrap();
        fs::create_dir(source.join("nested")).unwrap();
        fs::write(source.join("nested/a.md"), "hello").unwrap();
        let destination = root.path().join("workspace");
        fs::create_dir(&destination).unwrap();
        copy_entry(&source, &destination).unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("notes/nested/a.md")).unwrap(),
            "hello"
        );
        fs::write(source.join("nested/a.md"), "new source").unwrap();
        assert!(copy_entry(&source, &destination)
            .unwrap_err()
            .contains("同名"));
        assert_eq!(
            fs::read_to_string(destination.join("notes/nested/a.md")).unwrap(),
            "hello"
        );
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 1);
    }
    #[test]
    fn rejects_descendants_before_creating_a_staging_directory() {
        let root = tempfile::tempdir().unwrap();
        let child = root.path().join("child");
        fs::create_dir(&child).unwrap();
        assert!(copy_entry(root.path(), &child)
            .unwrap_err()
            .contains("自己"));
        assert_eq!(fs::read_dir(child).unwrap().count(), 0);
    }
    #[cfg(windows)]
    #[test]
    fn descendant_guard_ignores_case_but_respects_component_boundaries() {
        assert!(contains_directory(
            Path::new("C:\\Work\\Notes"),
            Path::new("c:\\work\\notes\\Nested")
        ));
        assert!(!contains_directory(
            Path::new("C:\\Work\\Notes"),
            Path::new("c:\\work\\notes-2")
        ));
    }
}
