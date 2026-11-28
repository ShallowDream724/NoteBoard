//! Explorer imports copy through a private staging directory. Sources are never
//! removed, existing destinations never replaced, and bytes stream from disk.
use super::guarded_rename;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

const MAX_DEPTH: usize = 128;
const MAX_ENTRIES: usize = 100_000;

pub(super) fn ordinary(path: &Path) -> Result<fs::Metadata, String> {
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

#[derive(PartialEq, Eq)]
pub(super) struct CopyProof {
    pub root_identity: String,
    digest: [u8; 32],
}

#[derive(Default)]
struct Fingerprint {
    digest: Sha256,
    last_identity: String,
}

impl Fingerprint {
    fn finish_node(&mut self, path: &Path, data: Option<[u8; 32]>) -> Option<()> {
        let meta = ordinary(path).ok()?;
        if meta.is_file() != data.is_some() {
            return None;
        }
        let identity = guarded_rename::identity(path)?;
        let name = path.file_name()?.as_encoded_bytes();
        self.digest.update(if data.is_some() { b"F" } else { b"D" });
        self.digest.update((name.len() as u64).to_le_bytes());
        self.digest.update(name);
        self.digest.update((identity.len() as u64).to_le_bytes());
        self.digest.update(identity.as_bytes());
        self.digest
            .update([u8::from(meta.permissions().readonly())]);
        if let Some(data) = data {
            self.digest.update(meta.len().to_le_bytes());
            let modified = meta
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?;
            self.digest.update(modified.as_nanos().to_le_bytes());
            self.digest.update(data);
        }
        self.last_identity = identity;
        Some(())
    }

    fn finish(self) -> CopyProof {
        CopyProof {
            root_identity: self.last_identity,
            digest: self.digest.finalize().into(),
        }
    }
}

fn finish_fingerprint(proof: &mut Option<Fingerprint>, path: &Path, data: Option<[u8; 32]>) {
    if let Some(record) = proof.as_mut() {
        if record.finish_node(path, data).is_none() {
            *proof = None;
        }
    }
}

fn visit_node(depth: usize, count: &mut usize) -> Result<(), String> {
    *count += 1;
    if depth > MAX_DEPTH || *count > MAX_ENTRIES {
        Err("文件夹层级或文件数量过多，请分批复制".into())
    } else {
        Ok(())
    }
}

fn ordered_children(path: &Path, remaining: usize) -> Result<Vec<fs::DirEntry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        if entries.len() >= remaining {
            return Err("文件夹层级或文件数量过多，请分批复制".into());
        }
        entries.push(entry.map_err(|error| error.to_string())?);
    }
    entries.sort_by_cached_key(fs::DirEntry::file_name);
    Ok(entries)
}

struct HashReader<'a, R> {
    reader: R,
    digest: &'a mut Sha256,
}

impl<R: Read> Read for HashReader<'_, R> {
    fn read(&mut self, data: &mut [u8]) -> io::Result<usize> {
        let bytes_read = self.reader.read(data)?;
        self.digest.update(&data[..bytes_read]);
        Ok(bytes_read)
    }
}

fn copy_tree(
    source: &Path,
    target: &Path,
    depth: usize,
    count: &mut usize,
    proof: &mut Option<Fingerprint>,
) -> Result<(), String> {
    visit_node(depth, count)?;
    let meta = ordinary(source)?;
    if meta.is_dir() {
        fs::create_dir(target).map_err(|e| e.to_string())?;
        if let Some(proof) = proof.as_mut() {
            proof.digest.update(b"[");
        }
        for entry in ordered_children(source, MAX_ENTRIES - *count)? {
            copy_tree(
                &entry.path(),
                &target.join(entry.file_name()),
                depth + 1,
                count,
                proof,
            )?;
        }
        finish_fingerprint(proof, target, None);
    } else {
        let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|e| e.to_string())?;
        let digest = if proof.is_some() {
            let mut digest = Sha256::new();
            io::copy(
                &mut HashReader {
                    reader: input,
                    digest: &mut digest,
                },
                &mut output,
            )
            .map_err(|e| e.to_string())?;
            Some(digest.finalize().into())
        } else {
            io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
            None
        };
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        finish_fingerprint(proof, target, digest);
    }
    Ok(())
}

pub fn copy_entry(source: &Path, directory: &Path) -> Result<PathBuf, String> {
    copy_entry_with_proof(source, directory, false).map(|(path, _)| path)
}

pub(super) fn copy_entry_with_proof(
    source: &Path,
    directory: &Path,
    tracked: bool,
) -> Result<(PathBuf, Option<CopyProof>), String> {
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
    let mut proof = tracked.then(Fingerprint::default);
    copy_tree(&source, &staged, 0, &mut 0, &mut proof)?;
    // Windows rename refuses an existing destination, including a file created
    // concurrently after the initial collision check.
    if fs::symlink_metadata(&destination).is_ok() {
        return Err("目标文件夹已有同名项目，未覆盖任何文件".into());
    }
    fs::rename(&staged, &destination).map_err(|e| format!("复制失败: {e}"))?;
    Ok((destination, proof.map(Fingerprint::finish)))
}

pub(super) fn fingerprint_tree(path: &Path) -> Result<CopyProof, String> {
    let mut proof = Some(Fingerprint::default());
    scan_tree(path, 0, &mut 0, &mut proof)?;
    proof
        .map(Fingerprint::finish)
        .ok_or_else(|| "无法核对导入副本".into())
}

fn scan_tree(
    path: &Path,
    depth: usize,
    count: &mut usize,
    proof: &mut Option<Fingerprint>,
) -> Result<(), String> {
    visit_node(depth, count)?;
    if proof.is_none() {
        return Err("无法核对导入副本".into());
    }
    let meta = ordinary(path)?;
    if meta.is_dir() {
        proof.as_mut().unwrap().digest.update(b"[");
        for entry in ordered_children(path, MAX_ENTRIES - *count)? {
            scan_tree(&entry.path(), depth + 1, count, proof)?;
        }
        if ordinary(path)?.modified().ok() != meta.modified().ok() {
            return Err("导入文件夹正在被修改".into());
        }
        finish_fingerprint(proof, path, None);
    } else {
        let input = fs::File::open(path).map_err(|error| error.to_string())?;
        let mut digest = Sha256::new();
        let count = io::copy(
            &mut HashReader {
                reader: (&input).take(meta.len().saturating_add(1)),
                digest: &mut digest,
            },
            &mut io::sink(),
        )
        .map_err(|error| error.to_string())?;
        let after = input.metadata().map_err(|error| error.to_string())?;
        if count != meta.len()
            || after.len() != count
            || after.modified().ok() != meta.modified().ok()
        {
            return Err("导入副本正在被修改".into());
        }
        finish_fingerprint(proof, path, Some(digest.finalize().into()));
    }
    Ok(())
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
