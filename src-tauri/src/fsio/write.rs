// NoteBoard 原子写入 — 先写临时文件再 rename 覆盖
// FR-1205: 避免写入中断导致文件损坏
// 临时文件必须与目标同目录（跨卷 rename 不是原子操作）

use super::{guarded_rename, read, text_codec};
use crate::dto::{Encoding, Eol, ExpectedDisk, WriteError};
use std::borrow::Cow;
use std::io::Write;
use std::path::Path;

/// 原子写入
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    atomic_write_mode(path, b"", bytes, false, None, false)
}

fn atomic_write_mode(
    path: &Path,
    bom: &[u8],
    bytes: &[u8],
    create_only: bool,
    expected_disk: Option<&ExpectedDisk>,
    track_moved_document: bool,
) -> Result<(), WriteError> {
    let dir = path.parent().ok_or_else(|| WriteError::PathNotFound {
        path: path.to_string_lossy().to_string(),
    })?;

    // 确保目录存在
    if !dir.exists() {
        return Err(WriteError::PathNotFound {
            path: dir.to_string_lossy().to_string(),
        });
    }

    // ① 创建同目录临时文件
    let tmp = match tempfile::Builder::new().prefix(".nb-tmp-").tempfile_in(dir) {
        Ok(f) => f,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                return Err(WriteError::PermissionDenied {
                    path: path.to_string_lossy().to_string(),
                });
            }
            return Err(WriteError::Io {
                message: e.to_string(),
            });
        }
    };

    // ② 写入数据
    let mut output = tmp.as_file();
    if let Err(e) = output.write_all(bom).and_then(|_| output.write_all(bytes)) {
        if e.kind() == std::io::ErrorKind::StorageFull {
            return Err(WriteError::DiskFull);
        }
        return Err(WriteError::Io {
            message: e.to_string(),
        });
    }

    // ③ 落盘（sync_all）
    if let Err(e) = tmp.as_file().sync_all() {
        return Err(WriteError::Io {
            message: e.to_string(),
        });
    }

    if let Some(expected) = expected_disk {
        check_expected_disk(path, expected)?;
    }

    // ④ rename 覆盖（NTFS 同目录原子）
    let temporary = tmp.into_temp_path();
    let persisted = if create_only {
        temporary
            .persist_noclobber(path)
            .map_err(|error| error.error)
    } else if track_moved_document {
        guarded_rename::persist_document(temporary, path)
    } else {
        temporary.persist(path).map_err(|error| error.error)
    };
    if let Err(e) = persisted {
        if create_only && e.kind() == std::io::ErrorKind::AlreadyExists {
            return Err(WriteError::Io {
                message: "目标文件已重新出现，未覆盖。请检查文件或选择其他保存路径。".to_string(),
            });
        }
        let e_str = e.to_string();
        let e_lower = e_str.to_lowercase();
        if e_lower.contains("permission") || e_lower.contains("access") {
            return Err(WriteError::PermissionDenied {
                path: path.to_string_lossy().to_string(),
            });
        }
        if e_lower.contains("readonly") {
            return Err(WriteError::Readonly {
                path: path.to_string_lossy().to_string(),
            });
        }
        return Err(WriteError::Io { message: e_str });
    }

    Ok(())
}

/// 编码并写入文件
pub fn write_with_encoding(
    path: &Path,
    content: &str,
    encoding: Encoding,
    eol: Eol,
) -> Result<(u64, i64), WriteError> {
    write_with_encoding_mode(path, content, encoding, eol, false, None)
}

pub fn write_with_encoding_mode(
    path: &Path,
    content: &str,
    encoding: Encoding,
    eol: Eol,
    create_only: bool,
    expected_disk: Option<&ExpectedDisk>,
) -> Result<(u64, i64), WriteError> {
    let content = if content.contains('\r') {
        Cow::Owned(content.replace("\r\n", "\n").replace('\r', "\n"))
    } else {
        Cow::Borrowed(content)
    };
    let content = match eol {
        Eol::Crlf => Cow::Owned(content.replace('\n', "\r\n")),
        Eol::Lf => content,
    };
    let bom = encoding.bom();
    let bytes =
        text_codec::encode_body(&content, encoding).ok_or_else(|| WriteError::Encoding {
            message: format!(
                "{} 无法无损保存部分字符，请选择其他编码。",
                encoding.label()
            ),
        })?;
    let size = (bom.len() + bytes.len()) as u64;

    // 原子写入
    atomic_write_mode(path, bom, &bytes, create_only, expected_disk, true)?;

    // 获取写入后的 mtime
    let mtime = std::fs::metadata(path)
        .ok()
        .map(|metadata| read::metadata_mtime(&metadata))
        .unwrap_or(0);

    Ok((size, mtime))
}

