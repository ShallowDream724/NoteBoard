use crate::dto::Encoding;
use std::borrow::Cow;

impl Encoding {
    pub(super) fn codec(self) -> &'static encoding_rs::Encoding {
        match self {
            Self::Utf8 | Self::Utf8Bom => encoding_rs::UTF_8,
            Self::Utf16Le => encoding_rs::UTF_16LE,
            Self::Utf16Be => encoding_rs::UTF_16BE,
            Self::Gb18030 => encoding_rs::GB18030,
            Self::Gbk => encoding_rs::GBK,
            Self::Big5 => encoding_rs::BIG5,
            Self::ShiftJis => encoding_rs::SHIFT_JIS,
            Self::EucJp => encoding_rs::EUC_JP,
            Self::EucKr => encoding_rs::EUC_KR,
            Self::Windows1250 => encoding_rs::WINDOWS_1250,
            Self::Windows1251 => encoding_rs::WINDOWS_1251,
            Self::Windows1252 => encoding_rs::WINDOWS_1252,
            Self::Windows1253 => encoding_rs::WINDOWS_1253,
            Self::Windows1254 => encoding_rs::WINDOWS_1254,
            Self::Windows1255 => encoding_rs::WINDOWS_1255,
            Self::Windows1256 => encoding_rs::WINDOWS_1256,
            Self::Windows1257 => encoding_rs::WINDOWS_1257,
            Self::Windows1258 => encoding_rs::WINDOWS_1258,
            Self::Windows874 => encoding_rs::WINDOWS_874,
            Self::Koi8R => encoding_rs::KOI8_R,
            Self::MacRoman => encoding_rs::MACINTOSH,
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Utf8Bom => "UTF-8 BOM",
            Self::Utf16Le => "UTF-16 LE",
            Self::Utf16Be => "UTF-16 BE",
            Self::MacRoman => "Mac Roman",
            _ => self.codec().name(),
        }
    }

    pub(super) fn bom(self) -> &'static [u8] {
        match self {
            Self::Utf8Bom => b"\xef\xbb\xbf",
            Self::Utf16Le => b"\xff\xfe",
            Self::Utf16Be => b"\xfe\xff",
            _ => b"",
        }
    }
}

pub(super) fn detect_bom(bytes: &[u8]) -> Option<Encoding> {
    [Encoding::Utf8Bom, Encoding::Utf16Le, Encoding::Utf16Be]
        .into_iter()
        .find(|encoding| bytes.starts_with(encoding.bom()))
}

pub(super) fn decode(bytes: &[u8], encoding: Encoding) -> Option<Cow<'_, str>> {
    let bytes = match detect_bom(bytes) {
        Some(bom) if bom.codec() == encoding.codec() => &bytes[bom.bom().len()..],
        Some(Encoding::Utf16Le | Encoding::Utf16Be)
            if matches!(encoding, Encoding::Utf16Le | Encoding::Utf16Be) =>
        {
            return None;
        }
        _ => bytes,
    };
    // encoding_rs shares GBK's decoder with GB18030. GBK has only
    // single-byte characters and two-byte pairs, never a lead followed by a digit.
    if encoding == Encoding::Gbk {
        let mut bytes = bytes.iter().copied();
        while let Some(byte) = bytes.next() {
            if (0x81..=0xfe).contains(&byte)
                && bytes.next().is_some_and(|trail| trail.is_ascii_digit())
            {
                return None;
            }
        }
    }
    encoding
        .codec()
        .decode_without_bom_handling_and_without_replacement(bytes)
}

pub(super) fn encode_body(content: &str, encoding: Encoding) -> Option<Cow<'_, [u8]>> {
    match encoding {
        Encoding::Utf8 | Encoding::Utf8Bom => Some(Cow::Borrowed(content.as_bytes())),
        Encoding::Utf16Le => Some(Cow::Owned(
            content.encode_utf16().flat_map(u16::to_le_bytes).collect(),
        )),
        Encoding::Utf16Be => Some(Cow::Owned(
            content.encode_utf16().flat_map(u16::to_be_bytes).collect(),
        )),
        _ => {
            let codec = encoding.codec();
            let (bytes, _, errors) = codec.encode(content);
            // Some legacy encoders map distinct characters to the same bytes.
            // Reject those substitutions as well as unmappable input.
            if errors
                || codec
                    .decode_without_bom_handling_and_without_replacement(&bytes)
                    .as_deref()
                    != Some(content)
            {
                return None;
            }
            Some(bytes)
        }
    }
}
