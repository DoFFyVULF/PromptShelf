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
                    out.push(Lora { name: name.to_string(), value, url: None, kind: None });
                }
            }
            from = end + 1;
        }
    }
    out
}

/// One model-version resolved through the API: what the model is ("lora",
/// "lycoris", "checkpoint", …), its display name, the strength it was used
/// with and the model page link behind it.
struct ResolvedVersion {
    id: i64,
    kind: String,
    name: String,
    value: String,
    url: Option<String>,
}

/// Resolve a model-version id: the response carries the model's type (which
/// separates loras from checkpoints/upscalers — the current `civitaiResources`
/// entries no longer say what they are), its display name and, via the
/// top-level `modelId`, the page link. The nested `model` object has no `id`.
/// One small request each.
fn resolve_version(
    agent: &ureq::Agent,
    api_key: Option<&str>,
    id: i64,
    value: &str,
) -> Option<ResolvedVersion> {
    let v = get_json(agent, &format!("/api/v1/model-versions/{id}"), api_key).ok()??;
    let model = v.get("model")?;
    let kind = model.get("type").and_then(scalar).unwrap_or_default().to_lowercase();
    let name = model
        .get("name")
        .and_then(scalar)
        .or_else(|| v.get("name").and_then(scalar))?;
    let mid = v
        .get("modelId")
        .and_then(|i| i.as_i64())
        .or_else(|| model.get("id").and_then(|i| i.as_i64()));
    let url = mid.map(|mid| format!("https://civitai.com/models/{mid}?modelVersionId={id}"));
    Some(ResolvedVersion { id, kind, name, value: value.to_string(), url })
}

/// "urn:air:sdxl:lora:civitai:120723@145907" → ("lora", 120723, 145907).
/// On-site generations name their Model/resources with these URNs; the type
/// and both ids ride inside, zero extra requests.
fn parse_resource_urn(urn: &str) -> Option<(&str, i64, i64)> {
    let segs: Vec<&str> = urn.trim().split(':').collect();
    if segs.len() != 6 || segs[0] != "urn" || segs[1] != "air" || segs[4] != "civitai" {
        return None;
    }
    let (mid, vid) = segs[5].split_once('@')?;
    Some((segs[3], mid.parse().ok()?, vid.parse().ok()?))
}

/// Every model-version id the image meta references, deduplicated, ordered so
/// the likely loras resolve first (the request budget is limited): typed
/// lora/lycoris entries, then untyped ones (the current CivitAI shape omits
/// the type; the resolve response tells lora from checkpoint), then the rest
/// (checkpoints, upscalers — needed for the checkpoint fallback).
fn version_candidates(meta: &Value) -> Vec<(i64, Option<String>)> {
    let mut typed: Vec<(i64, Option<String>)> = Vec::new();
    let mut untyped: Vec<(i64, Option<String>)> = Vec::new();
    let mut other: Vec<(i64, Option<String>)> = Vec::new();
    let mut seen: HashSet<i64> = HashSet::new();
    if let Some(arr) = meta.get("civitaiResources").and_then(|r| r.as_array()) {
        for r in arr {
            let Some(id) = r.get("modelVersionId").and_then(|v| v.as_i64()) else { continue };
            let ty = r.get("type").and_then(|t| t.as_str()).map(|t| t.to_ascii_lowercase());
            let slot = match ty.as_deref() {
                None => &mut untyped,
                Some(t) if matches!(t, "lora" | "lycoris" | "locon") => &mut typed,
                Some(_) => &mut other,
            };
            if seen.insert(id) {
                slot.push((id, r.get("weight").and_then(scalar)));
            }
        }
    }
    // additionalResources rides beside civitaiResources on on-site
    // generations; its URN names carry type + ids for free
    if let Some(arr) = meta.get("additionalResources").and_then(|r| r.as_array()) {
        for r in arr {
            let Some(urn) = r.get("name").and_then(|n| n.as_str()) else { continue };
            let Some((ty, _, id)) = parse_resource_urn(urn) else { continue };
            if !matches!(ty, "lora" | "lycoris" | "locon") {
                continue;
            }
            if seen.insert(id) {
                typed.push((id, r.get("strength").and_then(scalar)));
            }
        }
    }
    typed.extend(untyped);
    typed.extend(other);
    typed
}

