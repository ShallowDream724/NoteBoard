use std::{
    collections::VecDeque,
    io,
    path::Path,
    sync::{LazyLock, Mutex},
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveGuard {
    pub expected_identity: Option<String>,
}

struct MovedFile {
    current: String,
    issued: VecDeque<String>,
}

// Only IDs handed to the filesystem-operation history are retained. Saving
// repeatedly advances the current ID without adding an entry for every save.
static MOVED_FILES: LazyLock<Mutex<VecDeque<MovedFile>>> = LazyLock::new(Mutex::default);
const MAX_MOVED_FILES: usize = 1024;
const MAX_ISSUED_IDS: usize = 128;

pub fn rename(from: &Path, to: &Path, expected: Option<&str>) -> Result<Option<String>, String> {
    platform::rename(from, to, expected, |_, _| false)
}

pub(super) fn rename_document(
    from: &Path,
    to: &Path,
    expected: Option<&str>,
) -> Result<Option<String>, String> {
    let Ok(mut moved) = MOVED_FILES.lock() else {
        return rename(from, to, expected);
    };
    let actual = platform::rename(from, to, expected, |expected, actual| {
        moved
            .iter()
            .any(|entry| entry.current == actual && entry.issued.iter().any(|id| id == expected))
    })?;
    if let Some(actual) = actual.as_ref().filter(|_| expected.is_none()) {
        let mut entry = moved
            .iter()
            .position(|entry| &entry.current == actual)
            .and_then(|index| moved.remove(index))
            .unwrap_or_else(|| MovedFile {
                current: actual.clone(),
                issued: VecDeque::new(),
            });
        if !entry.issued.contains(actual) {
            entry.issued.push_back(actual.clone());
            if entry.issued.len() > MAX_ISSUED_IDS {
                entry.issued.pop_front();
            }
        }
        moved.push_back(entry);
        if moved.len() > MAX_MOVED_FILES {
            moved.pop_front();
        }
    }
    Ok(actual)
}

pub(super) fn persist_document(temporary: tempfile::TempPath, target: &Path) -> io::Result<()> {
    #[cfg(windows)]
    if let Ok(mut moved) = MOVED_FILES.lock() {
        if !moved.is_empty() {
            if let Some(before) = identity(target) {
                if let Some(index) = moved.iter().position(|entry| entry.current == before) {
                    if let Some((replaced, new_id)) =
                        platform::replace_with_proof(&temporary, target, &before)?
                    {
                        if replaced.as_deref() == Some(before.as_str()) {
                            let mut entry = moved.remove(index).expect("tracked replacement");
                            entry.current = new_id;
                            moved.push_back(entry);
                        }
                        return Ok(());
                    }
                }
            }
        }
        // Keep ordinary saves serialized with the handle check above, including
        // when a new movement issues an identity along the same path.
        return temporary.persist(target).map_err(|error| error.error);
    }
    temporary.persist(target).map_err(|error| error.error)
}

#[cfg(windows)]
mod platform {
    use super::Path;
    use std::{
        fs::OpenOptions,
        io,
        mem::{offset_of, size_of},
        os::windows::{
            ffi::OsStrExt,
            fs::{MetadataExt, OpenOptionsExt},
            io::AsRawHandle,
        },
        ptr::copy_nonoverlapping,
    };
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::HANDLE,
            Storage::FileSystem::{
                FileIdInfo, FileRenameInfo, GetFileInformationByHandle,
                GetFileInformationByHandleEx, MoveFileExW, ReplaceFileW, SetFileAttributesW,
                SetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, DELETE,
                FILE_ATTRIBUTE_NORMAL, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
                FILE_ID_INFO, FILE_READ_ATTRIBUTES, FILE_RENAME_INFO, FILE_SHARE_DELETE,
                FILE_SHARE_READ, FILE_SHARE_WRITE, MOVE_FILE_FLAGS, REPLACE_FILE_FLAGS,
            },
        },
    };

    fn read_identity(handle: HANDLE) -> Option<String> {
        let mut info = FILE_ID_INFO::default();
        let result = unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileIdInfo,
                (&mut info as *mut FILE_ID_INFO).cast(),
                size_of::<FILE_ID_INFO>() as u32,
            )
        };
        if result.is_ok() && info.FileId.Identifier.iter().any(|byte| *byte != 0) {
            return Some(format!(
                "id:{:016x}:{:032x}",
                info.VolumeSerialNumber,
                u128::from_le_bytes(info.FileId.Identifier)
            ));
        }
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        // Some filesystems and SMB implementations only support the 64-bit index.
        unsafe { GetFileInformationByHandle(handle, &mut info) }.ok()?;
        (info.nFileIndexHigh != 0 || info.nFileIndexLow != 0).then(|| {
            format!(
                "index:{:08x}:{:08x}{:08x}",
                info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
            )
        })
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain([0]).collect()
    }

    pub fn identity(path: &Path) -> Option<String> {
        let entry = OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES.0)
            .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0 | FILE_SHARE_DELETE.0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(path)
            .ok()?;
        read_identity(HANDLE(entry.as_raw_handle()))
    }

    pub fn replace_with_proof(
        staged: &Path,
        target: &Path,
        before: &str,
    ) -> io::Result<Option<(Option<String>, String)>> {
        if !std::fs::symlink_metadata(target)
            .is_ok_and(|metadata| metadata.is_file() && metadata.file_attributes() & 0x400 == 0)
        {
            return Ok(None);
        }
        let Some(new_id) = identity(staged) else {
            return Ok(None);
        };
        let Some(parent) = target.parent() else {
            return Ok(None);
        };
        let Ok(directory) = tempfile::Builder::new()
            .prefix(".nb-save-previous-")
            .tempdir_in(parent)
        else {
            return Ok(None);
        };
        let backup = directory.path().join("previous");
        let target_wide = wide(target);
        let staged_wide = wide(staged);
        let backup_wide = wide(&backup);
        // Match TempPath::persist by clearing the temporary-file attribute.
        if unsafe { SetFileAttributesW(PCWSTR(staged_wide.as_ptr()), FILE_ATTRIBUTE_NORMAL) }
            .is_err()
        {
            return Ok(None);
        }
        // Windows writes the exact displaced object to the backup path. This
        // establishes the chain even if another process races the old ID lookup.
        let result = unsafe {
            ReplaceFileW(
                PCWSTR(target_wide.as_ptr()),
                PCWSTR(staged_wide.as_ptr()),
                PCWSTR(backup_wide.as_ptr()),
                REPLACE_FILE_FLAGS(0),
                None,
                None,
            )
        };
        match result {
            Ok(()) => Ok(Some((identity(&backup), new_id))),
            Err(error) => {
                if let Some(displaced) = identity(&backup) {
                    if rename(&backup, target, Some(&displaced), |_, _| false).is_err() {
                        let recovery = directory.keep();
                        return Err(io::Error::other(format!(
                            "保存失败，原文件已保留在“{}”：{error}",
                            recovery.join("previous").display()
                        )));
                    }
                } else if !backup.exists()
                    && identity(target).as_deref() == Some(before)
                    && identity(staged).as_deref() == Some(new_id.as_str())
                {
                    // The filesystem or file permissions can disallow ReplaceFileW
                    // while still permitting the ordinary same-directory persist.
                    return Ok(None);
                } else if backup.exists() {
                    let recovery = directory.keep();
                    return Err(io::Error::other(format!(
                        "保存失败，原文件已保留在“{}”：{error}",
                        recovery.join("previous").display()
                    )));
                }
                Err(io::Error::other(error))
            }
        }
    }

    fn with_handle(
        from: &Path,
        to: &Path,
        expected_identity: Option<&str>,
        successor: impl Fn(&str, &str) -> bool,
    ) -> Result<Option<String>, String> {
        // Taking the ID and renaming through the same handle closes the path lookup
        // race. Other handles cannot delete/replace this entry while this handle lives.
        let entry = OpenOptions::new()
            .access_mode(DELETE.0 | FILE_READ_ATTRIBUTES.0)
            .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(from)
            .map_err(|error| format!("无法打开移动项目: {error}"))?;
        let handle = HANDLE(entry.as_raw_handle());
        let identity = read_identity(handle);
        if let Some(expected) = expected_identity {
            match identity.as_deref() {
                Some(actual) if actual == expected || successor(expected, actual) => {}
                Some(_) => return Err("移动后的项目已被替换，未执行撤销".into()),
                None => return Err("无法验证移动项目标识，未执行撤销".into()),
            }
        }

        let target = wide(to);
        let target_bytes = (target.len() - 1) * size_of::<u16>();
        let size = offset_of!(FILE_RENAME_INFO, FileName) + target.len() * size_of::<u16>();
        let mut buffer = vec![0usize; size.div_ceil(size_of::<usize>())];
        // SAFETY: Buffer alignment matches FILE_RENAME_INFO, with trailing room for
        // the whole target name. Zero initialization sets ReplaceIfExists to false.
        unsafe {
            let request = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
            (*request).FileNameLength = target_bytes as u32;
            copy_nonoverlapping(
                target.as_ptr(),
                (&raw mut (*request).FileName).cast::<u16>(),
                target.len(),
            );
            SetFileInformationByHandle(handle, FileRenameInfo, request.cast(), size as u32)
        }
        .map_err(|error| format!("移动失败: {error}"))?;
        Ok(identity)
    }

    pub fn rename(
        from: &Path,
        to: &Path,
        expected_identity: Option<&str>,
        successor: impl Fn(&str, &str) -> bool,
    ) -> Result<Option<String>, String> {
        match with_handle(from, to, expected_identity, successor) {
            Err(_) if expected_identity.is_none() => {
                // Preserve a forward move on a volume without handle-based rename.
                // MOVEFILE_REPLACE_EXISTING is deliberately omitted.
                let from = wide(from);
                let to = wide(to);
                unsafe {
                    MoveFileExW(
                        PCWSTR(from.as_ptr()),
                        PCWSTR(to.as_ptr()),
                        MOVE_FILE_FLAGS(0),
                    )
                }
                .map_err(|error| format!("移动失败: {error}"))?;
                Ok(None)
            }
            result => result,
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Path;
    use std::fs;

    #[cfg(unix)]
    fn metadata_identity(source: &fs::Metadata) -> Option<String> {
        use std::os::unix::fs::MetadataExt;
        (source.ino() != 0).then(|| format!("unix:{}:{}", source.dev(), source.ino()))
    }

    #[cfg(not(unix))]
    fn metadata_identity(_source: &fs::Metadata) -> Option<String> {
        None
    }

    pub fn identity(path: &Path) -> Option<String> {
        metadata_identity(&fs::symlink_metadata(path).ok()?)
    }

    pub fn rename(
        from: &Path,
        to: &Path,
        expected: Option<&str>,
        successor: impl Fn(&str, &str) -> bool,
    ) -> Result<Option<String>, String> {
        let source =
            fs::symlink_metadata(from).map_err(|error| format!("无法打开移动项目: {error}"))?;
        let identity = metadata_identity(&source);
        if expected.is_some_and(|value| {
            !identity
                .as_deref()
                .is_some_and(|actual| actual == value || successor(value, actual))
        }) {
            return Err("无法确认移动后的项目仍是同一项目，未执行撤销".into());
        }
        match fs::symlink_metadata(to) {
            Ok(_) => return Err("目标路径已存在，未执行移动".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查目标路径: {error}")),
        }
        fs::rename(from, to).map_err(|error| format!("移动失败: {error}"))?;
        Ok(identity)
    }
}

pub use platform::identity;

#[cfg(all(test, windows))]
mod tests {
    use super::{identity, rename, rename_document};
    use crate::dto::{Encoding, Eol};
    use crate::fsio::write::write_with_encoding;
    use std::{fs, os::windows::fs::MetadataExt};

    #[test]
    fn guarded_case_only_rename_can_be_undone_and_redone() {
        let scratch = tempfile::tempdir().unwrap();
        let lower = scratch.path().join("note.md");
        let upper = scratch.path().join("NOTE.md");
        fs::write(&lower, "body").unwrap();
        let identity = rename(&lower, &upper, None).unwrap().unwrap();
        let current_name = || {
            fs::read_dir(scratch.path())
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .file_name()
        };
        assert_eq!(current_name(), "NOTE.md");
        rename(&upper, &lower, Some(&identity)).unwrap();
        assert_eq!(current_name(), "note.md");
        rename(&lower, &upper, Some(&identity)).unwrap();
        assert_eq!(current_name(), "NOTE.md");
    }

    #[test]
    fn guarded_move_undo_keeps_same_file_edits_and_refuses_to_overwrite() {
        let scratch = tempfile::tempdir().unwrap();
        let source = scratch.path().join("notes.md");
        let folder = scratch.path().join("folder");
        fs::create_dir(&folder).unwrap();
        let destination = folder.join("notes.md");
        fs::write(&source, "before").unwrap();
        let identity = rename(&source, &destination, None).unwrap().unwrap();
        assert!(!source.exists());
        fs::write(&destination, "edited after moving").unwrap();
        fs::write(&source, "new file at the old location").unwrap();

        assert!(rename(&destination, &source, Some(&identity)).is_err());
        assert_eq!(
            fs::read_to_string(&source).unwrap(),
            "new file at the old location"
        );
        assert_eq!(
            fs::read_to_string(&destination).unwrap(),
            "edited after moving"
        );

        fs::remove_file(&source).unwrap();
        assert_eq!(
            rename(&destination, &source, Some(&identity)).unwrap(),
            Some(identity)
        );
        assert_eq!(fs::read_to_string(&source).unwrap(), "edited after moving");
    }

    #[test]
    fn guarded_move_checks_the_actual_entry_and_allows_directory_contents_to_change() {
        let scratch = tempfile::tempdir().unwrap();
        let source = scratch.path().join("notes");
        let folder = scratch.path().join("folder");
        let destination = folder.join("notes");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&folder).unwrap();
        let identity = rename(&source, &destination, None).unwrap().unwrap();
        fs::write(destination.join("new.md"), "new child").unwrap();
        assert!(rename(&destination, &source, Some(&identity)).is_ok());
        assert_eq!(
            fs::read_to_string(source.join("new.md")).unwrap(),
            "new child"
        );

        let moved = rename(&source, &destination, None).unwrap().unwrap();
        fs::rename(&destination, folder.join("unrelated location")).unwrap();
        assert!(rename(&destination, &source, Some(&moved)).is_err());
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("replacement.md"), "unrelated").unwrap();
        assert!(rename(&destination, &source, Some(&moved)).is_err());
        assert!(!source.exists());
        assert_eq!(
            fs::read_to_string(destination.join("replacement.md")).unwrap(),
            "unrelated"
        );
    }

    #[test]
    fn document_move_survives_multiple_atomic_saves_and_replays_with_the_original_id() {
        let scratch = tempfile::tempdir().unwrap();
        let from = scratch.path().join("note.md");
        let to = scratch.path().join("renamed.md");
        fs::write(&from, "before").unwrap();
        let original = rename_document(&from, &to, None).unwrap().unwrap();
        for body in ["first save", "second save", "before"] {
            write_with_encoding(&to, body, Encoding::Utf8, Eol::Lf).unwrap();
        }
        assert_eq!(fs::metadata(&to).unwrap().file_attributes() & 0x100, 0);
        let saved = identity(&to).unwrap();
        assert_ne!(original, saved);
        // Imported copies still require their exact receipt identity.
        assert!(rename(&to, &from, Some(&original)).is_err());
        fs::write(&from, "another file").unwrap();
        assert!(rename_document(&to, &from, Some(&original)).is_err());
        assert_eq!(fs::read_to_string(&from).unwrap(), "another file");
        fs::remove_file(&from).unwrap();
        assert_eq!(
            rename_document(&to, &from, Some(&original)).unwrap(),
            Some(saved.clone())
        );
        assert_eq!(fs::read_to_string(&from).unwrap(), "before");
        assert_eq!(
            rename_document(&from, &to, Some(&original)).unwrap(),
            Some(saved)
        );
    }

    #[test]
    fn saving_an_external_replacement_does_not_attach_it_to_an_older_move() {
        let scratch = tempfile::tempdir().unwrap();
        let from = scratch.path().join("note.md");
        let to = scratch.path().join("renamed.md");
        fs::write(&from, "before").unwrap();
        let original = rename_document(&from, &to, None).unwrap().unwrap();
        let outside = scratch.path().join("other.md");
        fs::rename(&to, &outside).unwrap();
        fs::write(&to, "external replacement").unwrap();
        write_with_encoding(&to, "later save", Encoding::Utf8, Eol::Lf).unwrap();
        assert!(rename_document(&to, &from, Some(&original)).is_err());
        assert!(!from.exists());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "before");
        assert_eq!(fs::read_to_string(&to).unwrap(), "later save");
    }
}
