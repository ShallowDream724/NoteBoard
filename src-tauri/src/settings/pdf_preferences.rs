//! Reusable PDF page defaults. Per-document layout decisions never enter settings.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct PdfPagePreferences {
    pub paper: String,
    pub landscape: bool,
    pub margin_mm: f64,
    pub horizontal_margin_mm: f64,
    pub font_pt: f64,
    pub line_height: f64,
    pub paragraph_spacing_em: f64,
    pub page_numbers: bool,
    pub page_number_position: String,
    pub page_number_style: String,
}

impl Default for PdfPagePreferences {
    fn default() -> Self {
        Self {
            paper: "A4".into(), landscape: false, margin_mm: 12.0,
            horizontal_margin_mm: 12.0, font_pt: 10.5, line_height: 1.4,
            paragraph_spacing_em: 0.65, page_numbers: true,
            page_number_position: "bottom-center".into(), page_number_style: "number".into(),
        }
    }
}

fn valid_field(field: &str, value: &Value) -> bool {
    match field {
        "paper" => value.as_str().is_some_and(|v| ["A4", "Letter"].contains(&v)),
        "landscape" | "pageNumbers" => value.is_boolean(),
        "pageNumberPosition" => value.as_str().is_some_and(|v| ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"].contains(&v)),
        "pageNumberStyle" => value.as_str().is_some_and(|v| ["number", "total", "dashes"].contains(&v)),
        _ => {
            let (min, max) = match field {
                "marginMm" | "horizontalMarginMm" => (0.0, 40.0),
                "fontPt" => (8.0, 24.0),
                "lineHeight" => (1.0, 2.5),
                "paragraphSpacingEm" => (0.0, 2.0),
                _ => return false,
            };
            value.as_f64().is_some_and(|v| v.is_finite() && (min..=max).contains(&v))
        }
    }
}

impl PdfPagePreferences {
    pub fn validate(&self) -> Result<(), String> {
        let value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        for (field, value) in value.as_object().ok_or("PDF 页面设置无效")? {
            if !valid_field(field, value) { return Err(format!("PDF 页面设置无效: {field}")); }
        }
        Ok(())
    }
}

/// Reading a stale/invalid page preference must not discard unrelated settings.
/// Missing and invalid fields use defaults; content-shaped fields are omitted.
pub fn normalize_saved(value: &mut Value) {
    if let Some(fields) = value.as_object_mut() {
        fields.retain(|field, value| valid_field(field, value));
    } else {
        *value = Value::Object(Map::new());
    }
}

/// Merge only the edited leaves while the authoritative settings lock is held.
pub fn merge_patch(target: &mut Value, patch: &Value) -> Result<(), String> {
    let changes = patch.as_object().ok_or("PDF 页面设置修改必须是对象")?;
    let fields = target.as_object_mut().ok_or("PDF 页面设置无效")?;
    for (field, value) in changes {
        if !valid_field(field, value) { return Err(format!("PDF 页面设置无效: {field}")); }
        fields.insert(field.clone(), value.clone());
    }
    Ok(())
}
