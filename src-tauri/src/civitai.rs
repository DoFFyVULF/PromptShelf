//! Import from CivitAI: image URL → staged photo + prefilled card data.
//!
//! Uses the public (no-auth) REST API; a stored API key is only used as a
//! retry when the anonymous request comes back empty (region/NSFW gating).
//! Everything goes over blocking HTTP on a worker thread so the UI stays
//! responsive.

use crate::images;
use crate::models::{es, CivitaiImport, CivitaiLoraImport, Lora, MetaItem, PasteImageResult};
use serde_json::Value;
use std::collections::HashSet;
use std::io::Read;
use std::time::Duration;

const MAX_LORAS: usize = 24; // mirrors cards::clean_loras / LoraEditor
const MAX_META_ROWS: usize = 24;
const MAX_TAGS: usize = 40;
const MAX_RESOLVE_REQUESTS: usize = 12;
const MAX_IMAGE_BYTES: u64 = 48 * 1024 * 1024;

// ---------------------------------------------------------------- link

type LinkKind = &'static str; // "images" | "posts"

fn parse_link(raw: &str) -> Result<(LinkKind, String), String> {
    let s = raw.trim();
    let without_scheme = s.split("://").last().unwrap_or(s);
    let mut host_rest = without_scheme.splitn(2, '/');
    let host = host_rest.next().unwrap_or("").to_ascii_lowercase();
    let rest = host_rest.next().unwrap_or("");
    if host != "civitai.com" && host != "civitai.red" && !host.ends_with(".civitai.com") {
        return Err("CIVITAI_URL".to_string());
    }
    // only compare the path; drop query/hash
    let path = rest.split(['?', '#']).next().unwrap_or("");
    let segs: Vec<&str> = path.split('/').filter(|x| !x.is_empty()).collect();
    for i in 0..segs.len().saturating_sub(1) {
        let kind = if segs[i] == "images" {
            "images"
        } else if segs[i] == "posts" {
            "posts"
        } else {
            continue;
        };
        let id = segs[i + 1];
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
            return Ok((kind, id.to_string()));
        }
    }
    Err("CIVITAI_URL".to_string())
}

// ---------------------------------------------------------------- http

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout_read(Duration::from_secs(60))
        .user_agent("PromptShelf/0.1")
        .build()
}

fn get_json(
    agent: &ureq::Agent,
    path: &str,
    api_key: Option<&str>,
) -> Result<Option<Value>, String> {
    let mut req = agent.get(&format!("https://civitai.com{path}"));
    // The site's tRPC endpoints ("internal" API) reject third-party callers with
    // a 401 unless the request looks like it comes from civitai.com itself —
    // the gate reads the Origin/Referer host (createContext.ts →
    // isAllowedOriginRequest). Sending the site's own Origin unlocks them,
    // anonymous and with a key alike.
    req = req.set("Origin", "https://civitai.com");
    if let Some(k) = api_key {
        req = req.set("Authorization", &format!("Bearer {k}"));
    }
    match req.call() {
        Ok(resp) => {
            let mut body = String::new();
            resp.into_reader()
                .take(8 * 1024 * 1024)
                .read_to_string(&mut body)
                .map_err(|e| format!("CIVITAI_NETWORK: {e}"))?;
            let v: Value = serde_json::from_str(&body)
                .map_err(|e| format!("CIVITAI_NETWORK: bad json: {e}"))?;
            Ok(Some(v))
        }
        // 404 (deleted), 401/403 (gated) → treat as "not available"
        Err(ureq::Error::Status(404, _)) | Err(ureq::Error::Status(401, _))
        | Err(ureq::Error::Status(403, _)) => Ok(None),
        Err(e) => Err(format!("CIVITAI_NETWORK: {e}")),
    }
}

fn get_bytes(agent: &ureq::Agent, url: &str) -> Result<Vec<u8>, String> {
    let resp = agent
        .get(url)
        .call()
        .map_err(|e| format!("CIVITAI_NETWORK: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(MAX_IMAGE_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("CIVITAI_NETWORK: {e}"))?;
    Ok(bytes)
}

// ---------------------------------------------------------------- json helpers

/// Scalar → display string. Strings trimmed, numbers without float noise.
fn scalar(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        let s = s.trim();
        return if s.is_empty() { None } else { Some(s.to_string()) };
    }
    if let Some(n) = v.as_i64() {
        return Some(n.to_string());
    }
    if let Some(n) = v.as_u64() {
        return Some(n.to_string());
    }
    if let Some(n) = v.as_f64() {
        return Some(if n.fract().abs() < f64::EPSILON {
            format!("{}", n as i64)
        } else {
            format!("{n}")
        });
    }
    None
}

fn pick(meta: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| meta.get(k).and_then(scalar))
}

