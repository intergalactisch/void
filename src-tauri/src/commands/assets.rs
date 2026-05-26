use crate::commands::files::validate_path;
use crate::commands::web_fetch::{current_timestamp, validate_fetch_url};
use crate::error::VoidError;
use regex::Regex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

const MAX_ASSET_BYTES: usize = 25 * 1024 * 1024;
const MAX_REDIRECTS: u8 = 8;
const DOWNLOAD_TIMEOUT_MS: u64 = 60_000;

#[derive(Clone, Debug)]
struct ImageKind {
    key: &'static str,
    extension: &'static str,
    content_type: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMetadata {
    pub relative_path: String,
    pub absolute_path: String,
    pub file_name: String,
    pub content_type: String,
    pub kind: String,
    pub sha256: String,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub original_name: Option<String>,
    pub source_url: Option<String>,
    pub final_url: Option<String>,
    pub fetched_at: Option<String>,
}

#[tauri::command]
pub async fn asset_import_file(
    notes_dir: String,
    note_path: String,
    source_path: String,
) -> Result<AssetMetadata, VoidError> {
    let source = validate_path(&source_path)?;
    let bytes = tokio::fs::read(&source)
        .await
        .map_err(|e| VoidError::FileRead {
            path: source.to_string_lossy().to_string(),
            source: e,
        })?;
    let original_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string());
    store_asset(
        &notes_dir,
        &note_path,
        original_name.as_deref(),
        bytes,
        None,
        None,
        None,
    )
    .await
}

#[tauri::command]
pub async fn asset_import_bytes(
    notes_dir: String,
    note_path: String,
    original_name: String,
    bytes: Vec<u8>,
) -> Result<AssetMetadata, VoidError> {
    store_asset(
        &notes_dir,
        &note_path,
        Some(&original_name),
        bytes,
        None,
        None,
        None,
    )
    .await
}

#[tauri::command]
pub async fn asset_download_image(
    notes_dir: String,
    note_path: String,
    url: String,
    original_name: Option<String>,
) -> Result<AssetMetadata, VoidError> {
    let parsed =
        reqwest::Url::parse(&url).map_err(|e| VoidError::Asset(format!("Invalid URL: {e}")))?;
    if parsed.scheme() != "https" {
        return Err(VoidError::Asset(
            "Image downloads require a public HTTPS URL".to_string(),
        ));
    }
    if let Err(message) = validate_fetch_url(&parsed).await {
        return Err(VoidError::Asset(message));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(DOWNLOAD_TIMEOUT_MS))
        .user_agent("VoidAssetBot/0.1 (+https://void.local)")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| VoidError::Asset(e.to_string()))?;

    let fetched_at = current_timestamp();
    let mut current_url = parsed.clone();
    let mut redirects = 0u8;

    let response = loop {
        let response = client
            .get(current_url.clone())
            .send()
            .await
            .map_err(|e| VoidError::Asset(format!("Image download failed: {e}")))?;
        let status = response.status();

        if status.is_redirection() {
            if redirects >= MAX_REDIRECTS {
                return Err(VoidError::Asset("Too many redirects".to_string()));
            }
            redirects += 1;
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| VoidError::Asset("Redirect without Location header".to_string()))?;
            let next = current_url
                .join(location)
                .map_err(|e| VoidError::Asset(format!("Invalid redirect target: {e}")))?;
            if next.scheme() != "https" {
                return Err(VoidError::Asset(
                    "Image redirects must remain on public HTTPS URLs".to_string(),
                ));
            }
            if let Err(message) = validate_fetch_url(&next).await {
                return Err(VoidError::Asset(message));
            }
            current_url = next;
            continue;
        }

        if !status.is_success() {
            return Err(VoidError::Asset(format!(
                "Image download returned HTTP {}",
                status.as_u16()
            )));
        }

        break response;
    };

    let final_url = current_url.to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(normalize_content_type);
    let declared_kind = match content_type.as_deref().and_then(kind_from_content_type) {
        Some(kind) => kind,
        None => {
            return Err(VoidError::Asset(
                "Remote image did not declare an allowed image MIME type".to_string(),
            ));
        }
    };

    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_ASSET_BYTES)
    {
        return Err(VoidError::Asset(format!(
            "Image exceeds {MAX_ASSET_BYTES}-byte limit"
        )));
    }

    let bytes = read_limited_bytes(response).await?;
    let detected = detect_image_kind(&bytes)?;
    if detected.key != declared_kind.key {
        return Err(VoidError::Asset(format!(
            "Image MIME type ({}) does not match file bytes ({})",
            declared_kind.content_type, detected.content_type
        )));
    }

    let derived_name = original_name
        .or_else(|| derive_name_from_url(&current_url))
        .unwrap_or_else(|| "downloaded-image".to_string());

    store_asset(
        &notes_dir,
        &note_path,
        Some(&derived_name),
        bytes,
        Some(url),
        Some(final_url),
        Some(fetched_at),
    )
    .await
}

