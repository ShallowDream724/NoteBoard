// NoteBoard 文件读取 — 编码探测 + 行尾符探测
// FR-210: UTF-8（含 BOM）/ GBK 自动识别
// FR-211: CRLF / LF 自动识别

use crate::dto::{Encoding, Eol};
use std::fs;
use std::io::Read;
use std::path::Path;

const TEXT_PREFIX_BYTES: usize = 8192;

#[derive(Debug, PartialEq, Eq)]
pub enum FileReadError {
    Io(String),
    UnsupportedText,
    SizeLimitExceeded { size: u64 },
    ChangedDuringRead,
}

impl std::fmt::Display for FileReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) => f.write_str(message),
            Self::UnsupportedText => {
                f.write_str("文件包含二进制内容或不支持的文本编码，请使用默认应用打开")
            }
            Self::SizeLimitExceeded { size } => write!(f, "文件大小已超过读取限制: {size} 字节"),
            Self::ChangedDuringRead => f.write_str("文件在读取期间增长，请重试打开"),
        }
    }
}

/// 文件读取结果
pub struct FileReadResult {
    pub content: String,
    pub encoding: Encoding,
    pub eol: Eol,
    pub size: u64,
    pub mtime: i64,
    pub readonly: bool,
}

/// 读取文件并探测编码与行尾符
pub fn read_file(path: &Path) -> Result<FileReadResult, String> {
    read_file_with_limit(path, None).map_err(|error| error.to_string())
}

/// Read at most the caller's limit, or the opened file's initial length. A file
/// that keeps growing cannot turn this request into an unbounded read.
pub fn read_file_with_limit(
    path: &Path,
    max_read_bytes: Option<u64>,
) -> Result<FileReadResult, FileReadError> {
    let mut file =
        fs::File::open(path).map_err(|e| FileReadError::Io(format!("无法打开文件: {e}")))?;
    let metadata = file
        .metadata()
        .map_err(|e| FileReadError::Io(format!("无法读取文件信息: {e}")))?;
    if max_read_bytes.is_some_and(|limit| metadata.len() > limit) {
        return Err(FileReadError::SizeLimitExceeded {
            size: metadata.len(),
        });
    }
    let read_limit = max_read_bytes.unwrap_or(metadata.len());
    let mtime = metadata
        .modified()
        .map(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64
        })
        .unwrap_or(0);
    let readonly = metadata.permissions().readonly();

    let bytes = read_bytes_limited(&mut file, read_limit)?;
    if bytes.len() as u64 > read_limit {
        return Err(match max_read_bytes {
            Some(_) => FileReadError::SizeLimitExceeded {
                size: file
                    .metadata()
                    .map(|meta| meta.len())
                    .unwrap_or(bytes.len() as u64)
                    .max(bytes.len() as u64),
            },
            None => FileReadError::ChangedDuringRead,
        });
    }
    if !is_text_prefix(&bytes) {
        return Err(FileReadError::UnsupportedText);
    }

    // UTF-8 can retain the read allocation rather than copying the whole body.
    let size = bytes.len() as u64;
    let (content, encoding) = decode_owned_bytes(bytes)?;
    if content.chars().any(is_nontext_control) {
        return Err(FileReadError::UnsupportedText);
    }

    // 探测行尾符
    let eol = detect_eol(&content);

    Ok(FileReadResult {
        content,
        encoding,
        eol,
        size,
        mtime,
        readonly,
    })
}

fn read_bytes_limited(reader: &mut impl Read, limit: u64) -> Result<Vec<u8>, FileReadError> {
    // Keep initial allocation small even for a large or sparse file. Read one
    // extra byte so growing files cannot silently produce truncated content.
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| FileReadError::Io(format!("读取文件失败: {e}")))?;
    Ok(bytes)
}