/// Numeric lora weight ("1", "0.85", "-0.5"); integers drop the trailing ".0".
fn weight_of(part: &str) -> Option<String> {
    let t = part.trim();
    let f: f64 = t.parse().ok()?;
    if !f.is_finite() {
        return None;
    }
    Some(if f.fract().abs() < f64::EPSILON {
        format!("{}", f as i64)
    } else {
        format!("{f}")
    })
}

/// A1111/ComfyUI prompt lora tags: <lora:name:weight>, <lora:name:path:weight>,
/// also the xA "lyra" spelling. Works on byte-identical ASCII-lowercase copy.
fn parse_lora_tags(prompt: &str) -> Vec<Lora> {
    let low = prompt.to_ascii_lowercase();
    let mut out: Vec<Lora> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for marker in ["<lora:", "<lyra:"] {
        let mut from = 0usize;
        while out.len() < MAX_LORAS {
            let Some(rel) = low[from..].find(marker) else { break };
            let start = from + rel + marker.len();
            let Some(rel_end) = low[start..].find('>') else { break };
            let end = start + rel_end;
            let chunk = &prompt[start..end];
            let parts: Vec<&str> = chunk.split(':').collect();
            if let Some(name) = parts.first().map(|n| n.trim()).filter(|n| !n.is_empty() && n.len() <= 64) {
                let value = parts.iter().rev().find_map(|p| weight_of(p)).unwrap_or_else(|| "1".to_string());
                if seen.insert(name.to_lowercase()) {
                    out.push(Lora { name: name.to_string(), value });
                }
            }
            from = end + 1;
        }
    }
    out
}

/// Resolve a model-version id to its display name ("Grippy Pussy"), one
/// small request each — only used when the prompt itself has no lora tags.
fn resolve_name(agent: &ureq::Agent, api_key: Option<&str>, id: i64) -> Option<String> {
    let v = get_json(agent, &format!("/api/v1/model-versions/{id}"), api_key).ok()??;
    v.get("model")
        .and_then(|m| m.get("name"))
        .and_then(scalar)
        .or_else(|| v.get("name").and_then(scalar))
}

fn loras_from_civitai_resources(
    agent: &ureq::Agent,
    api_key: Option<&str>,
    meta: &Value,
) -> Vec<Lora> {
    let mut out: Vec<Lora> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let Some(arr) = meta.get("civitaiResources").and_then(|r| r.as_array()) else {
        return out;
    };
    let mut requests = 0usize;
    for r in arr {
        if out.len() >= MAX_LORAS || requests >= MAX_RESOLVE_REQUESTS {
            break;
        }
        if r.get("type").and_then(|t| t.as_str()) != Some("lora") {
            continue;
        }
        let Some(id) = r.get("modelVersionId").and_then(|v| v.as_i64()) else { continue };
        let value = r.get("weight").and_then(scalar).unwrap_or_else(|| "1".to_string());
        requests += 1;
        let Some(name) = resolve_name(agent, api_key, id) else { continue };
        if seen.insert(name.to_lowercase()) {
            out.push(Lora { name, value });
        }
    }
    out
}

fn loras_from_resources(meta: &Value) -> Vec<Lora> {
    let mut out: Vec<Lora> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    if let Some(arr) = meta.get("resources").and_then(|r| r.as_array()) {
        for r in arr {
            if out.len() >= MAX_LORAS {
                break;
            }
            if r.get("type").and_then(|t| t.as_str()) != Some("lora") {
                continue;
            }
            let Some(name) = r.get("name").and_then(scalar).filter(|n| n.len() <= 64) else {
                continue;
            };
            if seen.insert(name.to_lowercase()) {
                out.push(Lora {
                    name,
                    value: r.get("weight").and_then(scalar).unwrap_or_else(|| "1".to_string()),
                });
            }
        }
    }
    out
}