#[tauri::command]
pub async fn asset_metadata(
    notes_dir: String,
    relative_path: String,
) -> Result<AssetMetadata, VoidError> {
    let absolute = resolve_asset_path(&notes_dir, &relative_path)?;
    metadata_for_asset(&notes_dir, &absolute, None, None, None, None).await
}

#[tauri::command]
pub async fn asset_list(notes_dir: String) -> Result<Vec<AssetMetadata>, VoidError> {
    let base = asset_base_dir(&notes_dir)?;
    if tokio::fs::metadata(&base).await.is_err() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    let mut stack = vec![base];

    while let Some(dir) = stack.pop() {
        let mut entries =
            tokio::fs::read_dir(&dir)
                .await
                .map_err(|e| VoidError::DirectoryList {
                    path: dir.to_string_lossy().to_string(),
                    source: e,
                })?;
        while let Some(entry) =
            entries
                .next_entry()
                .await
                .map_err(|e| VoidError::DirectoryList {
                    path: dir.to_string_lossy().to_string(),
                    source: e,
                })?
        {
            let path = entry.path();
            let file_type = entry
                .file_type()
                .await
                .map_err(|e| VoidError::DirectoryList {
                    path: path.to_string_lossy().to_string(),
                    source: e,
                })?;
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() {
                if let Ok(metadata) =
                    metadata_for_asset(&notes_dir, &path, None, None, None, None).await
                {
                    out.push(metadata);
                }
            }
        }
    }

    out.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(out)
}

#[tauri::command]
pub async fn asset_save_as(
    notes_dir: String,
    relative_path: String,
    destination_path: String,
) -> Result<AssetMetadata, VoidError> {
    let source = resolve_asset_path(&notes_dir, &relative_path)?;
    let destination = validate_path(&destination_path)?;

    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| VoidError::DirectoryCreate {
                path: parent.to_string_lossy().to_string(),
                source: e,
            })?;
    }

    tokio::fs::copy(&source, &destination)
        .await
        .map_err(|e| VoidError::FileWrite {
            path: destination.to_string_lossy().to_string(),
            source: e,
        })?;

    metadata_for_asset(&notes_dir, &source, None, None, None, None).await
}

#[tauri::command]
pub async fn asset_delete(notes_dir: String, relative_path: String) -> Result<(), VoidError> {
    let path = resolve_asset_path(&notes_dir, &relative_path)?;
    tokio::fs::remove_file(&path)
        .await
        .map_err(|e| VoidError::FileDelete {
            path: path.to_string_lossy().to_string(),
            source: e,
        })
}

#[tauri::command]
pub async fn asset_resolve_asset_url(
    notes_dir: String,
    relative_path: String,
) -> Result<String, VoidError> {
    let path = resolve_asset_path(&notes_dir, &relative_path)?;
    Ok(path.to_string_lossy().to_string())
}

