use crate::error::VoidError;
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

const MAX_RESPONSE_BYTES: usize = 5_000_000;
const MAX_REDIRECTS: u8 = 8;
const DEFAULT_TIMEOUT_MS: u64 = 10_000;
const MAX_TIMEOUT_MS: u64 = 60_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchResult {
    url: String,
    final_url: String,
    ok: bool,
    status: u16,
    title: Option<String>,
    excerpt: Option<String>,
    content_type: Option<String>,
    fetched_at: String,
    error: Option<String>,
}

/// Reject IPv4 addresses that point at private, loopback, link-local, cloud-metadata,
/// CGNAT, documentation, broadcast, or reserved ranges. This is the SSRF guard for
/// IPv4 — anything that could let untrusted content reach the user's LAN, the
/// loopback API of another app, or an IMDS endpoint must return true.
fn is_disallowed_ipv4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        // 100.64.0.0/10 — Carrier-grade NAT
        || (o[0] == 100 && (64..128).contains(&o[1]))
        // 192.0.0.0/24 — IETF protocol assignments
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
        // 198.18.0.0/15 — Benchmarking
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
        // 240.0.0.0/4 — Reserved (incl. 255.255.255.255)
        || o[0] >= 240
}

/// Reject IPv6 addresses that point at loopback, unspecified, unique-local,
/// link-local, multicast, site-local, or IPv4-mapped/compatible/translated
/// addresses that would themselves resolve to a private IPv4. Stable-Rust only —
/// we re-implement the checks bit-wise instead of relying on unstable methods.
fn is_disallowed_ipv6(ip: Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    let s = ip.segments();
    let multicast = (s[0] & 0xff00) == 0xff00;
    let unique_local = (s[0] & 0xfe00) == 0xfc00;
    let link_local = (s[0] & 0xffc0) == 0xfe80;
    let site_local = (s[0] & 0xffc0) == 0xfec0;
    if multicast || unique_local || link_local || site_local {
        return true;
    }
    // ::ffff:0:0/96 — IPv4-mapped. The low 32 bits are an IPv4 address.
    let leading_zero = s[0] == 0 && s[1] == 0 && s[2] == 0 && s[3] == 0 && s[4] == 0;
    if leading_zero && s[5] == 0xffff {
        let o = ip.octets();
        return is_disallowed_ipv4(Ipv4Addr::new(o[12], o[13], o[14], o[15]));
    }
    // ::/96 (deprecated IPv4-compatible) and 64:ff9b::/96 (NAT64)
    if leading_zero && s[5] == 0 {
        let o = ip.octets();
        return is_disallowed_ipv4(Ipv4Addr::new(o[12], o[13], o[14], o[15]));
    }
    if s[0] == 0x0064 && s[1] == 0xff9b && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0 {
        let o = ip.octets();
        return is_disallowed_ipv4(Ipv4Addr::new(o[12], o[13], o[14], o[15]));
    }
    false
}

fn is_disallowed_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_disallowed_ipv4(v4),
        IpAddr::V6(v6) => is_disallowed_ipv6(v6),
    }
}

/// Resolve a host:port pair to every IP that DNS reports, then ensure every one
/// is publicly routable. We check all results to defend against DNS rebinding
/// returning multiple addresses where one is private.
async fn ensure_public_host(host: &str, port: u16) -> Result<(), String> {
    let target = format!("{host}:{port}");
    let iter = tokio::net::lookup_host(&target)
        .await
        .map_err(|e| format!("DNS lookup failed for {host}: {e}"))?;
    let mut found_any = false;
    for socket_addr in iter {
        found_any = true;
        if is_disallowed_ip(socket_addr.ip()) {
            return Err(format!(
                "Refusing to fetch private or reserved address {} for {}",
                socket_addr.ip(),
                host
            ));
        }
    }
    if !found_any {
        return Err(format!("No addresses resolved for {host}"));
    }
    Ok(())
}

/// Validate that a URL is fetchable: http/https only, has a host, the host does
/// not look like a literal private/reserved IP, and DNS resolution returns only
/// public addresses. Returns the parsed URL so callers can reuse it.
async fn validate_fetch_url(url: &reqwest::Url) -> Result<(), String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(format!("Unsupported URL protocol: {}", url.scheme()));
    }
    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?;
    // If the host is a literal IP, check it directly. Otherwise resolve via DNS.
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_disallowed_ip(ip) {
            return Err(format!(
                "Refusing to fetch private or reserved address {ip}"
            ));
        }
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(0);
    ensure_public_host(host, port).await
}

