//! Prompt translation.
//!
//! Wraps the `translators` crate (Google Translate, no API key) in one async
//! Tauri command. The frontend never talks to the network itself: the request
//! runs on Tauri's tokio runtime, keeps the card's original text untouched and
//! only ever returns a plain string for the "translated" view.
//!
//! Three things keep it cheap:
//! - a small session cache, so toggling original ↔ translation is instant;
//! - a hard character cap, so a runaway paste cannot turn into a huge upload;
//! - `<lora:…>` / `<embedding:…>` tags are lifted out of the request and
//!   restored verbatim — Google should never "translate" a tag name.

use std::collections::hash_map::DefaultHasher;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

use translators::{GoogleTranslator, Translator};

/// A prompt is a few KB at most; the cap protects the request from a runaway
/// paste. The crate itself splits anything longer than 5 000 chars.
const MAX_CHARS: usize = 40_000;
/// Session cache. Enough for a long browsing session, small enough to forget.
const CACHE_LIMIT: usize = 48;

struct CacheEntry {
    key: u64,
    text: String,
}

static CACHE: Mutex<VecDeque<CacheEntry>> = Mutex::new(VecDeque::new());

fn build_translator() -> GoogleTranslator {
    GoogleTranslator::builder()
        // Seconds. Long prompts arrive in a few chunks; each gets this budget.
        .timeout(20usize)
        .max_concurrency(2usize)
        .build()
}

/// Google language tags are 2–8 ASCII chars (`ru`, `zh-CN`, `pt-BR`). Reject
/// anything else instead of forwarding junk to the endpoint.
pub(crate) fn normalize_target(raw: &str) -> Result<String, String> {
    let target = raw.trim();
    let valid = (2..=8).contains(&target.len())
        && target
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err("TRANSLATE_TARGET".to_string());
    }
    Ok(target.to_string())
}

fn cache_key(text: &str, target: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    target.hash(&mut hasher);
    0u8.hash(&mut hasher); // separator
    text.hash(&mut hasher);
    hasher.finish()
}

fn cache_get(key: u64) -> Option<String> {
    let cache = CACHE.lock().ok()?;
    cache
        .iter()
        .rev()
        .find(|entry| entry.key == key)
        .map(|entry| entry.text.clone())
}

fn cache_put(key: u64, text: String) {
    let Ok(mut cache) = CACHE.lock() else {
        return;
    };
    if let Some(i) = cache.iter().position(|entry| entry.key == key) {
        cache.remove(i);
    }
    cache.push_back(CacheEntry { key, text });
    while cache.len() > CACHE_LIMIT {
        cache.pop_front();
    }
}

/// A prompt is not prose: `<lora:Turbo_Projector:0.65>` must survive a
/// translation byte for byte. Tags are cut out before the request and put
/// back after it, so Google never sees (or rewrites) a model name.
enum Segment<'a> {
    Tag(&'a str),
    Text(&'a str),
}

fn segments(text: &str) -> Vec<Segment<'_>> {
    // A tag is short and single-line; anything else is ordinary text.
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        if open > 0 {
            out.push(Segment::Text(&rest[..open]));
        }
        let tail = &rest[open..];
        match tail.find('>') {
            Some(close) if close > 0 && is_tag_body(&tail[1..close]) => {
                out.push(Segment::Tag(&tail[..=close]));
                rest = &tail[close + 1..];
            }
            _ => {
                // A stray "<" is just text — keep it and move on.
                out.push(Segment::Text("<"));
                rest = &tail[1..];
            }
        }
    }
    if !rest.is_empty() {
        out.push(Segment::Text(rest));
    }
    out
}

/// What sits between `<` and `>` and may be treated as an opaque tag.
///
/// Known invocation tags (`<lora:…>`, `<embedding:…>`) may contain spaces in a
/// model name; anything else has to be whitespace-free, so prose like
/// "1 < 2 and > 0" is never mistaken for a tag and still gets translated.
fn is_tag_body(body: &str) -> bool {
    const KNOWN: [&str; 6] = ["lora:", "lyco:", "locon:", "embedding:", "hypernet:", "style:"];
    if body.is_empty() || body.len() > 96 || body.contains('\n') {
        return false;
    }
    let lower = body.to_ascii_lowercase();
    if KNOWN.iter().any(|prefix| lower.starts_with(prefix)) {
        return true;
    }
    !body.chars().any(char::is_whitespace)
}