/// "Other metadata": the curated generation parameters in a stable order,
/// then any leftover scalar keys from importers we don't know.
fn other_meta(meta: &Value, item: &Value) -> Vec<MetaItem> {
    let mut rows: Vec<MetaItem> = Vec::new();
    if rows.len() < MAX_META_ROWS {
        if let Some(v) = pick(meta, &["seed", "Seed"]) {
            rows.push(MetaItem { k: "Seed".to_string(), v });
        }
    }
    if rows.len() < MAX_META_ROWS {
        if let Some(v) = pick(meta, &["steps", "Steps"]) {
            rows.push(MetaItem { k: "Steps".to_string(), v });
        }
    }
    if rows.len() < MAX_META_ROWS {
        if let Some(v) = pick(meta, &["sampler", "Sampler", "sampler_name"]) {
            rows.push(MetaItem { k: "Sampler".to_string(), v });
        }
    }
    if rows.len() < MAX_META_ROWS {
        if let Some(v) = pick(meta, &["cfgScale", "CFG scale", "cfg_scale", "Guidance"]) {
            rows.push(MetaItem { k: "CFG".to_string(), v });
        }
    }
    let w = pick(meta, &["width"]).unwrap_or_else(|| item.get("width").and_then(scalar).unwrap_or_default());
    let h = pick(meta, &["height"]).or_else(|| item.get("height").and_then(scalar)).unwrap_or_default();
    if !w.is_empty() && !h.is_empty() && rows.len() < MAX_META_ROWS {
        rows.push(MetaItem { k: "Size".to_string(), v: format!("{w} × {h}") });
    }
    if rows.len() < MAX_META_ROWS {
        if let Some(v) = pick(meta, &["Model hash", "model_hash"]) {
            rows.push(MetaItem { k: "Model hash".to_string(), v });
        }
    }
    if rows.len() < MAX_META_ROWS {
        if let Some(v) = pick(meta, &["VAE", "vae"]) {
            rows.push(MetaItem { k: "VAE".to_string(), v });
        }
    }
    if rows.len() < MAX_META_ROWS {
        if let Some(v) = pick(meta, &["Version", "version", "ComfyUI"]) {
            rows.push(MetaItem { k: "Version".to_string(), v });
        }
    }

    // leftovers: scalar values only, both casings consumed above
    let named: HashSet<&str> = [
        "prompt", "negativePrompt", "negative", "Negative prompt", "uc", "negative_prompt", "Model", "resources", "civitaiResources", "seed", "Seed",
        "steps", "Steps", "sampler", "Sampler", "sampler_name", "cfgScale", "CFG scale",
        "cfg_scale", "Guidance", "width", "height", "Model hash", "model_hash", "VAE", "vae",
        "Version", "version", "ComfyUI", "id",
    ]
    .into_iter()
    .collect();
    if let Some(obj) = meta.as_object() {
        for (k, v) in obj {
            if rows.len() >= MAX_META_ROWS {
                break;
            }
            if named.contains(k.as_str()) || !v.is_string() && !v.is_number() {
                continue;
            }
            let Some(v) = scalar(v) else { continue };
            let v = if v.len() > 120 { format!("{}…", &v[..117]) } else { v };
            rows.push(MetaItem { k: k.to_string(), v });
        }
    }
    rows
}

// ---------------------------------------------------------------- flow

/// `/images?withMeta=true` wraps the generation data one level deeper:
///   item.meta = { id: <imageId>, meta: { seed, prompt, resources, … } }
/// Older payloads keep the flat shape, so unwrap only when the envelope is seen.
fn meta_view(item: &Value) -> Option<&Value> {
    let m = item.get("meta")?;
    if m.get("meta").is_some() && m.get("id").is_some() {
        m.get("meta")
    } else {
        Some(m)
    }
}

fn fetch_image_item(agent: &ureq::Agent, id: &str, api_key: &str) -> Result<Value, String> {
    let path = format!("/api/v1/images?imageId={id}&withMeta=true&nsfw=X");
    let first = get_json(agent, &path, None)?;
    let mut item = first
        .as_ref()
        .and_then(|v| v.get("items"))
        .and_then(|i| i.as_array())
        .and_then(|a| a.first().cloned());
    // Anonymous fetch can come back empty on NSFW/region filtering — the key lifts it.
    if item.is_none() && !api_key.is_empty() {
        item = get_json(agent, &path, Some(api_key))?
            .and_then(|v| v.get("items").and_then(|i| i.as_array()).and_then(|a| a.first().cloned()));
    }
    item.ok_or_else(|| "CIVITAI_NOT_FOUND".to_string())
}

fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// The image page's "Tags" panel = post tags + community-voted/automated tags,
/// served by `tag.getVotableTags`. Anonymous tRPC gets 401 "use the public API"
/// UNLESS the request carries the site's own Origin header (see get_json), so
/// this works without an API key. Silently degrades on errors.
fn votable_tags(agent: &ureq::Agent, api_key: Option<&str>, image_id: &str) -> Vec<String> {
    // The tRPC input schema is `id: z.number()` — a string id fails validation.
    let Ok(id) = image_id.parse::<i64>() else {
        return Vec::new();
    };
    let input = serde_json::json!({ "json": { "type": "image", "id": id } });
    let Ok(input) = serde_json::to_string(&input) else {
        return Vec::new();
    };
    let path = format!("/api/trpc/tag.getVotableTags?input={}", pct_encode(&input));
    let Ok(Some(v)) = get_json(agent, &path, api_key) else {
        return Vec::new();
    };
    // tRPC + superjson envelope: {"result":{"data":{"json":[tags…],"meta":…}}}
    let arr = v
        .pointer("/result/data/json")
        .and_then(|j| j.as_array())
        .or_else(|| v.pointer("/result/data").and_then(|d| d.as_array()))
        .or_else(|| v.as_array());
    let Some(arr) = arr else { return Vec::new() };
    let mut out = Vec::new();
    for t in arr.iter().take(MAX_TAGS) {
        if let Some(name) = t.get("name").and_then(scalar) {
            out.push(name);
        }
    }
    out
}