/// Resolve every candidate through the model-versions API (budget-capped);
/// entries that fail (deleted, gated) are skipped.
fn resolve_versions(agent: &ureq::Agent, api_key: Option<&str>, meta: &Value) -> Vec<ResolvedVersion> {
    let mut out: Vec<ResolvedVersion> = Vec::new();
    let mut requests = 0usize;
    for (id, weight) in version_candidates(meta) {
        if requests >= MAX_RESOLVE_REQUESTS {
            break;
        }
        requests += 1;
        let Some(r) = resolve_version(agent, api_key, id, weight.as_deref().unwrap_or("1")) else {
            continue;
        };
        if !out.iter().any(|e| e.name.eq_ignore_ascii_case(&r.name)) {
            out.push(r);
        }
    }
    out
}

fn is_lora_kind(kind: &str) -> bool {
    matches!(kind, "lora" | "lycoris" | "locon")
}

/// Appends the non-lora resources (upscalers, embeddings, workflows, …) from
/// the resolved list, skipping checkpoints (a card field of their own) and
/// names already present. Kind travels on the entry so the UI can split the
/// sections; the shared `loras` list keeps the stored shape unchanged.
fn push_other_resources(loras: &mut Vec<Lora>, resolved: &[ResolvedVersion]) {
    for r in resolved {
        if loras.len() >= MAX_LORAS {
            return;
        }
        if is_lora_kind(&r.kind) || r.kind == "checkpoint" {
            continue;
        }
        if loras.iter().any(|l| l.name.eq_ignore_ascii_case(&r.name)) {
            continue;
        }
        loras.push(Lora {
            name: r.name.clone(),
            value: r.value.clone(),
            url: r.url.clone(),
            kind: Some(r.kind.clone()),
        });
    }
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
                    url: None,
                    kind: None,
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

/// The image page's resource panel is served by tRPC `image.getGenerationData`:
/// unlike the REST meta it lists EVERY resource — embeddings and workflows
/// included — with display name, type and both ids already resolved. Map its
/// entries onto ResolvedVersion; same name dedupe as the per-version resolve.
fn parse_generation_resources(v: &Value) -> Vec<ResolvedVersion> {
    let arr = v
        .pointer("/result/data/json/resources")
        .and_then(|r| r.as_array())
        .or_else(|| v.pointer("/result/data/resources").and_then(|r| r.as_array()));
    let Some(arr) = arr else { return Vec::new() };
    let mut out: Vec<ResolvedVersion> = Vec::new();
    for r in arr {
        let Some(name) = r.get("modelName").and_then(scalar) else { continue };
        let Some(id) = r
            .get("modelVersionId")
            .and_then(|v| v.as_i64())
            .or_else(|| r.get("versionId").and_then(|v| v.as_i64()))
        else {
            continue;
        };
        let kind = r.get("modelType").and_then(scalar).unwrap_or_default().to_lowercase();
        let url = r
            .get("modelId")
            .and_then(|v| v.as_i64())
            .map(|mid| format!("https://civitai.com/models/{mid}?modelVersionId={id}"));
        let value = r.get("strength").and_then(scalar).unwrap_or_else(|| "1".to_string());
        if !out.iter().any(|e| e.name.eq_ignore_ascii_case(&name)) {
            out.push(ResolvedVersion { id, kind, name, value, url });
        }
    }
    out
}

/// One tRPC request for the full resource list; empty on any failure so the
/// caller falls back to resolving the REST meta version ids.
fn generation_resources(agent: &ureq::Agent, api_key: Option<&str>, image_id: &str) -> Vec<ResolvedVersion> {
    // the tRPC input schema is `id: z.number()` — a string id fails validation
    let Ok(id) = image_id.parse::<i64>() else {
        return Vec::new();
    };
    let input = serde_json::json!({ "json": { "id": id } });
    let Ok(input) = serde_json::to_string(&input) else {
        return Vec::new();
    };
    let path = format!("/api/trpc/image.getGenerationData?input={}", pct_encode(&input));
    match get_json(agent, &path, api_key) {
        Ok(Some(v)) => parse_generation_resources(&v),
        _ => Vec::new(),
    }
}

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

    // LoRAs: prompt tags first (no requests), then the resolved resource list
    // (the resolve response tells lora from checkpoint — the meta entries no
    // longer carry a reliable type), finally the legacy "resources" list. When
    // the tags came from the prompt, the resolved resources are still used to
    // attach page links — names are the join key.
    // The page's own resource list (getGenerationData) is the primary source:
    // it already carries embeddings and workflows, which the REST meta omits.
    // The per-version meta resolve stays as the fallback for gated/deleted data.
    let mut resolved = generation_resources(&agent, option_key(&api_key), &image_id);
    if resolved.is_empty() {
        resolved = resolve_versions(&agent, option_key(&api_key), meta);
    }
    let mut loras = parse_lora_tags(&prompt);
    if loras.is_empty() {
        loras = resolved
            .iter()
            .filter(|r| is_lora_kind(&r.kind))
            .map(|r| Lora { name: r.name.clone(), value: r.value.clone(), url: r.url.clone(), kind: None })
            .collect();
        if loras.is_empty() {
            loras = loras_from_resources(meta);
        }
    } else {
        for l in loras.iter_mut() {
            let tag = l.name.to_lowercase();
            for r in resolved.iter().filter(|r| is_lora_kind(&r.kind)) {
                let Some(url) = &r.url else { continue };
                let key = r.name.to_lowercase();
                // exact, or containment on the shorter side (file names carry
                // the model name plus version suffixes)
                let joined = tag.contains(&key) || key.contains(&tag);
                if tag == key || (joined && key.len().min(tag.len()) >= 4) {
                    l.url = Some(url.clone());
                    break;
                }
            }
        }
    }

    // Other CivitAI resources (upscalers, embeddings, workflows, …) ride in
    // the same list tagged with their type; the checkpoint is a card field of
    // its own and is skipped.
    push_other_resources(&mut loras, &resolved);

    // Checkpoint: A1111-style meta "Model" — a plain name, or a URN on on-site
    // generations ("urn:air:sdxl:checkpoint:civitai:140272@1697082") which
    // resolves to the display name; the URN's checkpoint is normally among the
    // resources, so this usually costs nothing extra.
    let model_field = meta.get("Model").and_then(scalar).unwrap_or_default();
    let mut checkpoint = match parse_resource_urn(&model_field) {
        Some(("checkpoint", _, vid)) => resolved
            .iter()
            .find(|r| r.id == vid && r.kind == "checkpoint")
            .map(|r| r.name.clone())
            .unwrap_or_else(|| {
                resolve_version(&agent, option_key(&api_key), vid, "1")
                    .filter(|r| r.kind == "checkpoint")
                    .map(|r| r.name)
                    .unwrap_or_default()
            }),
        _ => model_field,
    };
    if checkpoint.is_empty() {
        checkpoint = resolved
            .iter()
            .find(|r| r.kind == "checkpoint")
            .map(|r| r.name.clone())
            .unwrap_or_default();
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

/// CivitAI descriptions arrive as pre-rendered HTML from their markdown
/// pipeline. We keep the rich structure (headings, lists, highlighted spans,
/// code, links) but enforce our own allow-list: only the tags the shelf
/// styles, href/src limited to safe schemes, and a `style` attribute reduced
/// to author colouring on any tag (`<font color>` is kept as-is). Everything
/// else is escaped into visible text. Hand-typed descriptions (no tags) are
/// wrapped into paragraphs the same way.
pub fn sanitize_rich_html(html: &str) -> String {
    use std::borrow::Cow;
    use std::collections::HashMap;

    let tags: HashSet<&str> = [
        "a", "p", "br", "b", "strong", "i", "em", "u", "s", "del", "ins", "span", "code", "pre",
        "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead",
        "tbody", "tr", "th", "td", "hr", "sup", "sub", "kbd", "mark", "small", "img", "center",
        "details", "summary", "dl", "dt", "dd", "font",
    ]
    .into_iter()
    .collect();

    let mut tag_attrs: HashMap<&str, HashSet<&str>> = HashMap::new();
    tag_attrs.insert("a", ["href"].into_iter().collect());
    tag_attrs.insert("img", ["src", "alt", "title"].into_iter().collect());
    tag_attrs.insert("span", ["style"].into_iter().collect());
    tag_attrs.insert("td", ["align"].into_iter().collect());
    tag_attrs.insert("th", ["align"].into_iter().collect());
    tag_attrs.insert("font", ["color"].into_iter().collect());

    let schemes: HashSet<&str> = ["https", "http", "mailto"].into_iter().collect();

    let cleaned = ammonia::Builder::new()
        .tags(tags)
        .tag_attributes(tag_attrs)
        .generic_attributes(["style"].into_iter().collect())
        .url_schemes(schemes)
        .link_rel(Some("noopener noreferrer"))
        .attribute_filter(|_element: &str, attribute: &str, value: &str| {
            // ammonia's attribute filter overrides the allow-list for every
            // attribute, so pass everything else through untouched and only
            // prune `style` down to author colouring declarations
            if attribute == "style" {
                let kept: Vec<&str> = value
                    .split(';')
                    .map(str::trim)
                    .filter(|decl| {
                        let prop = decl.split(':').next().unwrap_or("").trim().to_ascii_lowercase();
                        matches!(
                            prop.as_str(),
                            "color" | "background-color" | "font-weight" | "font-style" | "text-decoration"
                        )
                    })
                    .collect();
                (!kept.is_empty()).then(|| Cow::Owned(kept.join("; ")))
            } else {
                Some(Cow::Borrowed(value))
            }
        })
        .clean(html)
        .to_string();

    if cleaned.contains("<p") || cleaned.contains("<br") || cleaned.contains("<li") {
        return cleaned;
    }
    // Plain text: every line becomes its own paragraph.
    let paragraphs: String = cleaned
        .split('\n')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("<p>{s}</p>"))
        .collect();
    paragraphs
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
        .map(sanitize_rich_html)
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
    fn sanitizes_rich_html() {
        // rich markdown keeps its structure, links get a safe rel
        assert_eq!(
            sanitize_rich_html("<h2><strong>Settings</strong></h2><ul><li>Strength <code>0.9</code></li></ul><p><a href=\"https://civitai.com/user/a\" rel=\"ugc\">coffee</a></p>"),
            "<h2><strong>Settings</strong></h2><ul><li>Strength <code>0.9</code></li></ul><p><a href=\"https://civitai.com/user/a\" rel=\"noopener noreferrer\">coffee</a></p>"
        );
        // coloured spans: author colours survive, layout props are dropped
        assert_eq!(
            sanitize_rich_html("<p><span style=\"color: rgb(64, 192, 87); font-size: 42px; position: fixed\"><strong>0.9</strong></span></p>"),
            "<p><span style=\"color: rgb(64, 192, 87)\"><strong>0.9</strong></span></p>"
        );
        // colouring may also ride on other tags and on <font color>
        assert_eq!(
            sanitize_rich_html("<h2 style=\"color:yellow;\">Note</h2><p style=\"color:red;\">x</p>"),
            "<h2 style=\"color:yellow\">Note</h2><p style=\"color:red\">x</p>"
        );
        assert_eq!(
            sanitize_rich_html("<font color=\"#ff5722\">orange</font>"),
            "<p><font color=\"#ff5722\">orange</font></p>"
        );
        // scripts, unknown tags and attributes are stripped or escaped
        assert_eq!(sanitize_rich_html("<script>alert(1)</script>Hi"), "<p>Hi</p>");
        assert_eq!(
            sanitize_rich_html("<a href=\"javascript:alert(1)\">x</a>"),
            "<p><a rel=\"noopener noreferrer\">x</a></p>"
        );
        // hand-typed plain text becomes paragraphs, entities stay visible
        assert_eq!(sanitize_rich_html("First line\n\nSecond line"), "<p>First line</p><p>Second line</p>");
        assert_eq!(sanitize_rich_html("Fish &amp; <b>chips</b>"), "<p>Fish &amp; <b>chips</b></p>");
        assert_eq!(sanitize_rich_html("   \n  "), "");
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
    fn collects_other_resources() {
        // builds a ResolvedVersion with less ceremony
        let rv = |id: i64, kind: &str, name: &str, url: bool| ResolvedVersion {
            id,
            kind: kind.to_string(),
            name: name.to_string(),
            value: "1".to_string(),
            url: url.then(|| format!("https://civitai.com/models/{id}")),
        };

        let resolved = vec![
            rv(1, "lora", "SomeLora", true),
            rv(2, "checkpoint", "BigModel", false),
            rv(3, "upscaler", "Remacri", true),
            rv(4, "textualinversion", "Lazy Embeddings", true),
            rv(5, "workflows", "Gladas Workflow", true),
        ];
        let mut loras = vec![Lora { name: "SomeLora".to_string(), value: "0.8".to_string(), url: None, kind: None }];
        push_other_resources(&mut loras, &resolved);
        // checkpoint is skipped (a card field of its own), loras keep no kind,
        // the rest ride along tagged with their CivitAI type
        assert_eq!(loras.len(), 4);
        assert!(loras[0].kind.is_none());
        assert_eq!(loras[1].name, "Remacri");
        assert_eq!(loras[1].kind.as_deref(), Some("upscaler"));
        assert_eq!(loras[2].kind.as_deref(), Some("textualinversion"));
        assert_eq!(loras[3].kind.as_deref(), Some("workflows"));
        assert_eq!(loras[3].url.as_deref(), Some("https://civitai.com/models/5"));

        // dedupe against the names already in the list, case-insensitive
        let more = vec![rv(6, "upscaler", "SOMELORA", false), rv(7, "upscaler", "Remacri", false)];
        push_other_resources(&mut loras, &more);
        assert_eq!(loras.len(), 4);
    }

    #[test]
    fn parses_generation_resources() {
        // the page's tRPC list: lora with strength, checkpoint, workflow and
        // two versions of one embedding model (deduped by name)
        let v: Value = serde_json::json!({ "result": { "data": { "json": { "resources": [
            { "modelVersionId": 3079282, "strength": -1.75, "modelId": 2738333, "modelName": "Wetness Slider", "modelType": "LORA", "versionId": 3079282 },
            { "modelVersionId": 3396269, "strength": null, "modelId": 2938537, "modelName": "VXP Krea2", "modelType": "Checkpoint" },
            { "modelVersionId": 3459365, "strength": null, "modelId": 2807513, "modelName": "Gladas' Workflow", "modelType": "Workflows" },
            { "modelVersionId": 1833157, "strength": null, "modelId": 1302719, "modelName": "Lazy Embeddings", "modelType": "TextualInversion" },
            { "modelVersionId": 1860747, "strength": null, "modelId": 1302719, "modelName": "Lazy Embeddings", "modelType": "TextualInversion" }
        ] } } } });
        let got = parse_generation_resources(&v);
        assert_eq!(got.len(), 4);
        assert_eq!(got[0].kind, "lora");
        assert_eq!(got[0].value, "-1.75");
        assert_eq!(got[1].kind, "checkpoint");
        assert_eq!(got[1].value, "1"); // null strength → default
        assert_eq!(got[2].kind, "workflows");
        assert_eq!(got[2].url.as_deref(), Some("https://civitai.com/models/2807513?modelVersionId=3459365"));
        assert_eq!(got[3].kind, "textualinversion");
        assert_eq!(got[3].id, 1833157); // first version wins the name dedupe

        // plain (non-superjson) envelope and malformed entries
        let v2: Value = serde_json::json!({ "result": { "data": { "resources": [
            { "modelVersionId": 5, "modelId": 4, "modelName": "Remacri", "modelType": "Upscaler" },
            { "modelName": "no ids" },
            { "modelVersionId": 6 }
        ] } } });
        let got2 = parse_generation_resources(&v2);
        assert_eq!(got2.len(), 1);
        assert_eq!(got2[0].kind, "upscaler");
        assert_eq!(got2[0].name, "Remacri");

        assert!(parse_generation_resources(&serde_json::json!({})).is_empty());
    }

    /// Live regression: embeddings and workflows never ride in the REST meta —
    /// the page's getGenerationData list must bring them in.
    #[test]
    #[ignore = "needs network"]
    fn live_import_embedding_and_workflow() {
        let dir = std::env::temp_dir().join(format!("promptshelf-civitai-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = crate::store::open(&dir).unwrap();
        init_schema(&conn).unwrap();

        let res = run(&dir, "https://civitai.com/images/148412565").expect("import should succeed");
        let wf = res.loras.iter().find(|l| l.kind.as_deref() == Some("workflows"));
        let kinds: Vec<(&str, Option<&str>)> = res.loras.iter().map(|l| (l.name.as_str(), l.kind.as_deref())).collect();
        assert!(wf.is_some(), "workflow must be imported: {kinds:?}");
        assert!(wf.unwrap().url.is_some());
        let _ = std::fs::remove_file(&res.image.temp_path);

        let res2 = run(&dir, "https://civitai.com/images/117575954").expect("import should succeed");
        let emb = res2.loras.iter().find(|l| l.kind.as_deref() == Some("textualinversion"));
        let kinds2: Vec<(&str, Option<&str>)> = res2.loras.iter().map(|l| (l.name.as_str(), l.kind.as_deref())).collect();
        assert!(emb.is_some(), "embedding must be imported: {kinds2:?}");
        assert!(emb.unwrap().url.is_some());
        let _ = std::fs::remove_file(&res2.image.temp_path);
        let _ = std::fs::remove_dir_all(&dir);
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

    #[test]
    fn parses_resource_urns() {
        assert_eq!(
            parse_resource_urn("urn:air:sdxl:lora:civitai:120723@145907"),
            Some(("lora", 120723, 145907))
        );
        assert_eq!(
            parse_resource_urn("urn:air:sdxl:lycoris:civitai:846953@1219983"),
            Some(("lycoris", 846953, 1219983))
        );
        assert_eq!(
            parse_resource_urn("urn:air:sdxl:checkpoint:civitai:140272@1697082"),
            Some(("checkpoint", 140272, 1697082))
        );
        assert_eq!(parse_resource_urn("DetailedEyes_XL"), None);
        assert_eq!(parse_resource_urn("urn:air:sdxl:lora:other:1@2"), None);
    }

    #[test]
    fn collects_version_candidates() {
        // current CivitAI shape: untyped entries plus a typed tail; typed
        // loras resolve first, untyped next, checkpoints/upscalers last
        let meta: Value = serde_json::json!({
            "civitaiResources": [
                { "weight": 1, "modelVersionId": 100 },
                { "weight": 1, "modelVersionId": 100 },
                { "weight": 0.9, "modelVersionId": 101 },
                { "type": "checkpoint", "modelVersionId": 102 },
                { "type": "upscaler", "modelVersionId": 103 },
                { "type": "lora", "weight": 1, "modelVersionId": 104 },
                { "type": "lycoris", "weight": 0.5, "modelVersionId": 105 }
            ],
            "additionalResources": [
                { "name": "urn:air:sdxl:lora:civitai:987736@1209350", "type": "lora", "strength": 0.3 }
            ]
        });
        let got = version_candidates(&meta);
        let ids: Vec<i64> = got.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, vec![104, 105, 1209350, 100, 101, 102, 103]);
        let weights: Vec<Option<String>> = got.iter().map(|(_, w)| w.clone()).collect();
        assert_eq!(weights[0].as_deref(), Some("1"));
        assert_eq!(weights[1].as_deref(), Some("0.5"));
        assert_eq!(weights[2].as_deref(), Some("0.3"));
        assert_eq!(weights[3].as_deref(), Some("1"));
        assert_eq!(weights[5].as_deref(), None); // checkpoint carries no weight
    }

    /// Live regression: on-site generations whose civitaiResources carry no
    /// `type` (resolved from the API response instead) and a URN "Model".
    #[test]
    #[ignore = "needs network"]
    fn live_import_onsite_resources() {
        let dir = std::env::temp_dir().join(format!("promptshelf-civitai-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = crate::store::open(&dir).unwrap();
        init_schema(&conn).unwrap();
        let res = run(&dir, "https://civitai.red/images/82180349").expect("import should succeed");
        println!("checkpoint: {:?}", res.checkpoint);
        for l in &res.loras {
            println!("lora: name={:?} value={:?} kind={:?} url={:?}", l.name, l.value, l.kind, l.url);
        }
        let _ = std::fs::remove_file(&res.image.temp_path);
        let _ = std::fs::remove_dir_all(&dir);
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
        assert_eq!(res.author, "_GamerOne");
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