async fn translate_one(
    translator: &GoogleTranslator,
    text: &str,
    target: &str,
) -> Result<String, String> {
    translator
        // "" lets Google detect the source language.
        .translate_async(text, "", target)
        .await
        .map_err(|e| {
            // The UI only needs one stable code; the detail goes to the log.
            eprintln!("translate: {e}");
            "TRANSLATE_FAILED".to_string()
        })
}

/// A tag is swapped for one of these before the request. Google keeps the
/// bracketed number as-is, so the whole prompt can go out in a single call —
/// the sentence keeps its context and one prompt costs one round-trip.
const MARKER_OPEN: &str = "[[[";
const MARKER_CLOSE: &str = "]]]";

/// Replaces every tag with `[[[n]]]`, returning the masked text and the tags
/// in index order. `None` when the prompt itself contains the marker syntax
/// (rare, but then the safe per-run path is used instead).
fn mask_tags(text: &str) -> Option<(String, Vec<&str>)> {
    if text.contains(MARKER_OPEN) {
        return None;
    }
    let mut masked = String::with_capacity(text.len() + 8);
    let mut tags = Vec::new();
    for part in segments(text) {
        match part {
            Segment::Text(run) => masked.push_str(run),
            Segment::Tag(tag) => {
                masked.push_str(MARKER_OPEN);
                masked.push_str(&tags.len().to_string());
                masked.push_str(MARKER_CLOSE);
                tags.push(tag);
            }
        }
    }
    Some((masked, tags))
}

/// Puts the tags back. Returns `None` if any marker came back damaged or
/// missing — the caller then falls back to translating run by run.
fn unmask_tags(translated: &str, tags: &[&str]) -> Option<String> {
    let mut out = String::with_capacity(translated.len() + 32);
    let mut rest = translated;
    let mut seen = vec![false; tags.len()];
    while let Some(open) = rest.find(MARKER_OPEN) {
        out.push_str(&rest[..open]);
        let tail = &rest[open + MARKER_OPEN.len()..];
        let close = tail.find(MARKER_CLOSE)?;
        // Google sometimes pads the number ("[[[ 0 ]]]"); the trim forgives it.
        let idx: usize = tail[..close].trim().parse().ok()?;
        let tag = tags.get(idx)?;
        if seen[idx] {
            return None;
        }
        seen[idx] = true;
        out.push_str(tag);
        rest = &tail[close + MARKER_CLOSE.len()..];
    }
    out.push_str(rest);
    if seen.iter().all(|seen| *seen) {
        Some(out)
    } else {
        None
    }
}

/// Google trims what it returns. Put the original run's outer whitespace back,
/// so a tag never ends up glued to the word before it.
fn keep_edges(original: &str, translated: &str) -> String {
    let lead = original.len() - original.trim_start().len();
    let trail = original.len() - original.trim_end().len();
    let mut out = String::with_capacity(translated.len() + lead + trail);
    out.push_str(&original[..lead]);
    out.push_str(translated.trim());
    out.push_str(&original[original.len() - trail..]);
    out
}

async fn translate_preserving_tags(
    translator: &GoogleTranslator,
    text: &str,
    target: &str,
) -> Result<String, String> {
    let parts = segments(text);
    if !parts.iter().any(|part| matches!(part, Segment::Tag(_))) {
        return translate_one(translator, text, target).await;
    }

    if let Some((masked, tags)) = mask_tags(text) {
        let translated = translate_one(translator, &masked, target).await?;
        if let Some(restored) = unmask_tags(&translated, &tags) {
            return Ok(restored);
        }
    }

    // Fallback: translate each text run on its own and keep tags untouched.
    let mut out = String::with_capacity(text.len() + 32);
    for part in parts {
        match part {
            Segment::Tag(tag) => out.push_str(tag),
            Segment::Text(run) => {
                if run.trim().is_empty() {
                    // Whitespace between two tags stays exactly as it was.
                    out.push_str(run);
                } else {
                    let translated = translate_one(translator, run.trim(), target).await?;
                    out.push_str(&keep_edges(run, &translated));
                }
            }
        }
    }
    Ok(out)
}