fn run(data_dir: &std::path::Path, url: &str) -> Result<CivitaiImport, String> {
    let (kind, id) = parse_link(url)?;
    // exact duplicate origin: re-importing the same link later is detected
    // before the image is even downloaded
    let source_key = crate::dedup::civitai_key(kind, &id);
    let agent = agent();
    let api_key: String = crate::store::open(data_dir)
        .and_then(|c| crate::store::read_settings(&c))
        .map(|s| s.civitai_api_key)
        .unwrap_or_default();

    let mut post: Option<Value> = None;

    // post link → take the first image of that post
    let image_id = if kind == "posts" {
        let p = get_json(&agent, &format!("/api/v1/posts/{id}"), option_key(&api_key))?
            .ok_or_else(|| "CIVITAI_NOT_FOUND".to_string())?;
        let first_img = p
            .get("images")
            .and_then(|i| i.as_array())
            .and_then(|a| a.first())
            .and_then(|i| i.get("id").and_then(|v| v.as_i64()));
        let Some(img_id) = first_img else {
            return Err("CIVITAI_NO_IMAGE".to_string());
        };
        post = Some(p);
        img_id.to_string()
    } else {
        id.clone()
    };

    let item = fetch_image_item(&agent, &image_id, &api_key)?;
    let meta = meta_view(&item).unwrap_or(&Value::Null);

    let prompt = meta
        .get("prompt")
        .and_then(scalar)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    // CivitAI stores the negative under different keys depending on the
    // importer: "negativePrompt" is the common A1111/Forge casing, snake_case
    // and "Negative prompt" occur too; "uc" is NovelAI's unconditional prompt.
    let negative_prompt = pick(
        meta,
        &["negativePrompt", "negative_prompt", "Negative prompt", "negative", "uc"],
    )
    .map(|s| s.trim().to_string())
    .unwrap_or_default();

    // LoRAs: prompt tags first (no requests), then civitaiResources → API lookup,
    // finally the legacy "resources" name/weight list.
    let mut loras = parse_lora_tags(&prompt);
    if loras.is_empty() {
        loras = loras_from_civitai_resources(&agent, option_key(&api_key), meta);
        if loras.is_empty() {
            loras = loras_from_resources(meta);
        }
    }

    // Checkpoint: A1111-style meta "Model", else resolve the checkpoint version.
    let mut checkpoint = meta.get("Model").and_then(scalar).unwrap_or_default();
    if checkpoint.is_empty() {
        if let Some(vid) = meta
            .get("civitaiResources")
            .and_then(|r| r.as_array())
            .and_then(|a| a.iter().find(|r| r.get("type").and_then(|t| t.as_str()) == Some("checkpoint")))
            .and_then(|r| r.get("modelVersionId").and_then(|v| v.as_i64()))
        {
            checkpoint = resolve_name(&agent, option_key(&api_key), vid).unwrap_or_default();
        }
    }

    // Tags: the post carries the uploader's tags; the extra community-voted
    // tags shown on the image page need an API key (tRPC is gated otherwise).
    let mut tags: Vec<String> = Vec::new();
    let post = match post {
        Some(p) => Some(p),
        None => item
            .get("postId")
            .and_then(|v| v.as_i64())
            .and_then(|pid| get_json(&agent, &format!("/api/v1/posts/{pid}"), None).ok())
            .flatten(),
    };
    let tags_arr = post
        .as_ref()
        .and_then(|p| p.get("tags"))
        .and_then(|t| t.as_array())
        .cloned();
    if let Some(tags_arr) = tags_arr {
        for t in tags_arr.iter().take(MAX_TAGS) {
            if let Some(name) = t.get("name").and_then(scalar) {
                tags.push(name);
            }
        }
    }
    if tags.len() < MAX_TAGS {
        let mut seen: HashSet<String> = tags.iter().map(|s| s.to_lowercase()).collect();
        for name in votable_tags(&agent, option_key(&api_key), &image_id) {
            if tags.len() >= MAX_TAGS {
                break;
            }
            if seen.insert(name.to_lowercase()) {
                tags.push(name);
            }
        }
    }

    // author: image username → post user
    let author = item
        .get("username")
        .and_then(scalar)
        .or_else(|| item.get("user").and_then(|u| u.get("username")).and_then(scalar))
        .or_else(|| {
            post.as_ref()
                .and_then(|p| p.get("user"))
                .and_then(|u| u.get("username"))
                .and_then(scalar)
        })
        .unwrap_or_default();

    let meta_rows = other_meta(meta, &item);

    let url_img = item
        .get("url")
        .and_then(scalar)
        .ok_or_else(|| "CIVITAI_NO_IMAGE".to_string())?;
    let bytes = get_bytes(&agent, &url_img)?;
    if bytes.is_empty() {
        return Err("CIVITAI_NO_IMAGE".to_string());
    }
    let image: PasteImageResult = images::save_temp_image_dyn(&bytes)?;

    Ok(CivitaiImport {
        image,
        prompt,
        negative_prompt,
        author,
        checkpoint,
        loras,
        tags,
        meta: meta_rows,
        source_key: Some(source_key),
    })
}

