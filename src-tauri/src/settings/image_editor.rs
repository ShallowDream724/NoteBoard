//! Durable style defaults for image tools. Image content and operation geometry never enter settings.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum ImagePreferenceTool {
    Pen, Highlighter, Line, Polyline, Rectangle, Ellipse, Text, Marker,
    Mosaic, MosaicBrush, Spotlight, Magnifier, Eraser, ObjectEraser,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum MosaicMode { Brush, #[default] Rectangle }

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum MagnifierMode { Circle, #[default] Ellipse }

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum LinePattern { Solid, Dash, Dashdot }

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum ArrowHead { None, Open, Filled }

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum MarkerFormat { Decimal, Roman, Alpha }

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum MarkerShape { Circle, Square }

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum MarkerAppearance { Filled, Outlined, Ring }

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SpotlightShape { Rectangle, Ellipse }

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageToolPreferences {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<LinePattern>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_head: Option<ArrowHead>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_head: Option<ArrowHead>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker_format: Option<MarkerFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker_shape: Option<MarkerShape>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker_appearance: Option<MarkerAppearance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radius: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spotlight_shape: Option<SpotlightShape>,
}

impl ImageToolPreferences {
    fn validate(&self) -> Result<(), String> {
        if let Some(color) = &self.color {
            if color.len() != 7 || !color.starts_with('#') || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit) {
                return Err("图片工具颜色必须是 #RRGGBB".into());
            }
        }
        for (name, number, min, max) in [
            ("width", self.width, 1.0, 2000.0),
            ("fontSize", self.font_size, 1.0, 2000.0),
            ("markerSize", self.marker_size, 1.0, 2000.0),
            ("radius", self.radius, 1.0, 2000.0),
            ("blockSize", self.block_size, 2.0, 500.0),
            ("opacity", self.opacity, 0.0, 1.0),
            ("zoom", self.zoom, 1.1, 20.0),
        ] {
            if number.is_some_and(|value| !value.is_finite() || value < min || value > max) {
                return Err(format!("图片工具参数 {name} 超出范围"));
            }
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageEditorPreferences {
    #[serde(default)]
    pub tools: BTreeMap<ImagePreferenceTool, ImageToolPreferences>,
    #[serde(default)]
    pub mosaic_mode: MosaicMode,
    #[serde(default)]
    pub magnifier_mode: MagnifierMode,
}

impl ImageEditorPreferences {
    pub fn validate(&self) -> Result<(), String> {
        for style in self.tools.values() { style.validate()?; }
        Ok(())
    }
}

/// Merge only provided tool fields into the authoritative snapshot. Typed deserialization
/// rejects unknown tool IDs, style fields, enum members, and wrong JSON value types.
pub fn merge_patch(target: &mut Map<String, Value>, patch: &Map<String, Value>) -> Result<(), String> {
    for (field, value) in patch {
        match field.as_str() {
            "tools" => {
                let changes = value.as_object().ok_or("图片工具修改必须是对象")?;
                let tools = target.get_mut("tools").and_then(Value::as_object_mut).ok_or("图片工具配置无效")?;
                for (tool, fields) in changes {
                    serde_json::from_value::<ImagePreferenceTool>(Value::String(tool.clone()))
                        .map_err(|_| format!("未知图片工具: {tool}"))?;
                    let fields = fields.as_object().ok_or("图片工具参数必须是对象")?;
                    let _: ImageToolPreferences = serde_json::from_value(Value::Object(fields.clone()))
                        .map_err(|error| format!("图片工具参数无效: {error}"))?;
                    let entry = tools.entry(tool.clone()).or_insert_with(|| Value::Object(Map::new()));
                    let current = entry.as_object_mut().ok_or("图片工具配置无效")?;
                    for (name, value) in fields {
                        if value.is_null() { return Err(format!("图片工具参数 {name} 不得为空")); }
                        current.insert(name.clone(), value.clone());
                    }
                }
            }
            "mosaicMode" | "magnifierMode" => { target.insert(field.clone(), value.clone()); }
            _ => return Err(format!("未知图片设置字段: {field}")),
        }
    }
    Ok(())
}
