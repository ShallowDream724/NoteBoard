//! Native classification reads the same catalog used by the front end.

use crate::dto::{DocumentKind, LanguageId};
use serde::Deserialize;
use std::{collections::HashMap, sync::OnceLock};

type Classification = (DocumentKind, LanguageId);
const DEFAULT_CLASSIFICATION: Classification = (DocumentKind::Code, LanguageId::Plaintext);

#[derive(Deserialize)]
struct Format {
    kind: DocumentKind,
    language: LanguageId,
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(default)]
    filenames: Vec<String>,
    #[serde(default)]
    prefixes: Vec<String>,
}

struct Catalog {
    extensions: HashMap<String, Classification>,
    filenames: HashMap<String, Classification>,
    prefixes: Vec<(String, Classification)>,
}

impl Catalog {
    fn new(formats: Vec<Format>) -> Self {
        let mut catalog = Self {
            extensions: HashMap::new(),
            filenames: HashMap::new(),
            prefixes: Vec::new(),
        };
        for format in formats {
            let classification = (format.kind, format.language);
            for extension in format.extensions {
                catalog.extensions.insert(extension, classification);
            }
            for filename in format.filenames {
                catalog.filenames.insert(filename, classification);
            }
            for prefix in format.prefixes {
                catalog.prefixes.push((prefix, classification));
            }
        }
        catalog
            .prefixes
            .sort_by_key(|(prefix, _)| std::cmp::Reverse(prefix.len()));
        catalog
    }

    fn by_extension(&self, extension: &str) -> Classification {
        self.extensions
            .get(&extension.to_lowercase())
            .copied()
            .unwrap_or(DEFAULT_CLASSIFICATION)
    }

    fn by_path(&self, path: &str) -> Classification {
        let name = path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(path)
            .to_lowercase();
        if let Some(classification) = self.filenames.get(&name) {
            return *classification;
        }
        if let Some((_, classification)) = self
            .prefixes
            .iter()
            .find(|(prefix, _)| name.starts_with(prefix))
        {
            return *classification;
        }
        self.by_extension(&extension_from_path(path))
    }
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        Catalog::new(
            serde_json::from_str(include_str!("../../src/core/fileFormats.json"))
                .expect("valid shared file formats"),
        )
    })
}

pub(crate) fn kind_by_extension(extension: &str) -> Classification {
    catalog().by_extension(extension)
}

pub(crate) fn kind_from_path(path: &str) -> Classification {
    catalog().by_path(path)
}

pub(crate) fn extension_from_path(path: &str) -> String {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    name.rsplit_once('.')
        .map(|(_, extension)| extension.to_lowercase())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_metadata_round_trips_through_native_classification() {
        let formats: Vec<Format> =
            serde_json::from_str(include_str!("../../src/core/fileFormats.json")).unwrap();
        for format in formats {
            let expected = (format.kind, format.language);
            for extension in format.extensions {
                assert_eq!(
                    kind_by_extension(&extension.to_uppercase()),
                    expected,
                    "{extension}"
                );
                assert_eq!(
                    kind_from_path(&format!("C:\\code\\sample.{}", extension.to_uppercase())),
                    expected,
                    "{extension}"
                );
            }
            for filename in format.filenames {
                assert_eq!(
                    kind_from_path(&format!("/code/{}", filename.to_uppercase())),
                    expected,
                    "{filename}"
                );
            }
            for prefix in format.prefixes {
                assert_eq!(
                    kind_from_path(&format!("/code/{}sample", prefix.to_uppercase())),
                    expected,
                    "{prefix}"
                );
            }
        }
    }

    #[test]
    fn exact_names_then_longest_prefixes_take_precedence_over_extensions() {
        let catalog = Catalog::new(
            serde_json::from_value(serde_json::json!([
                { "kind": "code", "language": "javascript", "extensions": ["js"] },
                { "kind": "code", "language": "ini", "prefixes": [".env."] },
                { "kind": "code", "language": "yaml", "prefixes": [".env.local."] },
                { "kind": "code", "language": "dockerfile", "filenames": [".env.local.js"] }
            ]))
            .unwrap(),
        );
        assert_eq!(
            catalog.by_path("C:\\work\\.ENV.LOCAL.JS"),
            (DocumentKind::Code, LanguageId::Dockerfile)
        );
        assert_eq!(
            catalog.by_path("/work/.env.local.production.js"),
            (DocumentKind::Code, LanguageId::Yaml)
        );
        assert_eq!(
            catalog.by_path("/work/.env.production.js"),
            (DocumentKind::Code, LanguageId::Ini)
        );
        assert_eq!(
            catalog.by_path("/work/source.js"),
            (DocumentKind::Code, LanguageId::Javascript)
        );
        assert_eq!(catalog.by_path("/work/unknown"), DEFAULT_CLASSIFICATION);
    }
}