async fn store_asset(
    notes_dir: &str,
    note_path: &str,
    original_name: Option<&str>,
    raw_bytes: Vec<u8>,
    source_url: Option<String>,
    final_url: Option<String>,
    fetched_at: Option<String>,
) -> Result<AssetMetadata, VoidError> {
    if raw_bytes.len() > MAX_ASSET_BYTES {
        return Err(VoidError::Asset(format!(
            "Image exceeds {MAX_ASSET_BYTES}-byte limit"
        )));
    }

    let detected = detect_image_kind(&raw_bytes)?;
    let bytes = if detected.key == "svg" {
        sanitize_svg(&raw_bytes)?.into_bytes()
    } else {
        raw_bytes
    };
    let kind = detect_image_kind(&bytes)?;
    if kind.key != detected.key {
        return Err(VoidError::Asset(
            "Image changed type during validation".to_string(),
        ));
    }

    let sha256 = sha256_hex(&bytes);
    let slug = note_slug(note_path);
    let safe_name = safe_asset_name(original_name.unwrap_or("image"), kind.extension);
    let file_name = format!("{}-{}.{}", &sha256[..12], safe_name, kind.extension);
    let relative_path = format!("assets/{slug}/{file_name}");
    let base = asset_base_dir(notes_dir)?;
    let target_dir = base.join(slug);
    let target_path = target_dir.join(&file_name);

    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| VoidError::DirectoryCreate {
            path: target_dir.to_string_lossy().to_string(),
            source: e,
        })?;
    ensure_asset_directory_contained(notes_dir, &target_dir)?;

    if tokio::fs::metadata(&target_path).await.is_err() {
        let temp_path = target_dir.join(format!(".tmp-{}", uuid::Uuid::new_v4()));
        tokio::fs::write(&temp_path, &bytes)
            .await
            .map_err(|e| VoidError::FileWrite {
                path: temp_path.to_string_lossy().to_string(),
                source: e,
            })?;
        tokio::fs::rename(&temp_path, &target_path)
            .await
            .map_err(|e| VoidError::FileWrite {
                path: target_path.to_string_lossy().to_string(),
                source: e,
            })?;
    }

    metadata_for_asset(
        notes_dir,
        &target_path,
        Some(original_name.unwrap_or("image").to_string()),
        source_url,
        final_url,
        fetched_at,
    )
    .await
    .map(|mut metadata| {
        metadata.relative_path = relative_path;
        metadata
    })
}

fn ensure_asset_directory_contained(notes_dir: &str, dir: &Path) -> Result<(), VoidError> {
    let notes = validate_path(notes_dir)?;
    let base = notes.join("assets");
    let canonical_notes = std::fs::canonicalize(&notes).unwrap_or(notes.clone());
    let canonical_base = std::fs::canonicalize(&base).unwrap_or(base);
    let canonical_dir = std::fs::canonicalize(dir).map_err(|e| VoidError::DirectoryCreate {
        path: dir.to_string_lossy().to_string(),
        source: e,
    })?;
    if !canonical_base.starts_with(&canonical_notes) {
        return Err(VoidError::Asset(
            "Workspace assets directory escapes the workspace".to_string(),
        ));
    }
    if !canonical_dir.starts_with(&canonical_base) {
        return Err(VoidError::Asset(
            "Asset directory escapes the workspace assets folder".to_string(),
        ));
    }
    Ok(())
}

async fn metadata_for_asset(
    notes_dir: &str,
    path: &Path,
    original_name: Option<String>,
    source_url: Option<String>,
    final_url: Option<String>,
    fetched_at: Option<String>,
) -> Result<AssetMetadata, VoidError> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| VoidError::FileRead {
            path: path.to_string_lossy().to_string(),
            source: e,
        })?;
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(VoidError::Asset(format!(
            "Image exceeds {MAX_ASSET_BYTES}-byte limit"
        )));
    }
    let kind = detect_image_kind(&bytes)?;
    let sha256 = sha256_hex(&bytes);
    let dimensions = image_dimensions(&bytes, kind.key);
    let relative_path = path_to_relative_asset(notes_dir, path)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image")
        .to_string();

    Ok(AssetMetadata {
        relative_path,
        absolute_path: path.to_string_lossy().to_string(),
        file_name,
        content_type: kind.content_type.to_string(),
        kind: kind.key.to_string(),
        sha256,
        size: bytes.len() as u64,
        width: dimensions.map(|(width, _)| width),
        height: dimensions.map(|(_, height)| height),
        original_name,
        source_url,
        final_url,
        fetched_at,
    })
}

fn asset_base_dir(notes_dir: &str) -> Result<PathBuf, VoidError> {
    Ok(validate_path(notes_dir)?.join("assets"))
}

fn resolve_asset_path(notes_dir: &str, relative_path: &str) -> Result<PathBuf, VoidError> {
    let rel = Path::new(relative_path);
    if rel.is_absolute() {
        return Err(VoidError::Asset("Asset path must be relative".to_string()));
    }
    if rel.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(VoidError::Asset(
            "Asset path traversal is not allowed".to_string(),
        ));
    }
    let mut components = rel.components();
    if !matches!(components.next(), Some(Component::Normal(name)) if name == "assets") {
        return Err(VoidError::Asset(
            "Asset path must start with assets/".to_string(),
        ));
    }

    let notes = validate_path(notes_dir)?;
    let candidate = notes.join(rel);
    let canonical_base = std::fs::canonicalize(&notes).unwrap_or(notes.clone());
    let canonical_candidate = if candidate.exists() {
        std::fs::canonicalize(&candidate).unwrap_or(candidate.clone())
    } else {
        candidate.clone()
    };
    if !canonical_candidate.starts_with(&canonical_base) {
        return Err(VoidError::Asset(
            "Asset path escapes the workspace".to_string(),
        ));
    }
    Ok(candidate)
}

