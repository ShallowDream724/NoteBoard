//! Windows image clipboard fallback for WebView2's unreliable async image writes.
//! The IPC body is encoded PNG; allocation and PNG dimensions are validated before
//! the clipboard is opened or cleared.

const MAX_ENCODED_BYTES: usize = 256 * 1024 * 1024;
const MAX_PIXELS_BYTES: usize = 512 * 1024 * 1024;

fn validate_encoded_len(length: usize) -> Result<(), String> {
    if length < 8 || length > MAX_ENCODED_BYTES {
        Err("剪贴板 PNG 大小无效".into())
    } else {
        Ok(())
    }
}

fn checked_pixel_bytes(width: u32, height: u32) -> Result<usize, String> {
    if width == 0 || height == 0 || width > i32::MAX as u32 || height > i32::MAX as u32 {
        return Err("剪贴板图片尺寸无效".into());
    }
    (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .filter(|bytes| *bytes <= MAX_PIXELS_BYTES)
        .ok_or_else(|| "剪贴板图片过大".into())
}

#[tauri::command]
pub async fn copy_png_image(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => {
            validate_encoded_len(bytes.len())?;
            bytes.clone()
        }
        _ => return Err("图片剪贴板需要二进制载荷".into()),
    };
    #[cfg(windows)]
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
    #[cfg(not(windows))]
    let owner = {
        let _ = window;
        0usize
    };
    if cfg!(windows) && owner == 0 {
        return Err("无法取得图片窗口句柄".into());
    }
    tauri::async_runtime::spawn_blocking(move || copy_png_image_bytes(&data, owner))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(not(windows))]
fn copy_png_image_bytes(_data: &[u8], _owner: usize) -> Result<(), String> {
    Err("当前系统不支持原生图片剪贴板".into())
}

#[cfg(windows)]
fn copy_png_image_bytes(data: &[u8], owner: usize) -> Result<(), String> {
    let dib = png_to_dib(data)?;
    windows_clipboard::write_image(&dib, data, owner)
}

#[cfg(windows)]
fn png_to_dib(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Cursor;
    if !data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("剪贴板图片不是 PNG".into());
    }
    let mut decoder = png::Decoder::new(Cursor::new(data));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    decoder.set_limits(png::Limits {
        bytes: MAX_PIXELS_BYTES,
    });
    let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
    let (width, height) = (reader.info().width, reader.info().height);
    let pixel_bytes = checked_pixel_bytes(width, height)?;
    let frame_size = reader.output_buffer_size().ok_or("剪贴板图片尺寸无效")?;
    if frame_size > pixel_bytes {
        return Err("剪贴板图片数据过大".into());
    }
    let mut pixels = vec![0; frame_size];
    let frame = reader
        .next_frame(&mut pixels)
        .map_err(|error| error.to_string())?;
    if frame.width != width || frame.height != height || frame.bit_depth != png::BitDepth::Eight {
        return Err("剪贴板图片帧无效".into());
    }
    let channels = match frame.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Grayscale => 1,
        png::ColorType::Indexed => return Err("剪贴板图片色彩无效".into()),
    };
    if frame.buffer_size()
        != (width as usize)
            .checked_mul(height as usize)
            .and_then(|count| count.checked_mul(channels))
            .ok_or("剪贴板图片尺寸无效")?
    {
        return Err("剪贴板图片数据长度无效".into());
    }
    let dib_size = 124usize.checked_add(pixel_bytes).ok_or("剪贴板图片过大")?;
    let mut dib = vec![0; dib_size];
    dib[0..4].copy_from_slice(&124u32.to_le_bytes());
    dib[4..8].copy_from_slice(&(width as i32).to_le_bytes());
    dib[8..12].copy_from_slice(&(-(height as i32)).to_le_bytes()); // top-down rows
    dib[12..14].copy_from_slice(&1u16.to_le_bytes());
    dib[14..16].copy_from_slice(&32u16.to_le_bytes());
    dib[16..20].copy_from_slice(&3u32.to_le_bytes()); // BI_BITFIELDS
    dib[20..24].copy_from_slice(&(pixel_bytes as u32).to_le_bytes());
    dib[40..44].copy_from_slice(&0x00ff_0000u32.to_le_bytes());
    dib[44..48].copy_from_slice(&0x0000_ff00u32.to_le_bytes());
    dib[48..52].copy_from_slice(&0x0000_00ffu32.to_le_bytes());
    dib[52..56].copy_from_slice(&0xff00_0000u32.to_le_bytes());
    dib[56..60].copy_from_slice(&0x7352_4742u32.to_le_bytes()); // LCS_sRGB
    for (index, source) in pixels[..frame.buffer_size()]
        .chunks_exact(channels)
        .enumerate()
    {
        let (r, g, b, a) = match channels {
            4 => (source[0], source[1], source[2], source[3]),
            3 => (source[0], source[1], source[2], 255),
            2 => (source[0], source[0], source[0], source[1]),
            _ => (source[0], source[0], source[0], 255),
        };
        dib[124 + index * 4..124 + index * 4 + 4].copy_from_slice(&[b, g, r, a]);
    }
    Ok(dib)
}