pub(super) fn check_expected_disk(path: &Path, expected: &ExpectedDisk) -> Result<(), WriteError> {
    let metadata_matches = || {
        std::fs::metadata(path).is_ok_and(|metadata| {
            metadata.is_file()
                && metadata.len() == expected.size
                && read::metadata_mtime(&metadata) == expected.mtime
        })
    };
    if metadata_matches()
        && read::read_file_with_limit(path, Some(expected.size), Some(expected.encoding)).is_ok_and(
            |disk| {
                disk.size == expected.size
                    && disk.mtime == expected.mtime
                    && disk.content == expected.content
            },
        )
        && metadata_matches()
    {
        Ok(())
    } else {
        Err(WriteError::Conflict {
            message: "文件已在磁盘上发生变化，请检查磁盘版本后重试。".to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_recreation_never_overwrites_a_file_that_reappeared() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recreated.txt");
        write_with_encoding_mode(&path, "first", Encoding::Utf8, Eol::Lf, true, None).unwrap();
        assert!(
            write_with_encoding_mode(&path, "second", Encoding::Utf8, Eol::Lf, true, None).is_err()
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        write_with_encoding(&path, "regular save", Encoding::Utf8, Eol::Lf).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "regular save");
    }

    #[test]
    fn unsupported_gbk_characters_never_replace_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing.txt");
        let original = encoding_rs::GBK.encode("原始中文内容\r\n").0.into_owned();
        std::fs::write(&path, &original).unwrap();

        for content in ["中文🙂", "文本\u{1d11e}", "生僻字𠮷"] {
            let result = write_with_encoding(&path, content, Encoding::Gbk, Eol::Crlf);
            assert!(
                matches!(result, Err(WriteError::Encoding { message }) if message.contains("GBK"))
            );
            assert_eq!(std::fs::read(&path).unwrap(), original);
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        }
    }

    #[test]
    fn unsupported_gbk_save_does_not_create_a_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new.txt");
        assert!(write_with_encoding(&path, "🙂", Encoding::Gbk, Eol::Lf).is_err());
        assert!(!path.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn supported_gbk_and_unicode_saves_preserve_text_and_line_endings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("text.txt");
        let content = "中文内容\n下一行\r\n";
        let (size, _) = write_with_encoding(&path, content, Encoding::Gbk, Eol::Crlf).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let decoded = encoding_rs::GBK
            .decode_without_bom_handling_and_without_replacement(&bytes)
            .unwrap();
        assert_eq!(decoded, "中文内容\r\n下一行\r\n");
        assert_eq!(size, bytes.len() as u64);

        for (encoding, bom) in [(Encoding::Utf8, false), (Encoding::Utf8Bom, true)] {
            write_with_encoding(&path, "中文🙂\r\n", encoding, Eol::Lf).unwrap();
            let bytes = std::fs::read(&path).unwrap();
            assert_eq!(bytes.starts_with(&[0xef, 0xbb, 0xbf]), bom);
            let body = if bom { &bytes[3..] } else { &bytes[..] };
            assert_eq!(std::str::from_utf8(body).unwrap(), "中文🙂\n");
        }
    }

    #[test]
    fn offered_encodings_round_trip_native_text() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("text.txt");
        for (encoding, sample) in [
            (Encoding::Utf8, "中文🙂"),
            (Encoding::Utf8Bom, "中文🙂"),
            (Encoding::Utf16Le, "中文🙂"),
            (Encoding::Utf16Be, "中文🙂"),
            (Encoding::Gb18030, "中文🙂"),
            (Encoding::Gbk, "中文"),
            (Encoding::Big5, "繁體中文"),
            (Encoding::ShiftJis, "日本語"),
            (Encoding::EucJp, "日本語"),
            (Encoding::EucKr, "한글"),
            (Encoding::Windows1250, "Dzień"),
            (Encoding::Windows1251, "Привет"),
            (Encoding::Windows1252, "café"),
            (Encoding::Windows1253, "Ελληνικά"),
            (Encoding::Windows1254, "Türkçe"),
            (Encoding::Windows1255, "שלום"),
            (Encoding::Windows1256, "العربية"),
            (Encoding::Windows1257, "Rīga"),
            (Encoding::Windows1258, "Tiê\u{0301}ng"),
            (Encoding::Windows874, "ภาษาไทย"),
            (Encoding::Koi8R, "Привет"),
            (Encoding::MacRoman, "café"),
        ] {
            let original = format!("{sample}\rfirst\nsecond\r\n");
            let (size, _) = write_with_encoding(&path, &original, encoding, Eol::Crlf).unwrap();
            let loaded = read::read_file_with_limit(&path, Some(size), Some(encoding)).unwrap();
            assert_eq!(loaded.content, format!("{sample}\r\nfirst\r\nsecond\r\n"));
            assert_eq!(loaded.encoding, encoding);
            assert_eq!(loaded.eol, Eol::Crlf);
            assert_eq!(loaded.size, size);
        }
    }

    #[test]
    fn shift_jis_character_alias_is_rejected_before_creating_a_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("text.txt");
        // The Shift JIS writer can encode U+00A5 to 0x5c, which reads back as U+005C.
        assert!(matches!(
            write_with_encoding(&path, "¥100", Encoding::ShiftJis, Eol::Lf),
            Err(WriteError::Encoding { .. })
        ));
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn guarded_conversion_preserves_a_different_disk_version() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("text.txt");
        std::fs::write(&path, b"caf\xe9\r\nfirst\n").unwrap();
        let encoding = Encoding::Windows1252;
        let disk = read::read_file_with_limit(&path, None, Some(encoding)).unwrap();
        let mut expected = ExpectedDisk {
            mtime: disk.mtime,
            size: disk.size,
            encoding,
            content: "café\nfirst\r\n".into(),
        };
        for content in ["edited", "café\nfirst\n"] {
            assert!(matches!(
                write_with_encoding_mode(
                    &path,
                    content,
                    Encoding::Utf16Le,
                    Eol::Lf,
                    false,
                    Some(&expected)
                ),
                Err(WriteError::Conflict { .. })
            ));
            assert_eq!(std::fs::read(&path).unwrap(), b"caf\xe9\r\nfirst\n");
            assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        }
        expected.content = disk.content;
        write_with_encoding_mode(
            &path,
            "café\nfirst\n",
            Encoding::Utf16Le,
            Eol::Lf,
            false,
            Some(&expected),
        )
        .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes, b"\xff\xfec\0a\0f\0\xe9\0\n\0f\0i\0r\0s\0t\0\n\0");
        assert_eq!(read::read_file(&path).unwrap().content, "café\nfirst\n");
    }
}
