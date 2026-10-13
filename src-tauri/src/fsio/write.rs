// NoteBoard 原子写入 — 先写临时文件再 rename 覆盖
// FR-1205: 避免写入中断导致文件损坏
// 临时文件必须与目标同目录（跨卷 rename 不是原子操作）

use crate::dto::{Encoding, Eol, WriteError};
use std::io::Write;
use std::path::Path;

/// 原子写入
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    atomic_write_mode(path, bytes, false)
}

fn atomic_write_mode(path: &Path, bytes: &[u8], create_only: bool) -> Result<(), WriteError> {
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
    let tmp = match tempfile::Builder::new()
        .prefix(".nb-tmp-")
        .tempfile_in(dir)
    {
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
    if let Err(e) = tmp.as_file().write_all(bytes) {
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

    // ④ rename 覆盖（NTFS 同目录原子）
    let persisted = if create_only { tmp.persist_noclobber(path) } else { tmp.persist(path) };
    if let Err(e) = persisted {
        if create_only && e.error.kind() == std::io::ErrorKind::AlreadyExists {
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
        return Err(WriteError::Io {
            message: e_str,
        });
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
    write_with_encoding_mode(path, content, encoding, eol, false)
}

/// Explicit recreation must not overwrite a file created after the save dialog.
pub fn write_with_encoding_create_only(
    path: &Path,
    content: &str,
    encoding: Encoding,
    eol: Eol,
) -> Result<(u64, i64), WriteError> {
    write_with_encoding_mode(path, content, encoding, eol, true)
}

fn write_with_encoding_mode(
    path: &Path,
    content: &str,
    encoding: Encoding,
    eol: Eol,
    create_only: bool,
) -> Result<(u64, i64), WriteError> {
    // 统一行尾符
    let content = match eol {
        Eol::Crlf => content.replace('\n', "\r\n").replace("\r\r\n", "\r\n"),
        Eol::Lf => content.replace("\r\n", "\n").replace('\r', "\n"),
    };

    // 编码
    let bytes: Vec<u8> = match encoding {
        Encoding::Utf8 => content.into_bytes(),
        Encoding::Utf8Bom => {
            let mut v = vec![0xEF, 0xBB, 0xBF];
            v.extend_from_slice(content.as_bytes());
            v
        }
        Encoding::Gbk => {
            let (cow, _, had_errors) = encoding_rs::GBK.encode(&content);
            // encoding_rs substitutes unrepresentable characters with numeric
            // character references. That is not a lossless text-file save.
            // Reject before creating a temporary file or touching the original.
            if had_errors {
                return Err(WriteError::Io {
                    message: "GBK 编码无法保存部分字符，原文件未更改。请使用 UTF-8 编码保存。"
                        .to_string(),
                });
            }
            cow.into_owned()
        }
    };

    let size = bytes.len() as u64;

    // 原子写入
    atomic_write_mode(path, &bytes, create_only)?;

    // 获取写入后的 mtime
    let mtime = std::fs::metadata(path)
        .ok()
        .and_then(|m| {
            m.modified()
                .ok()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64)
        })
        .unwrap_or(0);

    Ok((size, mtime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_recreation_never_overwrites_a_file_that_reappeared() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recreated.txt");
        write_with_encoding_create_only(&path, "first", Encoding::Utf8, Eol::Lf).unwrap();
        assert!(write_with_encoding_create_only(&path, "second", Encoding::Utf8, Eol::Lf).is_err());
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
            assert!(matches!(result, Err(WriteError::Io { message }) if message.contains("GBK")));
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
}
