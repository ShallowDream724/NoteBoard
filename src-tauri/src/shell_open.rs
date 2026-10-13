//! OS association dispatch. Targets are never parsed by a command shell.

pub fn open(target: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let target = HSTRING::from(target);
        let operation = HSTRING::from("open");
        let result = unsafe { ShellExecuteW(None, &operation, &target, None, None, SW_SHOWNORMAL) };
        if result.0 as usize <= 32 {
            return Err(format!(
                "无法使用默认应用打开，错误代码: {}",
                result.0 as usize
            ));
        }
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(target)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn validate_file_path(path: &str) -> Result<&str, String> {
    if path.is_empty()
        || path.chars().any(char::is_control)
        || !std::path::Path::new(path).is_absolute()
    {
        return Err("请提供有效的完整文件路径".to_string());
    }
    if !std::path::Path::new(path).exists() {
        return Err("文件或文件夹不存在".to_string());
    }
    Ok(path)
}

pub fn normalize_external_url(input: &str) -> Result<String, String> {
    let input = input.trim();
    if input.chars().any(char::is_control) {
        return Err("链接包含非法控制字符".to_string());
    }
    let parsed = url::Url::parse(input).map_err(|_| "链接地址无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto" | "tel" | "ftp") {
        return Err("不支持此链接协议".to_string());
    }
    Ok(parsed.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legal_filename_metacharacters_are_preserved_as_one_native_target() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("A&B (draft)^100%.txt");
        std::fs::write(&path, "text").unwrap();
        let target = path.to_str().unwrap();
        assert_eq!(validate_file_path(target).unwrap(), target);
        assert!(validate_file_path("https://example.com").is_err());
        assert!(validate_file_path("relative.txt").is_err());
        assert!(validate_file_path("C:\\missing\0.txt").is_err());
    }

    #[test]
    fn external_protocol_contract_is_case_insensitive_and_explicit() {
        assert_eq!(
            normalize_external_url(" HTTPS://EXAMPLE.COM/path ").unwrap(),
            "https://example.com/path"
        );
        for input in [
            "mailto:a@example.com",
            "TEL:+123456",
            "ftp://example.com/file",
        ] {
            assert!(normalize_external_url(input).is_ok());
        }
        for input in [
            "javascript:alert(1)",
            "data:text/html,hi",
            "file:///C:/x",
            "ms-settings:privacy",
            "https://example.com\ncalc",
            "relative",
        ] {
            assert!(normalize_external_url(input).is_err(), "{input}");
        }
    }
}