fn path_to_relative_asset(notes_dir: &str, path: &Path) -> Result<String, VoidError> {
    let notes = validate_path(notes_dir)?;
    let relative = path
        .strip_prefix(&notes)
        .map_err(|_| VoidError::Asset("Asset is outside the workspace".to_string()))?;
    let text = relative.to_string_lossy().replace('\\', "/");
    if !text.starts_with("assets/") {
        return Err(VoidError::Asset(
            "Asset is outside the workspace asset directory".to_string(),
        ));
    }
    Ok(text)
}

fn detect_image_kind(bytes: &[u8]) -> Result<ImageKind, VoidError> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(kind("png"));
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Ok(kind("jpg"));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok(kind("gif"));
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Ok(kind("webp"));
    }
    if looks_like_svg(bytes) {
        return Ok(kind("svg"));
    }
    Err(VoidError::Asset(
        "Unsupported or invalid image bytes".to_string(),
    ))
}

fn kind(key: &str) -> ImageKind {
    match key {
        "png" => ImageKind {
            key: "png",
            extension: "png",
            content_type: "image/png",
        },
        "jpg" | "jpeg" => ImageKind {
            key: "jpg",
            extension: "jpg",
            content_type: "image/jpeg",
        },
        "svg" => ImageKind {
            key: "svg",
            extension: "svg",
            content_type: "image/svg+xml",
        },
        "gif" => ImageKind {
            key: "gif",
            extension: "gif",
            content_type: "image/gif",
        },
        "webp" => ImageKind {
            key: "webp",
            extension: "webp",
            content_type: "image/webp",
        },
        _ => unreachable!("unknown image kind"),
    }
}

fn kind_from_content_type(value: &str) -> Option<ImageKind> {
    match value {
        "image/png" => Some(kind("png")),
        "image/jpeg" | "image/jpg" => Some(kind("jpg")),
        "image/svg+xml" => Some(kind("svg")),
        "image/gif" => Some(kind("gif")),
        "image/webp" => Some(kind("webp")),
        _ => None,
    }
}

fn normalize_content_type(value: &str) -> String {
    value
        .split(';')
        .next()
        .unwrap_or(value)
        .trim()
        .to_ascii_lowercase()
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    trimmed.starts_with("<svg")
        || (trimmed.starts_with("<?xml") && trimmed.to_ascii_lowercase().contains("<svg"))
}

