// NoteBoard 设置模型
// 持久化在 %APPDATA%\NoteBoard\settings.json
// 读取容错：任一字段缺失用默认值填充，不整体丢弃

use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use super::image_editor::{self, ImageEditorPreferences};

// One process-wide authority serializes every read/modify/write transaction.
// Client revisions never allocate revisions and cannot replace this snapshot.
static SETTINGS: Mutex<Option<Settings>> = Mutex::new(None);

pub(crate) fn app_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("NoteBoard")
}

fn settings_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub revision: u64,

    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub typography: TypographySettings,
    #[serde(default)]
    pub editor: EditorSettings,
    #[serde(default)]
    pub file: FileSettings,
    #[serde(default)]
    pub layout: LayoutSettings,
    #[serde(default)]
    pub export: ExportSettings,
    #[serde(default)]
    pub updates: UpdateSettings,
    #[serde(default)]
    pub shortcuts: ShortcutSettings,
    #[serde(default)]
    pub image_editor: ImageEditorPreferences,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            appearance: AppearanceSettings::default(),
            typography: TypographySettings::default(),
            editor: EditorSettings::default(),
            file: FileSettings::default(),
            layout: LayoutSettings::default(),
            export: ExportSettings::default(),
            updates: UpdateSettings::default(),
            shortcuts: ShortcutSettings::default(),
            image_editor: ImageEditorPreferences::default(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings { #[serde(default)] pub pandoc_path: String }

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ShortcutSettings {
    #[serde(default)]
    pub overrides: std::collections::BTreeMap<String, Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings { #[serde(default)] pub ignored_version: String }

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    #[serde(default = "default_theme_mode")]
    pub theme_mode: String,
    #[serde(default = "default_light_theme")]
    pub system_light_theme: String,
    #[serde(default = "default_dark_theme")]
    pub system_dark_theme: String,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme_mode: "system".to_string(),
            system_light_theme: "chen-guang".to_string(),
            system_dark_theme: "mo-ye".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FontSelectionSource {
    Automatic,
    User,
    #[default]
    Legacy,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TypographySettings {
    // 正文西文字体（留空跟随系统）
    #[serde(default)]
    pub content_font_family: String,
    // 正文中文字体（留空跟随系统）
    #[serde(default)]
    pub content_font_family_zh: String,
    // 代码西文等宽字体
    #[serde(default = "default_mono_font")]
    pub mono_font_family: String,
    // 代码中文等宽/中文字体
    #[serde(default = "default_mono_font_zh")]
    pub mono_font_family_zh: String,
    // Missing provenance in a legacy file is not evidence that a font was a default.
    #[serde(default)]
    pub mono_font_family_source: FontSelectionSource,
    #[serde(default)]
    pub mono_font_family_zh_source: FontSelectionSource,
    #[serde(default = "default_content_font_size")]
    pub content_font_size: u32,
    #[serde(default = "default_mono_font_size")]
    pub mono_font_size: u32,
    #[serde(default = "default_line_height")]
    pub content_line_height: f64,
    // 代码/纯文本行高
    #[serde(default = "default_mono_line_height")]
    pub mono_line_height: f64,
    // Markdown 正文编辑区宽度（默认宽屏 wide）
    #[serde(default = "default_content_width")]
    pub content_width: String,
    // 代码与纯文本编辑区宽度（默认全宽 full）
    #[serde(default = "default_mono_content_width")]
    pub mono_content_width: String,
    // 文件树西文字体（留空跟随系统）
    #[serde(default)]
    pub explorer_font_family: String,
    // 文件树中文字体（留空跟随系统）
    #[serde(default)]
    pub explorer_font_family_zh: String,
    // 文件树字号
    #[serde(default = "default_explorer_font_size")]
    pub explorer_font_size: u32,
    // 文件树条目行高
    #[serde(default = "default_explorer_line_height")]
    pub explorer_line_height: u32,
    // 软件界面 UI 西文字体（留空跟随系统）
    #[serde(default)]
    pub ui_font_family: String,
    // 软件界面 UI 中文字体（留空跟随系统）
    #[serde(default)]
    pub ui_font_family_zh: String,
    // 软件界面 UI 字号
    #[serde(default = "default_ui_font_size")]
    pub ui_font_size: u32,
}

impl Default for TypographySettings {
    fn default() -> Self {
        Self {
            content_font_family: String::new(),
            content_font_family_zh: String::new(),
            // 默认代码西文字体优先使用可选应用字体包中的 JetBrains Mono。
            mono_font_family: "JetBrains Mono".to_string(),
            // 默认代码中文字体优先使用可选应用字体包中的 Maple Mono Normal NF CN。
            mono_font_family_zh: "Maple Mono Normal NF CN".to_string(),
            mono_font_family_source: FontSelectionSource::Automatic,
            mono_font_family_zh_source: FontSelectionSource::Automatic,
            content_font_size: 16,
            mono_font_size: 14,
            content_line_height: 1.7,
            mono_line_height: 1.5,
            content_width: "wide".to_string(),
            mono_content_width: "full".to_string(),
            explorer_font_family: String::new(),
            explorer_font_family_zh: String::new(),
            explorer_font_size: 13,
            explorer_line_height: 24,
            ui_font_family: String::new(),
            ui_font_family_zh: String::new(),
            ui_font_size: 13,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    #[serde(default)]
    pub pure_markdown: bool,
    #[serde(default = "default_selection_toolbar_position")]
    pub selection_toolbar_position: String,
    #[serde(default = "default_view_mode")]
    pub default_view_mode: String,
    #[serde(default = "default_true")]
    pub soft_wrap: bool,
    #[serde(default = "default_true")]
    pub show_line_numbers: bool,
    #[serde(default = "default_true")]
    pub show_indent_guides: bool,
    #[serde(default = "default_tab_size")]
    pub tab_size: u32,
    #[serde(default = "default_true")]
    pub insert_spaces: bool,
    #[serde(default = "default_true")]
    pub enable_math: bool,
    #[serde(default = "default_true")]
    pub enable_mermaid: bool,
    #[serde(default = "default_true")]
    pub enable_alerts: bool,
    #[serde(default = "default_true")]
    pub enable_block_handle: bool,
    // 显示空格与空白字符（默认 false）
    #[serde(default)]
    pub show_whitespace: bool,
    // 显示换行符号（默认 false）
    #[serde(default)]
    pub show_line_endings: bool,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            pure_markdown: false,
            selection_toolbar_position: default_selection_toolbar_position(),
            default_view_mode: "visual".to_string(),
            soft_wrap: true,
            show_line_numbers: true,
            show_indent_guides: true,
            tab_size: 2,
            insert_spaces: true,
            enable_math: true,
            enable_mermaid: true,
            enable_alerts: true,
            enable_block_handle: true,
            show_whitespace: false,
            show_line_endings: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileSettings {
    // 自动保存设置：Markdown / 画板 / 其他文本（默认均关闭，即手动保存）
    #[serde(default)]
    pub auto_save_markdown: bool,
    #[serde(default)]
    pub auto_save_board: bool,
    #[serde(default)]
    pub auto_save_other: bool,
    #[serde(default)]
    pub force_manual_save: bool,
    #[serde(default)]
    pub show_hidden_files: bool,
    #[serde(default = "default_true")]
    pub restore_session: bool,
    #[serde(default = "default_image_dir")]
    pub image_dir_name: String,
    #[serde(default = "default_image_deletion_policy")]
    pub image_deletion_policy: String,
    #[serde(default = "default_image_deletion_policy")]
    pub image_caption_deletion_policy: String,
    #[serde(default = "default_large_file_mb")]
    pub large_file_confirm_mb: u32,
    // 暂存目录使用绝对路径；旧版设置缺失该字段时自动补为应用数据目录下的 staging。
    #[serde(default = "default_staging_directory")]
    pub staging_directory: String,
}

fn default_image_deletion_policy() -> String { "ask".to_string() }

impl Default for FileSettings {
    fn default() -> Self {
        Self {
            auto_save_markdown: false,
            auto_save_board: false,
            auto_save_other: false,
            force_manual_save: false,
            show_hidden_files: false,
            restore_session: true,
            image_dir_name: "img".to_string(),
            image_deletion_policy: default_image_deletion_policy(),
            image_caption_deletion_policy: default_image_deletion_policy(),
            large_file_confirm_mb: 50,
            staging_directory: default_staging_directory(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSettings {
    #[serde(default = "default_true")]
    pub status_bar_visible: bool,
    #[serde(default = "default_ui_scale")]
    pub ui_scale: u32,
}

impl Default for LayoutSettings {
    fn default() -> Self {
        Self {
            status_bar_visible: true,
            ui_scale: 100,
        }
    }
}

// 默认值函数
fn default_selection_toolbar_position() -> String { "below".to_string() }
fn default_schema_version() -> u32 { 1 }
fn default_theme_mode() -> String { "system".to_string() }
fn default_light_theme() -> String { "chen-guang".to_string() }
fn default_dark_theme() -> String { "mo-ye".to_string() }
// 默认代码西文字体：JetBrains Mono
fn default_mono_font() -> String { "JetBrains Mono".to_string() }
// 默认代码中文字体：Maple Mono Normal NF CN
fn default_mono_font_zh() -> String { "Maple Mono Normal NF CN".to_string() }
fn default_content_font_size() -> u32 { 16 }
fn default_mono_font_size() -> u32 { 14 }
fn default_line_height() -> f64 { 1.7 }
fn default_mono_line_height() -> f64 { 1.5 }
fn default_explorer_font_size() -> u32 { 13 }
fn default_explorer_line_height() -> u32 { 24 }
fn default_ui_font_size() -> u32 { 13 }
// 默认 Markdown 内容宽度：wide (92%)
fn default_content_width() -> String { "wide".to_string() }
// 默认代码与纯文本内容宽度：full (100%)
fn default_mono_content_width() -> String { "full".to_string() }
fn default_view_mode() -> String { "visual".to_string() }
fn default_true() -> bool { true }
fn default_tab_size() -> u32 { 2 }
fn default_image_dir() -> String { "img".to_string() }
fn default_large_file_mb() -> u32 { 50 }
// 默认暂存目录与设置文件同属应用数据区，避免依赖用户是否存在“文档”库。
pub fn default_staging_directory() -> String {
    app_data_dir().join("staging").to_string_lossy().to_string()
}
fn default_ui_scale() -> u32 { 100 }

/// 读取设置（容错：缺字段填默认，损坏文件不 panic）
pub fn load() -> Settings {
    SETTINGS.lock().unwrap().get_or_insert_with(read_from_disk).clone()
}

fn read_from_disk() -> Settings {
    let path = settings_path();
    if !path.exists() {
        return Settings::default();
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Settings::default(),
    };

    // 尝试解析，失败则备份 + 返回默认
    match parse_settings(&content) {
        Ok(s) => s,
        Err(_) => {
            // 损坏文件备份
            let backup = path.with_extension(format!("corrupt-{}.json",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()));
            let _ = std::fs::rename(&path, &backup);
            Settings::default()
        }
    }
}

fn parse_settings(content: &str) -> Result<Settings, serde_json::Error> {
    let mut value: serde_json::Value = serde_json::from_str(content)?;
    if let Some(typography) = value.get_mut("typography").and_then(serde_json::Value::as_object_mut) {
        // An absent field proves that this slot has never stored a choice. Existing
        // names, including old defaults and system fallbacks, remain unclassified.
        for (font, source) in [("monoFontFamily", "monoFontFamilySource"), ("monoFontFamilyZh", "monoFontFamilyZhSource")] {
            if !typography.contains_key(font) && !typography.contains_key(source) {
                typography.insert(source.into(), serde_json::json!("automatic"));
            }
        }
    }
    let settings: Settings = serde_json::from_value(value)?;
    settings.image_editor.validate().map_err(<serde_json::Error as serde::de::Error>::custom)?;
    Ok(settings)
}

fn recommended_fonts_patch(current: &TypographySettings, expected: Option<&TypographySettings>) -> serde_json::Value {
    let mut patch = serde_json::Map::new();
    let fields = [
        ("monoFontFamily", "monoFontFamilySource", &current.mono_font_family, &current.mono_font_family_source,
            expected.map(|t| (&t.mono_font_family, &t.mono_font_family_source)), default_mono_font()),
        ("monoFontFamilyZh", "monoFontFamilyZhSource", &current.mono_font_family_zh, &current.mono_font_family_zh_source,
            expected.map(|t| (&t.mono_font_family_zh, &t.mono_font_family_zh_source)), default_mono_font_zh()),
    ];
    for (field, source_field, family, source, expected_slot, recommended) in fields {
        let can_apply = match expected_slot {
            Some((old_family, old_source)) => family == old_family && source == old_source,
            None => *source == FontSelectionSource::Automatic,
        };
        if can_apply && (family != &recommended || *source != FontSelectionSource::Automatic) {
            patch.insert(field.into(), serde_json::json!(recommended));
            patch.insert(source_field.into(), serde_json::json!("automatic"));
        }
    }
    serde_json::Value::Object(patch)
}

/// Compare the latest durable selection under the settings lock. A newer user
/// choice made while installation was running always wins over that installation.
pub fn apply_recommended_fonts(expected: Option<&TypographySettings>) -> Result<Settings, String> {
    let mut state = SETTINGS.lock().unwrap();
    let current = state.get_or_insert_with(read_from_disk);
    let typography = recommended_fonts_patch(&current.typography, expected);
    if typography.as_object().is_some_and(|fields| fields.is_empty()) { return Ok(current.clone()); }
    commit_patch(current, &serde_json::json!({ "typography": typography }), persist)
}

fn persist(settings: &Settings) -> Result<(), String> {
    // 确保 APPDATA 目录存在
    let dir = app_data_dir();
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {}", e))?;
    }

    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("序列化设置失败: {}", e))?;

    let path = settings_path();

    // 原子写
    crate::fsio::write::atomic_write(&path, json.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn next_revision(current: &Settings) -> Result<u64, String> {
    current.revision.checked_add(1).filter(|revision| *revision <= 9_007_199_254_740_991)
        .ok_or_else(|| "设置版本号超出范围".into())
}

/// A settings patch replaces named leaf fields only. Serde supplies the same
/// type validation as loading; metadata and unknown section/field names fail.
fn patched(current: &Settings, patch: &serde_json::Value) -> Result<Settings, String> {
    let sections = patch.as_object().ok_or("设置修改必须是对象")?;
    let mut value = serde_json::to_value(current).map_err(|e| e.to_string())?;
    for (section, fields) in sections {
        if !["appearance", "typography", "editor", "file", "layout", "export", "updates", "shortcuts", "imageEditor"].contains(&section.as_str()) { return Err(format!("未知设置分组: {section}")); }
        let fields = fields.as_object().ok_or("设置分组修改必须是对象")?;
        let target = value[section].as_object_mut().ok_or("设置分组无效")?;
        if section == "imageEditor" { image_editor::merge_patch(target, fields)?; continue; }
        for (field, field_value) in fields {
            if !target.contains_key(field) { return Err(format!("未知设置字段: {section}.{field}")); }
            if section == "shortcuts" && field == "overrides" {
                let changes = field_value.as_object().ok_or("快捷键修改必须是对象")?;
                let bindings = target.get_mut(field).and_then(|value| value.as_object_mut()).ok_or("快捷键配置无效")?;
                for (id, value) in changes {
                    if id.is_empty() || id.len() > 96 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'.') { return Err("快捷键命令标识无效".into()); }
                    if value.is_null() { bindings.remove(id); continue; }
                    let keys = value.as_array().ok_or("快捷键必须是组合键数组")?;
                    if keys.len() > 4 || keys.iter().any(|key| key.as_str().is_none_or(|key| key.is_empty() || key.len() > 64 || !key.is_ascii())) { return Err("快捷键组合无效".into()); }
                    bindings.insert(id.clone(), value.clone());
                }
                if bindings.len() > 512 { return Err("快捷键配置过多".into()); }
                continue;
            }
            target.insert(field.clone(), field_value.clone());
        }
    }
    let mut updated: Settings = serde_json::from_value(value).map_err(|e| format!("设置值无效: {e}"))?;
    updated.image_editor.validate()?;
    crate::shortcut_probe::validate_overrides(&updated.shortcuts.overrides)?;
    updated.revision = next_revision(current)?;
    Ok(updated)
}

fn commit_patch(current: &mut Settings, patch: &serde_json::Value, write: impl FnOnce(&Settings) -> Result<(), String>) -> Result<Settings, String> {
    let updated = patched(current, patch)?;
    write(&updated)?;
    *current = updated.clone();
    Ok(updated)
}

pub fn patch(patch: serde_json::Value) -> Result<Settings, String> {
    let mut state = SETTINGS.lock().unwrap();
    commit_patch(state.get_or_insert_with(read_from_disk), &patch, persist)
}

/// Legacy whole-document callers must match the authoritative revision. New
/// clients use patch() so unrelated edits from another window are retained.
pub fn save(settings: &mut Settings) -> Result<u64, String> {
    crate::shortcut_probe::validate_overrides(&settings.shortcuts.overrides)?;
    settings.image_editor.validate()?;
    let mut state = SETTINGS.lock().unwrap();
    let current = state.get_or_insert_with(read_from_disk);
    if settings.revision != current.revision { return Err("设置已在其他窗口更新，请重新载入后保存".into()); }
    let mut updated = settings.clone(); updated.revision = next_revision(current)?;
    persist(&updated)?;
    *current = updated.clone(); *settings = updated;
    Ok(settings.revision)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_provenance_migration_preserves_unknown_history_and_marks_absent_slots() {
        let legacy = parse_settings(r#"{"typography":{"monoFontFamily":"Consolas","monoFontFamilyZh":"Microsoft YaHei"}}"#).unwrap();
        assert_eq!(legacy.typography.mono_font_family_source, FontSelectionSource::Legacy);
        assert!(recommended_fonts_patch(&legacy.typography, None).as_object().unwrap().is_empty());
        let partial = parse_settings(r#"{"typography":{"contentFontSize":18}}"#).unwrap();
        assert_eq!(partial.typography.mono_font_family_source, FontSelectionSource::Automatic);
        assert_eq!(partial.typography.mono_font_family_zh_source, FontSelectionSource::Automatic);
        assert_eq!(partial.typography.content_font_size, 18);
    }

    #[test]
    fn font_install_applies_recommendations_but_keeps_newer_explicit_choice() {
        let mut typography = TypographySettings::default();
        typography.mono_font_family = "Consolas".into();
        typography.mono_font_family_zh = "Microsoft YaHei".into();
        typography.mono_font_family_source = FontSelectionSource::Legacy;
        typography.mono_font_family_zh_source = FontSelectionSource::User;
        let expected = typography.clone();
        let requested = recommended_fonts_patch(&typography, Some(&expected));
        assert_eq!(requested["monoFontFamily"], "JetBrains Mono");
        assert_eq!(requested["monoFontFamilyZh"], "Maple Mono Normal NF CN");
        typography.mono_font_family = "Cascadia Code".into();
        typography.mono_font_family_source = FontSelectionSource::User;
        let newer = recommended_fonts_patch(&typography, Some(&expected));
        assert!(newer.get("monoFontFamily").is_none());
        assert_eq!(newer["monoFontFamilyZh"], "Maple Mono Normal NF CN");
    }

    #[test]
    fn automatic_font_upgrade_only_changes_automatic_slots_and_is_idempotent() {
        let mut settings = Settings::default();
        settings.typography.mono_font_family = "old default".into();
        settings.typography.mono_font_family_zh = "custom CJK".into();
        settings.typography.mono_font_family_zh_source = FontSelectionSource::User;
        let patch = recommended_fonts_patch(&settings.typography, None);
        assert_eq!(patch["monoFontFamily"], "JetBrains Mono");
        assert!(patch.get("monoFontFamilyZh").is_none());
        let updated = patched(&settings, &serde_json::json!({"typography": patch})).unwrap();
        assert_eq!(updated.typography.mono_font_family_zh, "custom CJK");
        assert!(recommended_fonts_patch(&updated.typography, None).as_object().unwrap().is_empty());
    }

    #[test]
    fn shortcuts_merge_by_command_reset_and_validate_conflicts() {
        let first = patched(&Settings::default(), &serde_json::json!({"shortcuts":{"overrides":{"markdown.heading1":["Ctrl+F8"]}}})).unwrap();
        let second = patched(&first, &serde_json::json!({"shortcuts":{"overrides":{"file.save":["Ctrl+Alt+S"]}}})).unwrap();
        assert_eq!(second.shortcuts.overrides.len(), 2);
        assert!(patched(&second, &serde_json::json!({"shortcuts":{"overrides":{"file.save":["Ctrl+F8"]}}})).is_err());
        let reset = patched(&second, &serde_json::json!({"shortcuts":{"overrides":{"markdown.heading1":null}}})).unwrap();
        assert!(!reset.shortcuts.overrides.contains_key("markdown.heading1"));
        assert_eq!(reset.shortcuts.overrides.get("file.save").unwrap(), &vec!["Ctrl+Alt+S".to_owned()]);
    }

    /// 旧版 settings.json 不含暂存字段时必须无损迁移到默认目录，不能导致整份设置解析失败。
    #[test]
    fn old_settings_receive_default_staging_directory() {
        let settings: Settings = serde_json::from_str(r#"{"file":{"imageDirName":"images"}}"#)
            .expect("旧版设置应能补全新字段");
        assert_eq!(settings.file.image_dir_name, "images");
        assert_eq!(settings.file.staging_directory, default_staging_directory());
    }

    #[test]
    fn independent_patches_share_authoritative_sequence_and_preserve_each_other() {
        let mut current = Settings::default();
        let first = commit_patch(&mut current, &serde_json::json!({"editor":{"softWrap":false}}), |_| Ok(())).unwrap();
        let second = commit_patch(&mut current, &serde_json::json!({"file":{"showHiddenFiles":true}}), |_| Ok(())).unwrap();
        assert_eq!(first.revision, 1); assert_eq!(second.revision, 2);
        assert!(!second.editor.soft_wrap); assert!(second.file.show_hidden_files);
    }

    #[test]
    fn failed_settings_write_keeps_snapshot_and_revision() {
        let mut current = Settings::default();
        let result = commit_patch(&mut current, &serde_json::json!({"editor":{"softWrap":false}}), |_| Err("disk full".into()));
        assert!(result.is_err()); assert_eq!(current.revision, 0); assert!(current.editor.soft_wrap);
        let saved = commit_patch(&mut current, &serde_json::json!({"file":{"showHiddenFiles":true}}), |_| Ok(())).unwrap();
        assert_eq!(saved.revision, 1); assert!(saved.editor.soft_wrap);
    }

    #[test]
    fn patches_cannot_assign_revision_or_unknown_fields() {
        assert!(patched(&Settings::default(), &serde_json::json!({"revision":9})).is_err());
        assert!(patched(&Settings::default(), &serde_json::json!({"editor":{"unknown":true}})).is_err());
        assert!(patched(&Settings::default(), &serde_json::json!({"editor":{"tabSize":"oops"}})).is_err());
    }

    #[test]
    fn image_preferences_load_legacy_settings_and_merge_fields_in_commit_order() {
        let mut current = parse_settings(r#"{"revision":7,"editor":{"softWrap":false}}"#).unwrap();
        assert!(current.image_editor.tools.is_empty());
        let first = commit_patch(&mut current, &serde_json::json!({"imageEditor":{"tools":{"pen":{"color":"#A1b2C3","width":8}}}}), |_| Ok(())).unwrap();
        assert_eq!(first.revision, 8);
        let second = commit_patch(&mut current, &serde_json::json!({"imageEditor":{"tools":{"pen":{"width":12},"marker":{"markerSize":44}},"mosaicMode":"brush"}}), |_| Ok(())).unwrap();
        assert_eq!(second.revision, 9);
        assert!(!second.editor.soft_wrap);
        let image = serde_json::to_value(&second.image_editor).unwrap();
        assert_eq!(image["tools"]["pen"]["color"], "#A1b2C3");
        assert_eq!(image["tools"]["pen"]["width"], 12.0);
        assert_eq!(image["tools"]["marker"]["markerSize"], 44.0);
        assert_eq!(image["mosaicMode"], "brush");
    }

    #[test]
    fn image_preferences_reject_unknown_content_and_invalid_style_values() {
        for patch in [
            serde_json::json!({"imageEditor":{"tools":{"crop":{"width":5}}}}),
            serde_json::json!({"imageEditor":{"tools":{"text":{"text":"private"}}}}),
            serde_json::json!({"imageEditor":{"tools":{"marker":{"nextMarker":7}}}}),
            serde_json::json!({"imageEditor":{"tools":{"pen":{"color":"red"}}}}),
            serde_json::json!({"imageEditor":{"tools":{"pen":{"width":0}}}}),
            serde_json::json!({"imageEditor":{"tools":{"spotlight":{"opacity":1.1}}}}),
            serde_json::json!({"imageEditor":{"tools":{"magnifier":{"zoom":20.1}}}}),
            serde_json::json!({"imageEditor":{"tools":{"line":{"pattern":"dotted"}}}}),
            serde_json::json!({"imageEditor":{"magnifierMode":"rectangle"}}),
            serde_json::json!({"imageEditor":{"recipe":{"image":"content"}}}),
        ] {
            assert!(patched(&Settings::default(), &patch).is_err(), "accepted {patch}");
        }
    }

    #[test]
    fn failed_image_preference_write_preserves_revision_and_previous_tool_fields() {
        let mut current = Settings::default();
        let first = commit_patch(&mut current, &serde_json::json!({"imageEditor":{"tools":{"pen":{"color":"#ef4444"}}}}), |_| Ok(())).unwrap();
        assert_eq!(first.revision, 1);
        let failed = commit_patch(&mut current, &serde_json::json!({"imageEditor":{"tools":{"pen":{"width":18}}}}), |_| Err("disk full".into()));
        assert!(failed.is_err());
        assert_eq!(current.revision, 1);
        let next = commit_patch(&mut current, &serde_json::json!({"imageEditor":{"tools":{"marker":{"markerSize":42}}}}), |_| Ok(())).unwrap();
        let image = serde_json::to_value(&next.image_editor).unwrap();
        assert_eq!(next.revision, 2);
        assert_eq!(image["tools"]["pen"]["color"], "#ef4444");
        assert!(image["tools"]["pen"].get("width").is_none());
        assert_eq!(image["tools"]["marker"]["markerSize"], 42.0);
    }
}
