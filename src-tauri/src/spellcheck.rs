use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

// ── Spellcheck (Hunspell via spellbook) ───────────────────────────────────────

/// Lazily-loaded Hunspell dictionaries, keyed by language code (e.g. "en_US").
/// Each dictionary is loaded once from bundled resource files and kept for the
/// lifetime of the process.
static DICTIONARIES: OnceLock<Mutex<HashMap<String, spellbook::Dictionary>>> = OnceLock::new();

/// Discover bundled dictionary language codes (e.g. "en_US").
fn discover_dictionary_languages() -> Vec<String> {
    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let exe_dir = match exe.parent() {
        Some(d) => d.to_path_buf(),
        None => return vec![],
    };

    let candidates = [
        exe_dir.join("resources/dictionaries"),
        exe_dir.join("../Resources/resources/dictionaries"),
        PathBuf::from("src-tauri/resources/dictionaries"),
    ];

    let dir = match candidates.iter().find(|p| p.is_dir()) {
        Some(d) => d,
        None => return vec![],
    };

    let mut langs: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            if !entry.path().is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let aff = entry.path().join(format!("{name}.aff"));
            let dic = entry.path().join(format!("{name}.dic"));
            if aff.exists() && dic.exists() {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    langs.sort();
    langs
}

fn validate_dictionary_language(raw: &str) -> Result<String, String> {
    let lang = raw.trim();
    if lang.is_empty() || lang.len() > 32 {
        return Err("Invalid dictionary language.".into());
    }
    if !lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Dictionary language contains invalid characters.".into());
    }
    let available = discover_dictionary_languages();
    if !available.iter().any(|d| d == lang) {
        return Err(format!("Unsupported dictionary language: {lang}"));
    }
    Ok(lang.to_string())
}

/// Load a Hunspell dictionary from the bundled resources directory.
/// Dictionary files live at `resources/dictionaries/<lang>/<lang>.aff` and `.dic`.
fn load_dictionary(lang: &str) -> Result<spellbook::Dictionary, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Cannot locate exe: {e}"))?;
    let exe_dir = exe.parent().ok_or("Cannot locate exe directory")?;

    // In dev builds (cargo/tauri dev), resources are at `src-tauri/resources/`.
    // In production bundles, Tauri copies them next to the binary.
    let candidates = [
        exe_dir.join(format!("resources/dictionaries/{lang}/{lang}.aff")),
        exe_dir
            .join("../Resources")
            .join(format!("resources/dictionaries/{lang}/{lang}.aff")),
        PathBuf::from(format!(
            "src-tauri/resources/dictionaries/{lang}/{lang}.aff"
        )),
    ];

    let base = candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| format!("Dictionary files not found for '{lang}'"))?
        .parent()
        .unwrap()
        .to_path_buf();

    let aff = fs::read_to_string(base.join(format!("{lang}.aff")))
        .map_err(|e| format!("Failed to read {lang}.aff: {e}"))?;
    let dic = fs::read_to_string(base.join(format!("{lang}.dic")))
        .map_err(|e| format!("Failed to read {lang}.dic: {e}"))?;

    spellbook::Dictionary::new(&aff, &dic)
        .map_err(|e| format!("Failed to parse dictionary '{lang}': {e}"))
}

fn get_or_load_dict(lang: &str) -> Result<(), String> {
    let map_mutex = DICTIONARIES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = map_mutex.lock().unwrap();
    if !map.contains_key(lang) {
        let dict = load_dictionary(lang)?;
        map.insert(lang.to_string(), dict);
    }
    Ok(())
}

/// Check a batch of words against a Hunspell dictionary.
/// Returns only the words that are NOT in the dictionary.
/// The `language` parameter selects which dictionary to use (e.g. "en_US", "en_GB").
#[tauri::command]
pub fn check_spelling(words: Vec<String>, language: String) -> Result<Vec<String>, String> {
    const MAX_WORDS: usize = 10_000;
    const MAX_WORD_LEN: usize = 128;
    if words.len() > MAX_WORDS {
        return Err(format!("Too many words provided (max {MAX_WORDS})."));
    }
    let language = validate_dictionary_language(&language)?;
    get_or_load_dict(&language)?;
    let map_mutex = DICTIONARIES.get_or_init(|| Mutex::new(HashMap::new()));
    let map = map_mutex.lock().unwrap();
    let dict = map
        .get(&language)
        .ok_or_else(|| format!("Dictionary '{language}' not loaded"))?;

    Ok(words
        .into_iter()
        .filter(|w| {
            if w.len() > MAX_WORD_LEN {
                return false;
            }
            w.len() > 1
                && w.chars().all(|c| c.is_alphabetic() || c == '\'' || c == '\u{2019}')
                && !dict.check(w)
        })
        .collect())
}

/// Return spelling suggestions for a batch of misspelled words.
/// For each input word, returns up to 5 Hunspell suggestions.
/// The result is a map from each word to its suggestion list.
#[tauri::command]
pub fn suggest_spelling(
    words: Vec<String>,
    language: String,
) -> Result<HashMap<String, Vec<String>>, String> {
    const MAX_SUGGESTIONS: usize = 5;
    const MAX_WORDS: usize = 50;

    let language = validate_dictionary_language(&language)?;
    get_or_load_dict(&language)?;
    let map_mutex = DICTIONARIES.get_or_init(|| Mutex::new(HashMap::new()));
    let map = map_mutex.lock().unwrap();
    let dict = map
        .get(&language)
        .ok_or_else(|| format!("Dictionary '{language}' not loaded"))?;

    let mut result = HashMap::new();
    for word in words.iter().take(MAX_WORDS) {
        let mut suggestions = Vec::new();
        dict.suggest(word, &mut suggestions);
        suggestions.truncate(MAX_SUGGESTIONS);
        result.insert(word.clone(), suggestions);
    }

    Ok(result)
}

/// Return the list of available dictionary language codes by scanning the
/// bundled resources directory.
#[tauri::command]
pub fn list_dictionaries() -> Vec<String> {
    discover_dictionary_languages()
}