#[tauri::command]
pub async fn web_fetch(url: String, timeout_ms: Option<u64>) -> Result<WebFetchResult, VoidError> {
    let parsed =
        reqwest::Url::parse(&url).map_err(|e| VoidError::WebFetch(format!("Invalid URL: {e}")))?;

    if let Err(message) = validate_fetch_url(&parsed).await {
        return Err(VoidError::WebFetch(message));
    }

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS));

    // Manual redirect handling so we can re-validate each hop against the SSRF
    // policy. reqwest's built-in redirect follows happen inside the client and
    // give us no chance to DNS-resolve and check the next target.
    let client = match reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("VoidResearchBot/0.1 (+https://void.local)")
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(e) => return Err(VoidError::WebFetch(e.to_string())),
    };

    let fetched_at = current_timestamp();
    let mut current_url = parsed.clone();
    let mut redirects = 0u8;

    let response = loop {
        let response = match client.get(current_url.clone()).send().await {
            Ok(response) => response,
            Err(e) => {
                return Ok(WebFetchResult {
                    url: parsed.to_string(),
                    final_url: current_url.to_string(),
                    ok: false,
                    status: 0,
                    title: None,
                    excerpt: None,
                    content_type: None,
                    fetched_at,
                    error: Some(e.to_string()),
                });
            }
        };

        let status = response.status();
        if status.is_redirection() {
            if redirects >= MAX_REDIRECTS {
                return Ok(WebFetchResult {
                    url: parsed.to_string(),
                    final_url: current_url.to_string(),
                    ok: false,
                    status: status.as_u16(),
                    title: None,
                    excerpt: None,
                    content_type: None,
                    fetched_at,
                    error: Some("Too many redirects".to_string()),
                });
            }
            redirects += 1;
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let Some(location) = location else {
                return Ok(WebFetchResult {
                    url: parsed.to_string(),
                    final_url: current_url.to_string(),
                    ok: false,
                    status: status.as_u16(),
                    title: None,
                    excerpt: None,
                    content_type: None,
                    fetched_at,
                    error: Some("Redirect without Location header".to_string()),
                });
            };
            let next = match current_url.join(&location) {
                Ok(u) => u,
                Err(e) => {
                    return Ok(WebFetchResult {
                        url: parsed.to_string(),
                        final_url: current_url.to_string(),
                        ok: false,
                        status: status.as_u16(),
                        title: None,
                        excerpt: None,
                        content_type: None,
                        fetched_at,
                        error: Some(format!("Invalid redirect target: {e}")),
                    });
                }
            };
            if let Err(message) = validate_fetch_url(&next).await {
                return Err(VoidError::WebFetch(message));
            }
            current_url = next;
            continue;
        }

        break response;
    };

    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_RESPONSE_BYTES)
    {
        return Ok(WebFetchResult {
            url: parsed.to_string(),
            final_url,
            ok: false,
            status: status.as_u16(),
            title: None,
            excerpt: None,
            content_type,
            fetched_at,
            error: Some("Response too large to verify as a citation".to_string()),
        });
    }
    let text = match read_limited_body(response, MAX_RESPONSE_BYTES).await {
        Ok(text) => text,
        Err(message) => {
            return Ok(WebFetchResult {
                url: parsed.to_string(),
                final_url,
                ok: false,
                status: status.as_u16(),
                title: None,
                excerpt: None,
                content_type,
                fetched_at,
                error: Some(message),
            });
        }
    };
    let title = extract_between_case_insensitive(&text, "<title", "</title>")
        .and_then(|raw| raw.split_once('>').map(|(_, value)| value.to_string()))
        .map(|value| cleanup_text(&value))
        .filter(|value| !value.is_empty())
        .map(|value| truncate_chars(&value, 180));
    let excerpt = extract_meta_description(&text)
        .or_else(|| Some(strip_html(&text)))
        .map(|value| cleanup_text(&value))
        .filter(|value| !value.is_empty())
        .map(|value| truncate_chars(&value, 420));

    Ok(WebFetchResult {
        url: parsed.to_string(),
        final_url,
        ok: status.is_success(),
        status: status.as_u16(),
        title,
        excerpt,
        content_type,
        fetched_at,
        error: if status.is_success() {
            None
        } else {
            Some(format!("HTTP {}", status.as_u16()))
        },
    })
}

