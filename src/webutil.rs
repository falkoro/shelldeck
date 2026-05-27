use axum::{http::{header, HeaderMap, HeaderValue, StatusCode}, response::{IntoResponse, Response}};
use serde::Serialize;

pub fn html_escape(value: impl AsRef<str>) -> String {
    value.as_ref()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn json_response<T: Serialize>(status: StatusCode, payload: &T) -> Response {
    let body = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
    with_security_headers((status, [(header::CONTENT_TYPE, "application/json; charset=utf-8")], body).into_response())
}

pub fn html_response(status: StatusCode, body: String) -> Response {
    with_security_headers((status, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response())
}

pub fn text_response(status: StatusCode, content_type: &'static str, body: Vec<u8>) -> Response {
    with_security_headers((status, [(header::CONTENT_TYPE, content_type)], body).into_response())
}

pub fn redirect(location: &'static str) -> Response {
    let mut response = StatusCode::SEE_OTHER.into_response();
    response.headers_mut().insert(header::LOCATION, HeaderValue::from_static(location));
    response
}

pub fn with_security_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self';"),
    );
    response
}

pub fn parse_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|part| {
        let mut pieces = part.trim().splitn(2, '=');
        let key = pieces.next()?;
        let value = pieces.next().unwrap_or_default();
        (key == name).then(|| urlencoding::decode(value).ok().map(|v| v.into_owned())).flatten()
    })
}

pub fn form_value(body: &str, key: &str) -> String {
    body.split('&').find_map(|part| {
        let mut pieces = part.splitn(2, '=');
        let name = pieces.next()?;
        let value = pieces.next().unwrap_or_default();
        (name == key).then(|| urlencoding::decode(value).map(|v| v.into_owned()).unwrap_or_default())
    }).unwrap_or_default()
}

pub fn header_string(headers: &HeaderMap, key: &str) -> String {
    headers.get(key).and_then(|v| v.to_str().ok()).unwrap_or_default().to_string()
}

pub fn normalize_ip(value: &str) -> String {
    value.trim().trim_start_matches("::ffff:").to_string()
}

pub fn client_ips(headers: &HeaderMap, remote: Option<&str>) -> Vec<String> {
    let mut ips = Vec::new();
    if let Some(value) = headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()) {
        ips.push(normalize_ip(value));
    }
    for value in header_string(headers, "x-forwarded-for").split(',') {
        let ip = normalize_ip(value);
        if !ip.is_empty() {
            ips.push(ip);
        }
    }
    if let Some(remote) = remote {
        ips.push(normalize_ip(remote));
    }
    ips.into_iter().filter(|ip| !ip.is_empty()).collect()
}