fn sanitize_svg(bytes: &[u8]) -> Result<String, VoidError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| VoidError::Asset("SVG must be valid UTF-8".to_string()))?;
    let mut out = text.trim_start_matches('\u{feff}').to_string();

    for tag in [
        "script",
        "style",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "link",
        "meta",
        "base",
        "audio",
        "video",
        "canvas",
        "image",
        "use",
    ] {
        let block = Regex::new(&format!(r#"(?is)<\s*{tag}\b[^>]*>.*?<\s*/\s*{tag}\s*>"#))
            .map_err(|e| VoidError::Asset(e.to_string()))?;
        out = block.replace_all(&out, "").to_string();

        let tag_only = Regex::new(&format!(r#"(?is)<\s*/?\s*{tag}\b[^>]*>"#))
            .map_err(|e| VoidError::Asset(e.to_string()))?;
        out = tag_only.replace_all(&out, "").to_string();
    }

    let event_attrs = Regex::new(r#"(?is)\s+on[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#)
        .map_err(|e| VoidError::Asset(e.to_string()))?;
    out = event_attrs.replace_all(&out, "").to_string();

    let style_attrs = Regex::new(r#"(?is)\s+style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#)
        .map_err(|e| VoidError::Asset(e.to_string()))?;
    out = style_attrs.replace_all(&out, "").to_string();

    let external_refs_double = Regex::new(
        r#"(?is)\s+(?:href|xlink:href|src)\s*=\s*"\s*(?:https?:|data:|javascript:|file:|ftp:)[^"]*""#,
    )
    .map_err(|e| VoidError::Asset(e.to_string()))?;
    out = external_refs_double.replace_all(&out, "").to_string();

    let external_refs_single = Regex::new(
        r#"(?is)\s+(?:href|xlink:href|src)\s*=\s*'\s*(?:https?:|data:|javascript:|file:|ftp:)[^']*'"#,
    )
    .map_err(|e| VoidError::Asset(e.to_string()))?;
    out = external_refs_single.replace_all(&out, "").to_string();

    if !out.to_ascii_lowercase().contains("<svg") {
        return Err(VoidError::Asset(
            "SVG does not contain an <svg> root".to_string(),
        ));
    }
    if out.to_ascii_lowercase().contains("<script") {
        return Err(VoidError::Asset(
            "SVG contains active script content".to_string(),
        ));
    }
    Ok(out)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn note_slug(note_path: &str) -> String {
    let stem = Path::new(note_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("note");
    slugify(stem, "note")
}

fn safe_asset_name(original_name: &str, extension: &str) -> String {
    let stem = Path::new(original_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(original_name);
    let slug = slugify(stem, "image");
    let trimmed = slug.trim_end_matches(&format!("-{extension}"));
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed.chars().take(64).collect()
    }
}

fn slugify(input: &str, fallback: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in input.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

async fn read_limited_bytes(mut response: reqwest::Response) -> Result<Vec<u8>, VoidError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| VoidError::Asset(format!("Image body read failed: {e}")))?
    {
        if bytes.len() + chunk.len() > MAX_ASSET_BYTES {
            return Err(VoidError::Asset(format!(
                "Image exceeds {MAX_ASSET_BYTES}-byte limit"
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn derive_name_from_url(url: &reqwest::Url) -> Option<String> {
    url.path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|segment| !segment.trim().is_empty())
        .map(|segment| segment.to_string())
}

fn image_dimensions(bytes: &[u8], kind: &str) -> Option<(u32, u32)> {
    match kind {
        "png" => png_dimensions(bytes),
        "gif" => gif_dimensions(bytes),
        "jpg" => jpeg_dimensions(bytes),
        "webp" => webp_dimensions(bytes),
        "svg" => svg_dimensions(bytes),
        _ => None,
    }
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?),
        u32::from_be_bytes(bytes[20..24].try_into().ok()?),
    ))
}

fn gif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 10 {
        return None;
    }
    Some((
        u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32,
        u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32,
    ))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }
    let mut i = 2usize;
    while i + 9 < bytes.len() {
        if bytes[i] != 0xff {
            i += 1;
            continue;
        }
        while i < bytes.len() && bytes[i] == 0xff {
            i += 1;
        }
        if i >= bytes.len() {
            return None;
        }
        let marker = bytes[i];
        i += 1;
        if marker == 0xd8 || marker == 0xd9 {
            continue;
        }
        if i + 2 > bytes.len() {
            return None;
        }
        let length = u16::from_be_bytes(bytes[i..i + 2].try_into().ok()?) as usize;
        if length < 2 || i + length > bytes.len() {
            return None;
        }
        let is_sof = matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        );
        if is_sof && length >= 7 {
            let height = u16::from_be_bytes(bytes[i + 3..i + 5].try_into().ok()?) as u32;
            let width = u16::from_be_bytes(bytes[i + 5..i + 7].try_into().ok()?) as u32;
            return Some((width, height));
        }
        i += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 30 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8 " if bytes.len() >= 30 => Some((
            (u16::from_le_bytes(bytes[26..28].try_into().ok()?) & 0x3fff) as u32,
            (u16::from_le_bytes(bytes[28..30].try_into().ok()?) & 0x3fff) as u32,
        )),
        b"VP8L" if bytes.len() >= 25 => {
            let b0 = bytes[21] as u32;
            let b1 = bytes[22] as u32;
            let b2 = bytes[23] as u32;
            let b3 = bytes[24] as u32;
            Some((
                1 + (((b1 & 0x3f) << 8) | b0),
                1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
            ))
        }
        b"VP8X" if bytes.len() >= 30 => Some((
            1 + read_u24_le(&bytes[24..27])?,
            1 + read_u24_le(&bytes[27..30])?,
        )),
        _ => None,
    }
}

fn read_u24_le(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 3 {
        return None;
    }
    Some(bytes[0] as u32 | ((bytes[1] as u32) << 8) | ((bytes[2] as u32) << 16))
}

fn svg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let text = std::str::from_utf8(bytes).ok()?;
    let width = extract_svg_length(text, "width")?;
    let height = extract_svg_length(text, "height")?;
    Some((width, height))
}

fn extract_svg_length(text: &str, attr: &str) -> Option<u32> {
    let pattern = Regex::new(&format!(r#"(?is)\b{}\s*=\s*["']\s*([0-9]+)"#, attr)).ok()?;
    pattern
        .captures(text)
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse::<u32>().ok())
}