fn option_key(k: &str) -> Option<&str> {
    if k.is_empty() {
        None
    } else {
        Some(k)
    }
}

// ---------------------------------------------------------------- model pages (LoRA shelf)

/// Primary/category tag for the blue badge, keyed the same way CivitAI label
/// its model cards, "character" being the badge users see most.
const PRIMARY_TAG_ORDER: [&str; 6] = ["character", "style", "concept", "clothing", "poses", "tool"];
const MAX_USAGE_TIPS: usize = 12;
const MAX_TRIGGER_WORDS: usize = 24;
/// Hard ceiling for preview images per lora import (the "all" setting value).
const MAX_PREVIEWS: usize = 24;

/// Model links: `/models/<id>` and `/models/<id>/<slug>`, optional
/// `?modelVersionId=` pinning the version. Accepts civitai.com/.red hosts.
fn parse_model_link(raw: &str) -> Result<(String, Option<i64>), String> {
    let s = raw.trim();
    let without_scheme = s.split("://").last().unwrap_or(s);
    let mut host_rest = without_scheme.splitn(2, '/');
    let host = host_rest.next().unwrap_or("").to_ascii_lowercase();
    let rest = host_rest.next().unwrap_or("");
    if host != "civitai.com" && host != "civitai.red" && !host.ends_with(".civitai.com") {
        return Err("CIVITAI_URL".to_string());
    }
    let path = rest.split(['?', '#']).next().unwrap_or("");
    let segs: Vec<&str> = path.split('/').filter(|x| !x.is_empty()).collect();
    let model = segs.get(0).copied().unwrap_or("");
    if model != "models" {
        return Err("CIVITAI_URL".to_string());
    }
    let id = segs.get(1).copied().unwrap_or("");
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("CIVITAI_URL".to_string());
    }
    let version = rest
        .split_once('?')
        .and_then(|(_, q)| q.split('&').find(|p| p.starts_with("modelVersionId=")))
        .and_then(|p| p.strip_prefix("modelVersionId="))
        .and_then(|v| v.split(['&', '#']).next())
        .and_then(|v| v.parse::<i64>().ok());
    Ok((id.to_string(), version))
}

/// Minimal HTML → plain text for CivitAI descriptions: block endings become
/// newlines, tags are dropped, common entities are decoded.
fn html_to_text(html: &str) -> String {
    if !html.contains('<') {
        return html.to_string();
    }
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    loop {
        match rest.find('<') {
            None => {
                out.push_str(rest);
                break;
            }
            Some(i) => {
                out.push_str(&rest[..i]);
                // tag name decides whether it ends a line
                let after = &rest[i + 1..];
                let name_end = after.find(['>', ' ']).unwrap_or(after.len());
                let raw_name = after[..name_end].to_ascii_lowercase();
                // closing tag → drop the '/' before matching block names
                let is_close = raw_name.starts_with('/');
                let name = raw_name.trim_start_matches('/').to_string();
                let block = matches!(
                    name.as_str(),
                    "br" | "p" | "div" | "li" | "ul" | "ol" | "table" | "tr" | "center"
                ) || (name.len() == 2 && name.starts_with('h') && name.as_bytes()[1].is_ascii_digit())
                    || (is_close
                        && matches!(
                            name.as_str(),
                            "p" | "div" | "li" | "ul" | "ol" | "table" | "tr" | "center"
                        ));
                let Some(close_rel) = rest[i..].find('>') else {
                    out.push_str(&rest[i..]);
                    break;
                };
                rest = &rest[i + close_rel + 1..];
                if block && !out.ends_with('\n') && !out.is_empty() {
                    out.push('\n');
                }
            }
        }
    }
    // decode common entities
    let text = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    // collapse runs of blank lines and stray whitespace around lines
    let mut lines: Vec<String> = Vec::new();
    for l in text.split('\n') {
        let l = l.trim();
        if l.is_empty() && lines.last().map(String::is_empty).unwrap_or(true) {
            continue;
        }
        lines.push(l.to_string());
    }
    while lines.first().map(String::is_empty).unwrap_or(false) {
        lines.remove(0);
    }
    while lines.last().map(String::is_empty).unwrap_or(false) {
        lines.pop();
    }
    lines.join("\n")
}