fn current_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

async fn read_limited_body(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<String, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > max_bytes {
            return Err("Response too large to verify as a citation".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn extract_between_case_insensitive(text: &str, start: &str, end: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let start_index = lower.find(start)?;
    let end_index = lower[start_index..].find(end)? + start_index;
    Some(text[start_index..end_index].to_string())
}

fn extract_meta_description(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    for marker in [
        "name=\"description\"",
        "property=\"og:description\"",
        "name='description'",
        "property='og:description'",
    ] {
        if let Some(marker_index) = lower.find(marker) {
            let Some(tag_start) = lower[..marker_index].rfind("<meta") else {
                continue;
            };
            let Some(relative_tag_end) = lower[marker_index..].find('>') else {
                continue;
            };
            let tag_end = relative_tag_end + marker_index;
            let tag = &text[tag_start..tag_end];
            if let Some(content) = extract_attr(tag, "content") {
                return Some(content);
            }
        }
    }
    None
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let needle = format!("{attr}=");
    let index = lower.find(&needle)? + needle.len();
    let quote = tag[index..].chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &tag[index + quote.len_utf8()..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len().min(2048));
    let mut in_tag = false;
    for ch in text.chars().take(12_000) {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn cleanup_text(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn rejects_loopback_v4() {
        assert!(is_disallowed_ipv4(Ipv4Addr::new(127, 0, 0, 1)));
        assert!(is_disallowed_ipv4(Ipv4Addr::new(127, 255, 255, 254)));
    }

    #[test]
    fn rejects_private_v4() {
        assert!(is_disallowed_ipv4(Ipv4Addr::new(10, 0, 0, 1)));
        assert!(is_disallowed_ipv4(Ipv4Addr::new(172, 16, 0, 1)));
        assert!(is_disallowed_ipv4(Ipv4Addr::new(192, 168, 1, 1)));
    }

    #[test]
    fn rejects_link_local_v4_and_imds() {
        assert!(is_disallowed_ipv4(Ipv4Addr::new(169, 254, 0, 1)));
        // AWS / GCP / OpenStack instance metadata
        assert!(is_disallowed_ipv4(Ipv4Addr::new(169, 254, 169, 254)));
    }

    #[test]
    fn rejects_cgnat_v4() {
        assert!(is_disallowed_ipv4(Ipv4Addr::new(100, 64, 0, 1)));
        assert!(is_disallowed_ipv4(Ipv4Addr::new(100, 127, 255, 254)));
        // Just outside CGNAT — public
        assert!(!is_disallowed_ipv4(Ipv4Addr::new(100, 63, 255, 254)));
        assert!(!is_disallowed_ipv4(Ipv4Addr::new(100, 128, 0, 1)));
    }

    #[test]
    fn allows_public_v4() {
        assert!(!is_disallowed_ipv4(Ipv4Addr::new(8, 8, 8, 8)));
        assert!(!is_disallowed_ipv4(Ipv4Addr::new(1, 1, 1, 1)));
    }

    #[test]
    fn rejects_loopback_v6() {
        assert!(is_disallowed_ipv6(Ipv6Addr::from_str("::1").unwrap()));
    }

    #[test]
    fn rejects_unique_and_link_local_v6() {
        assert!(is_disallowed_ipv6(Ipv6Addr::from_str("fc00::1").unwrap()));
        assert!(is_disallowed_ipv6(Ipv6Addr::from_str("fd12:3456::1").unwrap()));
        assert!(is_disallowed_ipv6(Ipv6Addr::from_str("fe80::1").unwrap()));
    }

    #[test]
    fn rejects_mapped_private_v4() {
        assert!(is_disallowed_ipv6(
            Ipv6Addr::from_str("::ffff:127.0.0.1").unwrap()
        ));
        assert!(is_disallowed_ipv6(
            Ipv6Addr::from_str("::ffff:10.0.0.1").unwrap()
        ));
    }

    #[test]
    fn allows_public_v6() {
        assert!(!is_disallowed_ipv6(
            Ipv6Addr::from_str("2606:4700:4700::1111").unwrap()
        ));
    }
}