fn decode_owned_bytes(mut bytes: Vec<u8>) -> Result<(String, Encoding), FileReadError> {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        // Removing the BOM shifts within the existing allocation. Keep strict
        // validation: a damaged BOM file cannot fall back to a legacy decoder.
        bytes.drain(..3);
        return String::from_utf8(bytes)
            .map(|content| (content, Encoding::Utf8Bom))
            .map_err(|_| FileReadError::UnsupportedText);
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok((content, Encoding::Utf8)),
        // FromUtf8Error still owns the original buffer; the borrowed decoder
        // retains the same strict, byte-preserving GBK handling.
        Err(error) => decode_bytes(error.as_bytes()),
    }
}

/// 解码字节数组：自动探测 UTF-8 BOM / UTF-8 / GBK
pub fn decode_bytes(bytes: &[u8]) -> Result<(String, Encoding), FileReadError> {
    // 检查 BOM
    if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        // UTF-8 BOM
        let content =
            std::str::from_utf8(&bytes[3..]).map_err(|_| FileReadError::UnsupportedText)?;
        return Ok((content.to_string(), Encoding::Utf8Bom));
    }

    // 尝试 UTF-8
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok((s.to_string(), Encoding::Utf8));
    }

    // 尝试 GBK（用 chardetng 探测）
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let enc = detector.guess(None, true);

    // Only label bytes GBK when strict decoding and re-encoding preserve them.
    // The GBK decoder also accepts GB18030's four-byte sequences; those cannot
    // be saved by the existing GBK writer and must be handed to another app.
    if let Some(content) =
        encoding_rs::GBK.decode_without_bom_handling_and_without_replacement(bytes)
    {
        // With at most two Han characters there is too little evidence for the
        // detector (e.g. GBK "你好" is guessed EUC-KR). Prefer the supported GBK
        // encoding only for that narrow, byte-preserving ambiguity.
        let non_ascii_characters = content
            .chars()
            .filter(|character| !character.is_ascii())
            .take(3)
            .count();
        let short_han = (1..=2).contains(&non_ascii_characters)
            && content.chars().all(|character| {
                character.is_ascii() || ('\u{4e00}'..='\u{9fff}').contains(&character)
            });
        if enc == encoding_rs::GBK || enc == encoding_rs::GB18030 || short_han {
            let (round_trip, _, had_errors) = encoding_rs::GBK.encode(&content);
            if !had_errors && round_trip.as_ref() == bytes {
                return Ok((content.into_owned(), Encoding::Gbk));
            }
        }
    }
    Err(FileReadError::UnsupportedText)
}

/// 探测行尾符
fn detect_eol(content: &str) -> Eol {
    let has_crlf = content.contains("\r\n");
    let has_lf = content.contains('\n') && !has_crlf;
    let lf_count = content.matches('\n').count();
    let crlf_count = content.matches("\r\n").count();

    if crlf_count > 0 && crlf_count >= lf_count - crlf_count {
        Eol::Crlf
    } else if has_lf {
        Eol::Lf
    } else if has_crlf {
        Eol::Crlf
    } else {
        // 新建文件默认 CRLF（FR-211）
        Eol::Crlf
    }
}