/// Usage tips on the LoRA page ("Strength: 0.9") come from the version's
/// settings block. Weights are stored ×100 on CivitAI (strength 90 → 0.9), so
/// values above 3 are scaled back; skips and integers stay as they are.
fn usage_tips_of(version: &Value) -> Vec<String> {
    const KEYS: [(&str, &str); 8] = [
        ("strength", "Strength"),
        ("clipSkip", "Clip skip"),
        ("vae", "VAE"),
        ("vPerception", "Perception"),
        ("vPrecise", "Precision"),
        ("vCharacter", "Character"),
        ("vVelq", "Velocity"),
        ("vVelqFull", "Velocity (full)"),
    ];
    let Some(settings) = version.get("settings").and_then(|s| s.as_object()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (key, label) in KEYS {
        if out.len() >= MAX_USAGE_TIPS {
            break;
        }
        let Some(v) = settings.get(key) else { continue };
        let Some(s) = scalar(v) else { continue };
        let display: String = match v.as_f64() {
            Some(f) if key == "strength" || key.starts_with("vVelq") && f > 3.0 => {
                let scaled = format!("{}", f / 100.0);
                scaled.trim_end_matches('0').trim_end_matches('.').to_string()
            }
            _ => s,
        };
        if display.is_empty() {
            continue;
        }
        out.push(format!("{label}: {display}"));
    }
    // leftovers, scalar values we don't model
    if out.len() < MAX_USAGE_TIPS {
        if let Some(obj) = version.get("settings").and_then(|s| s.as_object()) {
            for (k, v) in obj {
                if out.len() >= MAX_USAGE_TIPS {
                    break;
                }
                if KEYS.iter().any(|(known, _)| *known == k.as_str()) || k == "id" {
                    continue;
                }
                if let Some(s) = scalar(v) {
                    out.push(format!("{k}: {s}"));
                }
            }
        }
    }
    out
}

/// The blue badge tag: the first "category" tag CivitAI itself shows this way
/// ("character", "style", …), falling back to the model type label.
fn primary_tag_of(model: &Value, tags: &[String]) -> Option<String> {
    for want in PRIMARY_TAG_ORDER {
        if tags.iter().any(|t| t.eq_ignore_ascii_case(want)) {
            return Some(want.to_string());
        }
    }
    model.get("type").and_then(scalar).map(|t| t.to_lowercase())
}

fn run_model(data_dir: &std::path::Path, url: &str) -> Result<CivitaiLoraImport, String> {
    let (model_id, version_id) = parse_model_link(url)?;
    let source_key = crate::dedup::civitai_key("model", &model_id);
    let agent = agent();
    let (api_key, lora_previews): (String, u32) = crate::store::open(data_dir)
        .and_then(|c| crate::store::read_settings(&c).map(|s| (s.civitai_api_key, s.lora_previews)))
        .unwrap_or_else(|_| (String::new(), 0));

    let path = format!("/api/v1/models/{model_id}");
    let mut model = get_json(&agent, &path, option_key(&api_key))?;
    // anonymous requests can be gated exactly like the image endpoints
    if model.is_none() && !api_key.is_empty() {
        model = get_json(&agent, &path, Some(api_key.as_str()))?;
    }
    let model = model.ok_or_else(|| "CIVITAI_NOT_FOUND".to_string())?;

    let versions = model
        .get("modelVersions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if versions.is_empty() {
        return Err("CIVITAI_NOT_FOUND".to_string());
    }
    // the pinned version wins; otherwise the first one (the page's default,
    // and the one whose preview is on the model card)
    let version = version_id
        .and_then(|vid| versions.iter().find(|v| v.get("id").and_then(|x| x.as_i64()) == Some(vid)))
        .unwrap_or(versions.first().unwrap());

    let name = model
        .get("name")
        .and_then(scalar)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "CIVITAI_NOT_FOUND".to_string())?;
    let base_model = version.get("baseModel").and_then(scalar).unwrap_or_default();
    let published_at = version.get("publishedAt").and_then(scalar).unwrap_or_default();
    let trigger_words: Vec<String> = version
        .get("trainedWords")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(scalar).collect())
        .unwrap_or_default();
    let description = model
        .get("description")
        .and_then(|d| d.as_str())
        .map(html_to_text)
        .unwrap_or_default();
    let mut tags: Vec<String> = model
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(scalar).collect())
        .unwrap_or_default();
    let primary_tag = primary_tag_of(&model, &tags);
    // the primary badge is shown separately; don't duplicate it in the chip row
    if let Some(pt) = &primary_tag {
        tags.retain(|t| !t.eq_ignore_ascii_case(pt));
    }
    tags.truncate(MAX_TAGS);

    let usage_tips = usage_tips_of(version);

    // Previews: the version's sample images in page order, the first one
    // becoming the cover. Animated previews and the announcement videos
    // CivitAI mixes into the list can't be decoded as stills — that used to
    // kill the whole import; now each candidate is tried and failures are
    // skipped until the configured count is filled (0 = all of them).
    let candidates: Vec<String> = version
        .get("images")
        .and_then(|i| i.as_array())
        .map(|a| {
            a.iter()
                .filter(|im| im.get("type").and_then(scalar).as_deref() != Some("video"))
                .filter_map(|im| im.get("url").and_then(scalar))
                .collect()
        })
        .unwrap_or_default();
    let limit = if lora_previews == 0 {
        MAX_PREVIEWS
    } else {
        (lora_previews as usize).min(MAX_PREVIEWS)
    };
    let mut images: Vec<PasteImageResult> = Vec::new();
    for url_img in &candidates {
        if images.len() >= limit {
            break;
        }
        let Ok(bytes) = get_bytes(&agent, url_img) else {
            continue;
        };
        if bytes.is_empty() {
            continue;
        }
        if let Ok(image) = images::save_temp_image_dyn(&bytes) {
            images.push(image);
        }
    }

    Ok(CivitaiLoraImport {
        images,
        name,
        base_model,
        published_at,
        usage_tips,
        trigger_words: trigger_words.into_iter().take(MAX_TRIGGER_WORDS).collect(),
        description,
        primary_tag,
        tags,
        source_key: Some(source_key),
    })
}