/// Translate one prompt page into `target` (a Google language code).
#[tauri::command]
pub async fn translate_prompt(text: String, target: String) -> Result<String, String> {
    let target = normalize_target(&target)?;
    let text = text.trim();
    if text.is_empty() {
        return Err("TRANSLATE_EMPTY".to_string());
    }
    if text.chars().count() > MAX_CHARS {
        return Err("TRANSLATE_TOO_LONG".to_string());
    }

    let key = cache_key(text, &target);
    if let Some(hit) = cache_get(key) {
        return Ok(hit);
    }

    let translator = build_translator();
    let translated = translate_preserving_tags(&translator, text, &target).await?;
    let translated = translated.trim().to_string();
    if translated.is_empty() {
        return Err("TRANSLATE_EMPTY".to_string());
    }

    cache_put(key, translated.clone());
    Ok(translated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_of(parts: &[Segment<'_>]) -> Vec<String> {
        parts
            .iter()
            .map(|p| match p {
                Segment::Tag(t) => format!("T:{t}"),
                Segment::Text(t) => format!("X:{t}"),
            })
            .collect()
    }

    #[test]
    fn tags_are_split_out_of_text() {
        let parts = segments("a cat, <lora:Turbo:0.65>, soft light");
        assert_eq!(
            text_of(&parts),
            vec!["X:a cat, ", "T:<lora:Turbo:0.65>", "X:, soft light"]
        );
    }

    #[test]
    fn stray_bracket_stays_text() {
        let parts = segments("1 < 2 and > 0");
        assert_eq!(text_of(&parts), vec!["X:1 ", "X:<", "X: 2 and > 0"]);
    }

    #[test]
    fn newline_inside_angle_brackets_is_not_a_tag() {
        let parts = segments("a < b\nc > d");
        assert!(parts.iter().all(|p| matches!(p, Segment::Text(_))));
    }

    #[test]
    fn tag_with_spaces_in_the_name_survives() {
        let parts = segments("portrait <lora:My Style:0.6>");
        assert_eq!(
            text_of(&parts),
            vec!["X:portrait ", "T:<lora:My Style:0.6>"]
        );
    }

    #[test]
    fn target_codes_are_validated() {
        assert_eq!(normalize_target(" ru "), Ok("ru".to_string()));
        assert_eq!(normalize_target("zh-CN"), Ok("zh-CN".to_string()));
        assert!(normalize_target("").is_err());
        assert!(normalize_target("../../x").is_err());
        assert!(normalize_target("a b").is_err());
    }

    #[test]
    fn tags_are_masked_and_restored() {
        let (masked, tags) = mask_tags("a cat, <lora:Turbo:0.65>, soft").expect("mask");
        assert_eq!(masked, "a cat, [[[0]]], soft");
        assert_eq!(tags, vec!["<lora:Turbo:0.65>"]);

        // A padded number still maps back to the tag.
        assert_eq!(
            unmask_tags("кот, [[[ 0 ]]], мягкий", &tags),
            Some("кот, <lora:Turbo:0.65>, мягкий".to_string())
        );
    }

    #[test]
    fn damaged_or_missing_markers_fall_back() {
        let (_, tags) = mask_tags("a cat <lora:X:1>").expect("mask");
        // Google dropped the marker.
        assert_eq!(unmask_tags("кот", &tags), None);
        // Google duplicated it.
        assert_eq!(unmask_tags("[[[0]]] [[[0]]]", &tags), None);
        // Google garbled it.
        assert_eq!(unmask_tags("[[[zero]]]", &tags), None);
    }

    #[test]
    fn prompt_that_contains_the_marker_is_not_masked() {
        assert!(mask_tags("text [[[0]]] <lora:X:1>").is_none());
    }

    #[test]
    fn keep_edges_restores_outer_whitespace() {
        assert_eq!(keep_edges(" soft light\n", "мягкий свет"), " мягкий свет\n");
        assert_eq!(keep_edges("no space", "без пробела"), "без пробела");
    }
}