#[cfg(all(test, windows))]
mod tests {
    use super::{checked_pixel_bytes, png_to_dib, validate_encoded_len, MAX_ENCODED_BYTES};

    fn tiny_png() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 2);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer
                .write_image_data(&[255, 0, 0, 128, 0, 0, 255, 64])
                .unwrap();
        }
        bytes
    }

    #[test]
    fn png_alpha_and_orientation_survive_native_dib_conversion() {
        let dib = png_to_dib(&tiny_png()).unwrap();
        assert_eq!(&dib[4..8], &1i32.to_le_bytes());
        assert_eq!(&dib[8..12], &(-2i32).to_le_bytes());
        assert_eq!(&dib[124..132], &[0, 0, 255, 128, 255, 0, 0, 64]);
    }

    #[test]
    fn malformed_png_never_reaches_the_clipboard() {
        assert!(png_to_dib(b"not png").is_err());
        let mut huge = b"\x89PNG\r\n\x1a\n".to_vec();
        huge.extend_from_slice(&[0, 0, 0, 13, b'I', b'H', b'D', b'R']);
        huge.extend_from_slice(&u32::MAX.to_be_bytes());
        huge.extend_from_slice(&u32::MAX.to_be_bytes());
        huge.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        assert!(png_to_dib(&huge).is_err());
    }

    #[test]
    fn bounds_are_checked_before_allocating_or_clearing_clipboard() {
        assert!(validate_encoded_len(0).is_err());
        assert!(validate_encoded_len(MAX_ENCODED_BYTES + 1).is_err());
        assert!(checked_pixel_bytes(0, 1).is_err());
        assert!(checked_pixel_bytes(u32::MAX, 1).is_err());
        assert!(checked_pixel_bytes(32768, 32768).is_err());
        assert_eq!(checked_pixel_bytes(8192, 4096).unwrap(), 134_217_728);
    }
}

#[cfg(windows)]
mod windows_clipboard {
    use windows::core::w;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    struct OwnedGlobal(Option<HGLOBAL>);
    impl OwnedGlobal {
        fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
            let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }
                .map_err(|error| error.to_string())?;
            let pointer = unsafe { GlobalLock(handle) } as *mut u8;
            if pointer.is_null() {
                let _ = unsafe { GlobalFree(handle) };
                return Err("无法锁定剪贴板内存".into());
            }
            unsafe {
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer, bytes.len());
            }
            let _ = unsafe { GlobalUnlock(handle) };
            Ok(Self(Some(handle)))
        }
        fn give_to_clipboard(&mut self, format: u32) -> Result<(), String> {
            let handle = self.0.ok_or("剪贴板内存已转移")?;
            unsafe { SetClipboardData(format, HANDLE(handle.0)) }
                .map_err(|error| error.to_string())?;
            self.0 = None; // Windows owns it only after SetClipboardData succeeds.
            Ok(())
        }
    }
    impl Drop for OwnedGlobal {
        fn drop(&mut self) {
            if let Some(handle) = self.0.take() {
                let _ = unsafe { GlobalFree(handle) };
            }
        }
    }

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            let _ = unsafe { CloseClipboard() };
        }
    }

    pub fn write_image(dib: &[u8], png: &[u8], owner: usize) -> Result<(), String> {
        let mut dib_memory = OwnedGlobal::from_bytes(dib)?;
        let mut png_memory = OwnedGlobal::from_bytes(png)?;
        let png_format = unsafe { RegisterClipboardFormatW(w!("PNG")) };
        if png_format == 0 {
            return Err("无法注册 PNG 剪贴板格式".into());
        }
        unsafe { OpenClipboard(HWND(owner as *mut core::ffi::c_void)) }
            .map_err(|error| error.to_string())?;
        let _guard = ClipboardGuard;
        unsafe { EmptyClipboard() }.map_err(|error| error.to_string())?;
        dib_memory.give_to_clipboard(17)?; // CF_DIBV5 keeps alpha.
                                           // DIBV5 already supplies an image; PNG adds lossless interchange for apps that support it.
        let _ = png_memory.give_to_clipboard(png_format);
        Ok(())
    }
}
