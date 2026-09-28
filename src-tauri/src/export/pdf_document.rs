//! Post-process only our generated PDFs: extract interactive item bounds,
//! remove private navigation links, then add selectable vector page numbers.
use std::{collections::{BTreeMap, BTreeSet}, path::Path, sync::atomic::{AtomicBool, Ordering}};
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

// Chromium can leave a sub-pixel inline-link slice at a printable page edge
// when a heading moves with its following block. It contains no formula text,
// but the preview's minimum hit-target height makes it look like another error.
// Require both the page-edge geometry and another substantial fragment elsewhere;
// isolated tiny formulas and the deliberately 1px (possibly scaled) table
// markers remain navigable.
fn empty_formula_slice(item: &str, rect: &[f32; 4], edges: [f32; 2]) -> bool {
    item.starts_with("formula-") && rect[3] - rect[1] < 0.5
        && ((rect[1] - edges[0]).abs() <= 0.75 || (rect[3] - edges[1]).abs() <= 0.75)
}

pub fn prepare(input: &Path, output: &Path, options: &PdfOptions, cancelled: &AtomicBool) -> Result<Processed, String> {
    let check = || if cancelled.load(Ordering::Acquire) { Err("导出已取消".to_string()) } else { Ok(()) };
    check()?;
    let mut doc = Document::load(input).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let count = pages.len() as u32;
    let mut locations = BTreeMap::<(String, u32), [f32; 4]>::new();
    let mut empty_slices = BTreeSet::new();
    let font = options.page_numbers.then(|| doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
    }));
    for (number, id) in pages {
        check()?;
        let edges = inherited(&doc, id, b"MediaBox").and_then(|media| {
            let media = media.as_array().ok()?;
            let (top, bottom) = options.vertical_margins_mm();
            Some([media.get(1)?.as_float().ok()? + bottom as f32 * 72.0 / 25.4,
                media.get(3)?.as_float().ok()? - top as f32 * 72.0 / 25.4])
        });
        let annotations = doc.get_dictionary(id).ok().and_then(|p| p.get(b"Annots").ok())
            .and_then(|a| resolve(&doc, a)).and_then(|a| a.as_array().ok()).cloned().unwrap_or_default();
        let mut retained = Vec::new();
        for annotation in annotations {
            if let Some((item, rect)) = private_annotation(&doc, &annotation) {
                if edges.is_some_and(|edges| empty_formula_slice(&item, &rect, edges)) {
                    empty_slices.insert((item.clone(), number));
                }
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
    if !empty_slices.is_empty() {
        let substantial_items: BTreeSet<_> = locations.iter().filter(|((item, _), rect)| item.starts_with("formula-") && rect[3] - rect[1] >= 0.5)
            .map(|((item, _), _)| item.clone()).collect();
        locations.retain(|key, rect| rect[3] - rect[1] >= 0.5 || !empty_slices.contains(key) || !substantial_items.contains(&key.0));
    }
    check()?; doc.save(output).map_err(|e| e.to_string())?; check()?;
    Ok(Processed { locations: locations.into_iter().map(|((id, page), rect)| ItemLocation { id, page, rect }).collect(), pages: count,
        size: std::fs::metadata(output).map_err(|e| e.to_string())?.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> PdfOptions {
        serde_json::from_value(serde_json::json!({
            "paper": "A4", "landscape": false, "marginMm": 12.0, "horizontalMarginMm": 12.0,
            "fontPt": 10.5, "lineHeight": 1.4, "pageNumbers": false,
            "pageNumberPosition": "bottom-center", "pageNumberStyle": "number", "items": {}
        })).unwrap()
    }

    fn annotation(doc: &mut Document, item: &str, bottom: f32, height: f32) -> Object {
        let uri = if item.starts_with("https:") { item.to_string() } else { format!("{ITEM_URI}{item}") };
        Object::Reference(doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Link",
            "Rect" => vec![100.0f32.into(), bottom.into(), 200.0f32.into(), (bottom + height).into()],
            "A" => dictionary! { "S" => "URI", "URI" => Object::string_literal(uri) },
        }))
    }

    fn assert_private_links_removed(path: &Path) {
        let doc = Document::load(path).unwrap();
        for id in doc.get_pages().values() {
            for annotation in doc.get_dictionary(*id).unwrap().get(b"Annots").unwrap().as_array().unwrap() {
                assert!(private_annotation(&doc, annotation).is_none());
            }
        }
    }

    #[test]
    fn removes_only_duplicate_formula_slices_at_printable_edges() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("input.pdf");
        let output = dir.path().join("output.pdf");
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let mut kids = Vec::new();
        for number in 1..=2 {
            let specs = if number == 1 {
                vec![("formula-ghost", 34.12, 0.26), ("formula-top-ghost", 807.7, 0.28),
                    ("formula-tiny-edge", 34.12, 0.26), ("formula-tiny-middle", 100.0, 0.26),
                    ("table-1", 34.12, 0.26), ("formula-multi-tiny", 34.12, 0.26),
                    ("formula-regular-edge", 34.12, 0.6), ("https://example.com/", 34.12, 0.26)]
            } else {
                vec![("formula-ghost", 780.0, 20.0), ("formula-top-ghost", 780.0, 20.0),
                    ("formula-tiny-middle", 700.0, 20.0), ("table-1", 650.0, 0.26),
                    ("formula-multi-tiny", 600.0, 0.26), ("formula-regular-edge", 550.0, 20.0)]
            };
            let annotations: Vec<_> = specs.into_iter().map(|(item, bottom, height)| annotation(&mut doc, item, bottom, height)).collect();
            kids.push(Object::Reference(doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()], "Annots" => annotations })));
        }
        doc.objects.insert(pages, dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => 2 }.into());
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        doc.trailer.set("Root", catalog);
        doc.save(&input).unwrap();
        let processed = prepare(&input, &output, &options(), &AtomicBool::new(false)).unwrap();
        assert_eq!(processed.locations.len(), 11);
        assert!(processed.locations.iter().filter(|location| location.id == "formula-ghost" || location.id == "formula-top-ghost").all(|location| location.page == 2));
        assert!(processed.locations.iter().any(|location| location.id == "formula-tiny-edge" && location.page == 1));
        assert_private_links_removed(&output);
        let saved = Document::load(&output).unwrap();
        let first = saved.get_pages()[&1];
        assert_eq!(saved.get_dictionary(first).unwrap().get(b"Annots").unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    #[ignore = "run through scripts/check-export-item-pagination.mjs with fresh Chromium PDFs"]
    fn chromium_generated_pagination() {
        let dir = std::env::var_os("NOTEBOARD_PDF_PAGINATION_FIXTURES").expect("generated fixture directory");
        for spacer in [900, 925, 950, 975, 1000] {
            let input = Path::new(&dir).join(format!("export-item-pagination-{spacer}.pdf"));
            let output = input.with_extension("processed.pdf");
            let processed = prepare(&input, &output, &options(), &AtomicBool::new(false)).unwrap();
            assert_eq!(processed.pages, 2);
            let formula: Vec<_> = processed.locations.iter().filter(|location| location.id == "formula-error").collect();
            assert_eq!(formula.len(), 1, "{spacer}px: only the page containing formula text has a marker");
            assert_eq!(formula[0].page, 2);
            assert_private_links_removed(&output);
            std::fs::write(input.with_extension("locations.json"), serde_json::to_vec_pretty(&processed.locations).unwrap()).unwrap();
        }
    }
}
