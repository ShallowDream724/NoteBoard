//! Post-process only our generated PDFs: extract interactive item bounds,
//! remove private navigation links, then add selectable vector page numbers.
use std::{collections::BTreeMap, path::Path, sync::atomic::{AtomicBool, Ordering}};
use lopdf::{Document, Object, ObjectId, Dictionary, Stream, dictionary, content::{Content, Operation}};
use serde::Serialize;
use super::PdfOptions;

const ITEM_URI: &str = "https://noteboard.invalid/export-item/";
#[derive(Clone, Serialize)]
pub struct ItemLocation { pub id: String, pub page: u32, pub rect: [f32; 4] }
pub struct Processed { pub locations: Vec<ItemLocation>, pub pages: u32, pub size: u64 }

fn resolve<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Object> {
    match object { Object::Reference(id) => doc.get_object(*id).ok(), other => Some(other) }
}
fn inherited(doc: &Document, mut id: ObjectId, key: &[u8]) -> Option<Object> {
    for _ in 0..64 {
        let page = doc.get_dictionary(id).ok()?;
        if let Ok(value) = page.get(key) { return resolve(doc, value).cloned(); }
        id = page.get(b"Parent").ok()?.as_reference().ok()?;
    }
    None
}
fn private_annotation(doc: &Document, value: &Object) -> Option<(String, [f32; 4])> {
    let annotation = resolve(doc, value)?.as_dict().ok()?;
    let action = resolve(doc, annotation.get(b"A").ok()?)?.as_dict().ok()?;
    let uri = std::str::from_utf8(action.get(b"URI").ok()?.as_str().ok()?).ok()?;
    let id = uri.strip_prefix(ITEM_URI)?.to_string();
    let rect = annotation.get(b"Rect").ok()?.as_array().ok()?;
    if rect.len() != 4 { return None; }
    Some((id, [rect[0].as_float().ok()?, rect[1].as_float().ok()?, rect[2].as_float().ok()?, rect[3].as_float().ok()?]))
}

pub fn prepare(input: &Path, output: &Path, options: &PdfOptions, cancelled: &AtomicBool) -> Result<Processed, String> {
    let check = || if cancelled.load(Ordering::Acquire) { Err("导出已取消".to_string()) } else { Ok(()) };
    check()?;
    let mut doc = Document::load(input).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let count = pages.len() as u32;
    let mut locations = BTreeMap::<(String, u32), [f32; 4]>::new();
    let font = options.page_numbers.then(|| doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
    }));
    for (number, id) in pages {
        check()?;
        let annotations = doc.get_dictionary(id).ok().and_then(|p| p.get(b"Annots").ok())
            .and_then(|a| resolve(&doc, a)).and_then(|a| a.as_array().ok()).cloned().unwrap_or_default();
        let mut retained = Vec::new();
        for annotation in annotations {
            if let Some((item, rect)) = private_annotation(&doc, &annotation) {
                locations.entry((item, number)).and_modify(|r| {
                    r[0] = r[0].min(rect[0]); r[1] = r[1].min(rect[1]); r[2] = r[2].max(rect[2]); r[3] = r[3].max(rect[3]);
                }).or_insert(rect);
                if let Object::Reference(id) = annotation { doc.objects.remove(&id); }
            } else { retained.push(annotation); }
        }
        doc.get_dictionary_mut(id).map_err(|e| e.to_string())?.set("Annots", Object::Array(retained));
        if let Some(font) = font {
            // Chromium leaves its initial device-scale CTM outside its own q/Q
            // pairs. Isolate the complete original page before adding PDF-point text.
            let original = doc.get_page_contents(id);
            let prefix = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
            let mut contents = vec![Object::Reference(prefix)];
            contents.extend(original.into_iter().map(Object::Reference));
            doc.get_dictionary_mut(id).map_err(|e| e.to_string())?.set("Contents", Object::Array(contents));
            let media = inherited(&doc, id, b"MediaBox").ok_or("PDF 页面尺寸缺失")?;
            let media = media.as_array().map_err(|e| e.to_string())?;
            let width = media[2].as_float().map_err(|e| e.to_string())?;
            let height = media[3].as_float().map_err(|e| e.to_string())?;
            let mut resources = inherited(&doc, id, b"Resources").and_then(|o| o.as_dict().ok().cloned()).unwrap_or_default();
            let mut fonts = resources.get(b"Font").ok().and_then(|o| resolve(&doc, o)).and_then(|o| o.as_dict().ok()).cloned().unwrap_or_else(Dictionary::new);
            fonts.set("NBPageNumber", font); resources.set("Font", fonts);
            doc.get_dictionary_mut(id).map_err(|e| e.to_string())?.set("Resources", resources);
            let text = match options.page_number_style.as_str() { "total" => format!("{number} / {count}"), "dashes" => format!("- {number} -"), _ => number.to_string() };
            let text_width: f32 = text.chars().map(|c| if c.is_ascii_digit() { 5.004 } else { 2.502 }).sum();
            let horizontal_margin = (options.horizontal_margin_mm as f32 * 72.0 / 25.4).max(12.0);
            let vertical_margin = (options.margin_mm as f32 * 72.0 / 25.4).max(12.0);
            let x = if options.page_number_position.ends_with("left") { horizontal_margin } else if options.page_number_position.ends_with("right") { width - horizontal_margin - text_width } else { (width - text_width) / 2.0 };
            let y = if options.page_number_position.starts_with("top") { height - (vertical_margin / 2.0).max(12.0) } else { (vertical_margin / 2.0 - 3.0).max(6.0) };
            let contents = Content { operations: vec![
                Operation::new("Q", vec![]), Operation::new("q", vec![]), Operation::new("BT", vec![]),
                Operation::new("Tf", vec![Object::Name(b"NBPageNumber".to_vec()), 9.into()]),
                Operation::new("g", vec![0.35f32.into()]), Operation::new("Td", vec![x.into(), y.into()]),
                Operation::new("Tj", vec![Object::string_literal(text)]), Operation::new("ET", vec![]), Operation::new("Q", vec![]),
            ] };
            doc.add_page_contents(id, contents.encode().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        }
    }
    check()?; doc.save(output).map_err(|e| e.to_string())?; check()?;
    Ok(Processed { locations: locations.into_iter().map(|((id, page), rect)| ItemLocation { id, page, rect }).collect(), pages: count,
        size: std::fs::metadata(output).map_err(|e| e.to_string())?.len() })
}