// ---------------------------------------------------------------- command

#[tauri::command]
pub async fn civitai_import(
    state: tauri::State<'_, crate::AppState>,
    url: String,
) -> Result<CivitaiImport, String> {
    let dir = state.dir.clone();
    let handle = tauri::async_runtime::spawn_blocking(move || run(&dir, &url));
    match handle.await {
        Ok(res) => res,
        Err(e) => Err(format!("CIVITAI_NETWORK: {}", es(e))),
    }
}

/// Parse-only duplicate pre-check: turns a pasted CivitAI link into its
/// origin key without any network traffic. Returns None for non-CivitAI
/// links, which simply opt out of duplicate detection.
#[tauri::command]
pub fn civitai_source_key(url: String) -> Option<String> {
    parse_link(&url).map(|(kind, id)| crate::dedup::civitai_key(kind, &id)).ok()
}

/// CivitAI **model page** import for the LoraShelf. Same background-thread
/// pipeline as the image import.
#[tauri::command]
pub async fn civitai_lora_import(
    state: tauri::State<'_, crate::AppState>,
    url: String,
) -> Result<CivitaiLoraImport, String> {
    let dir = state.dir.clone();
    let handle = tauri::async_runtime::spawn_blocking(move || run_model(&dir, &url));
    match handle.await {
        Ok(res) => res,
        Err(e) => Err(format!("CIVITAI_NETWORK: {}", es(e))),
    }
}