/// 检查文件是否是文本（非二进制）
pub fn is_text_file(path: &Path) -> Result<bool, String> {
    let file = fs::File::open(path).map_err(|e| format!("无法打开文件: {}", e))?;
    let mut bytes = Vec::with_capacity(TEXT_PREFIX_BYTES);
    file.take(TEXT_PREFIX_BYTES as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    // Prefixes may end halfway through a UTF-8/GBK character, so decoding only
    // happens after the complete bounded read.
    Ok(is_text_prefix(&bytes))
}

fn is_nontext_control(character: char) -> bool {
    character.is_control() && !matches!(character, '\t' | '\n' | '\r' | '\u{000c}')
}

fn is_text_prefix(bytes: &[u8]) -> bool {
    !has_binary_signature(bytes)
        && !bytes
            .iter()
            .any(|byte| matches!(byte, 0x00..=0x08 | 0x0b | 0x0e..=0x1f | 0x7f))
}

fn has_binary_signature(bytes: &[u8]) -> bool {
    const SIGNATURES: &[&[u8]] = &[
        b"\x89PNG\r\n\x1a\n",
        b"\xff\xd8\xff",
        b"GIF87a",
        b"GIF89a",
        b"II*\0",
        b"MM\0*",
        b"%PDF-",
        b"PK\x03\x04",
        b"PK\x05\x06",
        b"PK\x07\x08",
        b"\x7fELF",
        b"\0asm",
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
        b"Rar!\x1a\x07",
        b"7z\xbc\xaf\x27\x1c",
        b"\x1f\x8b",
        b"\xfd7zXZ\0",
        b"\x28\xb5\x2f\xfd",
        b"\x04\x22\x4d\x18",
        b"SQLite format 3\0",
        b"8BPS",
        b"OggS",
        b"fLaC",
        b"wOFF",
        b"wOF2",
        b"OTTO",
        // UTF-16/32 cannot be represented by the current encoding DTO/writer.
        b"\xff\xfe",
        b"\xfe\xff",
        b"\0\0\xfe\xff",
    ];
    SIGNATURES
        .iter()
        .any(|signature| bytes.starts_with(signature))
        || (bytes.starts_with(b"RIFF")
            && bytes
                .get(8..12)
                .is_some_and(|kind| matches!(kind, b"WEBP" | b"WAVE" | b"AVI ")))
        || (bytes.starts_with(b"BZh")
            && bytes
                .get(3)
                .is_some_and(|level| (b'1'..=b'9').contains(level)))
        || (bytes.starts_with(b"ID3")
            && bytes
                .get(3)
                .is_some_and(|version| (2..=4).contains(version)))
        || bytes.get(4..8) == Some(b"ftyp")
        || (bytes.starts_with(b"BLENDER")
            && bytes
                .get(7)
                .is_some_and(|pointer| matches!(pointer, b'_' | b'-'))
            && bytes
                .get(8)
                .is_some_and(|endian| matches!(endian, b'v' | b'V')))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_utf8_bom() {
        let bytes = [0xEF, 0xBB, 0xBF, b'h', b'i'];
        let (s, enc) = decode_bytes(&bytes).unwrap();
        assert_eq!(s, "hi");
        assert_eq!(enc, Encoding::Utf8Bom);
    }

    #[test]
    fn test_decode_utf8() {
        let bytes = b"hello world";
        let (s, enc) = decode_bytes(bytes).unwrap();
        assert_eq!(s, "hello world");
        assert_eq!(enc, Encoding::Utf8);
    }

    #[test]
    fn large_utf8_and_bom_decoding_reuses_the_read_buffer() {
        let pattern = "中文🙂\ttext\r\n".as_bytes();
        let repetitions = 50 * 1024 * 1024 / pattern.len();
        for bom in [false, true] {
            let body_size = pattern.len() * repetitions;
            let mut bytes = Vec::with_capacity(body_size + if bom { 3 } else { 0 });
            if bom {
                bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            for _ in 0..repetitions {
                bytes.extend_from_slice(pattern);
            }
            let allocation = bytes.as_ptr();
            let capacity = bytes.capacity();
            let (content, encoding) = decode_owned_bytes(bytes).unwrap();
            assert_eq!(
                encoding,
                if bom {
                    Encoding::Utf8Bom
                } else {
                    Encoding::Utf8
                }
            );
            assert_eq!(content.as_ptr(), allocation);
            assert_eq!(content.capacity(), capacity);
            assert_eq!(content.len(), body_size);
            assert!(content
                .as_bytes()
                .chunks_exact(pattern.len())
                .all(|chunk| chunk == pattern));
        }
    }

    #[test]
    fn owned_decode_preserves_strict_legacy_and_damaged_bom_behavior() {
        let (gbk, _, had_errors) = encoding_rs::GBK.encode("中文内容测试：保持原始编码。");
        assert!(!had_errors);
        assert_eq!(
            decode_owned_bytes(gbk.to_vec()).unwrap(),
            decode_bytes(&gbk).unwrap()
        );
        for bytes in [
            b"\xef\xbb\xbfhello\xff".as_slice(),
            b"caf\xe9".as_slice(),
            &[0xff, 0xfe, 0x2d, 0x4e],
        ] {
            assert_eq!(decode_owned_bytes(bytes.to_vec()), decode_bytes(bytes));
        }
    }

    #[test]
    fn test_detect_eol_crlf() {
        assert_eq!(detect_eol("line1\r\nline2\r\n"), Eol::Crlf);
    }

    #[test]
    fn test_detect_eol_lf() {
        assert_eq!(detect_eol("line1\nline2\n"), Eol::Lf);
    }

    #[test]
    fn binary_signatures_and_controls_are_rejected_without_a_nul() {
        for bytes in [
            b"%PDF-1.7".as_slice(),
            b"GIF89a".as_slice(),
            b"8BPS".as_slice(),
            b"PK\x03\x04".as_slice(),
            b"binary\x01content".as_slice(),
            b"BLENDER-v300".as_slice(),
        ] {
            assert!(!is_text_prefix(bytes), "{bytes:?}");
        }
        assert!(!is_text_prefix(&[0xff, 0xfe, 0x2d, 0x4e]));
    }

    #[test]
    fn empty_unicode_gbk_and_text_whitespace_remain_candidates() {
        for bytes in [
            b"".as_slice(),
            b"line\tcolumn\r\nnext\x0cpage".as_slice(),
            "中文🙂\n".as_bytes(),
            &[0xd6, 0xd0, 0xce, 0xc4],
            &[0xe4, 0xb8],
        ] {
            assert!(is_text_prefix(bytes), "{bytes:?}");
        }
        for original in ["中文", "你好", "中文内容测试：正常保存并保持原始编码。\r\n"]
        {
            let (bytes, _, had_errors) = encoding_rs::GBK.encode(original);
            assert!(!had_errors);
            let (content, encoding) = decode_bytes(&bytes).expect(original);
            assert_eq!(encoding, Encoding::Gbk);
            assert_eq!(content, original);
        }
    }

    #[test]
    fn unsupported_or_damaged_encodings_are_never_lossily_decoded() {
        for bytes in [
            b"\xef\xbb\xbfhello\xff".as_slice(),
            b"caf\xe9".as_slice(),
            &[0xff, 0xfe, 0x2d, 0x4e],
            &[0x81],
        ] {
            assert!(decode_bytes(bytes).is_err(), "{bytes:?}");
        }
        let (bytes, _, had_errors) = encoding_rs::GB18030.encode("中文🙂文本内容");
        assert!(!had_errors);
        assert!(decode_bytes(&bytes).is_err());
        for (encoding, original) in [
            (encoding_rs::SHIFT_JIS, "こんにちは、世界"),
            (encoding_rs::WINDOWS_1251, "Привет мир"),
        ] {
            let (bytes, _, had_errors) = encoding.encode(original);
            assert!(!had_errors);
            assert!(decode_bytes(&bytes).is_err(), "{}", encoding.name());
        }
    }

    #[test]
    fn bounded_reader_consumes_only_one_byte_beyond_the_limit() {
        struct GrowingReader {
            consumed: u64,
        }
        impl Read for GrowingReader {
            fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
                bytes.fill(b'x');
                self.consumed += bytes.len() as u64;
                Ok(bytes.len())
            }
        }
        let mut reader = GrowingReader { consumed: 0 };
        let bytes = read_bytes_limited(&mut reader, 1024).unwrap();
        assert_eq!(bytes.len(), 1025);
        assert_eq!(reader.consumed, 1025);
    }

    #[test]
    fn full_read_rejects_controls_after_the_sniffed_prefix() {
        let mut bytes = vec![b'x'; TEXT_PREFIX_BYTES + 32];
        bytes.push(0x01);
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("renamed.txt");
        fs::write(&path, bytes).unwrap();
        assert!(is_text_file(&path).unwrap());
        assert!(matches!(
            read_file_with_limit(&path, None),
            Err(FileReadError::UnsupportedText)
        ));
    }
}