/// Link → origin key pre-check for the lora flow (models only).
#[tauri::command]
pub fn civitai_lora_source_key(url: String) -> Option<String> {
    parse_model_link(&url).map(|(id, _)| crate::dedup::civitai_key("model", &id)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::init_schema;

    #[test]
    fn parses_model_links() {
        assert_eq!(
            parse_model_link("https://civitai.com/models/2945627/bemyhero-finjax"),
            Ok(("2945627".to_string(), None))
        );
        assert_eq!(
            parse_model_link("https://civitai.com/models/2945627/bemyhero-finjax?modelVersionId=3335418"),
            Ok(("2945627".to_string(), Some(3335418)))
        );
        assert_eq!(parse_model_link("civitai.com/models/123"), Ok(("123".to_string(), None)));
        assert_eq!(parse_model_link("https://civitai.com/images/5"), Err("CIVITAI_URL".into()));
        assert_eq!(parse_model_link("https://civitai.com/models/"), Err("CIVITAI_URL".into()));
        // classic model pages carry no version id
        assert_eq!(parse_model_link("https://civitai.com/models/2945627/bemyhero-finjax?notif=1&x=2"), Ok(("2945627".to_string(), None)));
    }

    #[test]
    fn strips_html() {
        assert_eq!(html_to_text("<p>First</p><p>Second</p>"), "First\nSecond");
        assert_eq!(html_to_text("A<br>B"), "A\nB");
        assert_eq!(html_to_text("<ul><li>one</li><li>two</li></ul>"), "one\ntwo");
        assert_eq!(html_to_text("Fish &amp; <b>chips</b>"), "Fish & chips");
        assert_eq!(html_to_text("plain text"), "plain text");
        assert_eq!(html_to_text("<h4>Heading</h4>Body"), "Heading\nBody");
    }

    #[test]
    fn builds_usage_tips() {
        let v: Value = serde_json::json!({ "settings": { "strength": 90, "clipSkip": 2, "garbage": "x" } });
        let tips = usage_tips_of(&v);
        assert_eq!(tips, vec!["Strength: 0.9", "Clip skip: 2", "garbage: x"]);

        let v2: Value = serde_json::json!({ "settings": { "strength": 100 } });
        assert_eq!(usage_tips_of(&v2), vec!["Strength: 1"]);
    }

    #[test]
    fn picks_primary_tag() {
        let model: Value = serde_json::json!({ "type": "LORA" });
        let tags = vec!["armour".to_string(), "character".to_string()];
        assert_eq!(primary_tag_of(&model, &tags).as_deref(), Some("character"));
        assert_eq!(primary_tag_of(&model, &Vec::new()).as_deref(), Some("lora"));
    }

    #[test]
    fn parses_links() {
        assert_eq!(parse_link("https://civitai.com/images/146266112"), Ok(("images", "146266112".into())));
        assert_eq!(parse_link("https://civitai.red/images/1?postId=3"), Ok(("images", "1".into())));
        assert_eq!(parse_link("civitai.com/images/123/"), Ok(("images", "123".into())));
        assert_eq!(parse_link("https://civitai.com/posts/31782254"), Ok(("posts", "31782254".into())));
        assert_eq!(parse_link("https://example.com/images/5"), Err("CIVITAI_URL".into()));
        assert_eq!(parse_link("https://civitai.com/images/"), Err("CIVITAI_URL".into()));
        assert_eq!(parse_link("牛津"), Err("CIVITAI_URL".into()));
    }

    #[test]
    fn parses_lora_tags() {
        let p = "start <lora:Krea2_GrippyPussy_v1:1.0> mid <lora:Famegrid-Natural-V1-Krea-2:1> <lora:VectorKreaRaw_v1:0.85> end @wat";
        let ls = parse_lora_tags(p);
        assert_eq!(ls.len(), 3);
        assert_eq!(ls[0].name, "Krea2_GrippyPussy_v1");
        assert_eq!(ls[0].value, "1");
        assert_eq!(ls[2].value, "0.85");

        // name:folder:weight triple form
        let ls2 = parse_lora_tags("<lora:add_detail:models/lora:0.8>");
        assert_eq!(ls2.len(), 1);
        assert_eq!(ls2[0].name, "add_detail");
        assert_eq!(ls2[0].value, "0.8");

        // dedupe by name
        let ls3 = parse_lora_tags("<lora:a:1> <lora:A:2>");
        assert_eq!(ls3.len(), 1);
    }

    #[test]
    fn builds_other_meta() {
        let meta: Value = serde_json::json!({
            "seed": 557832969775936u64,
            "Model": "lustifyNSFWCheckpoint_v10Krea2",
            "steps": 9,
            "width": 896,
            "height": 1088,
            "sampler": "Euler",
            "cfgScale": 1,
            "prompt": "long text",
            "Version": "ComfyUI",
            "Custom Thing": "hello"
        });
        let rows = other_meta(&meta, &serde_json::json!({}));
        let ks: Vec<&str> = rows.iter().map(|r| r.k.as_str()).collect();
        assert_eq!(ks, vec!["Seed", "Steps", "Sampler", "CFG", "Size", "Version", "Custom Thing"]);
        assert_eq!(rows[0].v, "557832969775936");
        assert_eq!(rows[4].v, "896 × 1088");
        assert!(!ks.contains(&"prompt"));
    }

    /// Full live pipeline: real network. Run manually: cargo test -- --ignored
    #[test]
    #[ignore = "needs network"]
    fn live_import_end_to_end() {
        let dir = std::env::temp_dir().join(format!("promptshelf-civitai-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = crate::store::open(&dir).unwrap();
        init_schema(&conn).unwrap();

        let res = run(&dir, "https://civitai.com/images/146266112").expect("import should succeed");
        assert!(!res.prompt.is_empty(), "prompt must be filled");
        assert!(std::path::Path::new(&res.image.temp_path).exists(), "temp file must exist");
        assert!(res.image.width > 0 && res.image.height > 0);
        assert_eq!(res.author, "_GamerOne796");
        assert!(!res.checkpoint.is_empty(), "checkpoint from meta.Model");
        assert!(!res.loras.is_empty(), "lora tags parsed from prompt");
        assert!(!res.tags.is_empty(), "tags fetched from the post");
        assert_eq!(res.tags[0], "nswf"); // yes, CivitAI's own tag has the typo
        // Community-voted/automated tags come from tag.getVotableTags (tRPC):
        // "nude" is an automated moderation tag that the post never carries.
        assert!(
            res.tags.iter().any(|t| t == "nude"),
            "votable tags must be merged: {:?}",
            res.tags
        );
        let seed = res.meta.iter().find(|m| m.k == "Seed").map(|m| m.v.clone());
        assert_eq!(seed.as_deref(), Some("557832969775936"));

        // Negative prompt: CivitAI stores it camelCase ("negativePrompt"); this
        // second image is a case where the negative is present in the meta.
        let res2 = run(&dir, "https://civitai.com/images/9173928").expect("import should succeed");
        assert!(
            !res2.negative_prompt.is_empty(),
            "negativePrompt must be picked up: {:?}",
            res2.negative_prompt
        );
        let _ = std::fs::remove_file(&res2.image.temp_path);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
