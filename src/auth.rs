use crate::{config::Config, webutil};
use axum::{
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

const LOGIN_COOKIE: &str = "codex_dashboard";
const UNLOCK_COOKIE: &str = "codex_dashboard_unlock";
const LOGIN_MAX_AGE: u64 = 7 * 24 * 60 * 60;
const UNLOCK_MAX_AGE: u64 = 30 * 24 * 60 * 60;

#[derive(Serialize, Deserialize)]
struct TokenPayload {
    u: String,
    k: String,
    exp: u64,
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn sign(config: &Config, value: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(&config.secret).expect("hmac key");
    mac.update(value.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

fn create_token(config: &Config, username: &str, kind: &str, ttl: u64) -> String {
    let payload = TokenPayload {
        u: username.to_string(),
        k: kind.to_string(),
        exp: now_seconds() + ttl,
    };
    let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap_or_default());
    format!("{}.{}", encoded, sign(config, &encoded))
}

fn verify_token(config: &Config, token: Option<String>, kind: &str) -> bool {
    let Some(token) = token else { return false };
    let Some((payload, signature)) = token.split_once('.') else {
        return false;
    };
    if sign(config, payload) != signature {
        return false;
    }
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(payload.as_bytes()) else {
        return false;
    };
    let Ok(data) = serde_json::from_slice::<TokenPayload>(&bytes) else {
        return false;
    };
    data.u == config.user && data.k == kind && data.exp > now_seconds()
}

fn has_cf_headers(headers: &HeaderMap) -> bool {
    headers.contains_key("cf-connecting-ip")
        || headers.contains_key("cf-access-authenticated-user-email")
        || headers.contains_key("cf-ray")
}

fn cf_email(headers: &HeaderMap) -> String {
    webutil::header_string(headers, "cf-access-authenticated-user-email").to_lowercase()
}

pub fn network_allowed(config: &Config, headers: &HeaderMap, remote: Option<&str>) -> bool {
    let email = cf_email(headers);
    if config.trust_cf_access_email && !email.is_empty() && config.allowed_emails.contains(&email) {
        return true;
    }
    if webutil::client_ips(headers, remote)
        .iter()
        .any(|ip| config.allowed_ips.contains(ip))
    {
        return true;
    }
    if config.allow_cloudflare_login && has_cf_headers(headers) {
        return true;
    }
    matches!(remote, Some("127.0.0.1") | Some("::1")) && !has_cf_headers(headers)
}

pub fn authenticated(config: &Config, headers: &HeaderMap, remote: Option<&str>) -> bool {
    // When fronted by an external auth layer (e.g. Cloudflare Access / Zero Trust),
    // skip ShellDeck's own login password — reaching this point already means the
    // request passed the network gate in `network_allowed`. Shells still need unlock.
    if config.skip_login {
        return true;
    }
    let email = cf_email(headers);
    if config.trust_cf_access_email && !email.is_empty() && config.allowed_emails.contains(&email) {
        return true;
    }
    let bypass = has_cf_headers(headers)
        && webutil::client_ips(headers, remote)
            .iter()
            .any(|ip| config.bypass_login_ips.contains(ip));
    bypass
        || verify_token(
            config,
            webutil::parse_cookie(headers, LOGIN_COOKIE),
            "login",
        )
}

pub fn unlocked(config: &Config, headers: &HeaderMap) -> bool {
    verify_token(
        config,
        webutil::parse_cookie(headers, UNLOCK_COOKIE),
        "unlock",
    )
}

fn secure_suffix(headers: &HeaderMap) -> &'static str {
    if webutil::header_string(headers, "x-forwarded-proto") == "https" || has_cf_headers(headers) {
        "; Secure"
    } else {
        ""
    }
}

pub fn set_login_cookie(
    response: &mut Response,
    config: &Config,
    headers: &HeaderMap,
    username: &str,
) {
    let cookie = format!(
        "{}={}; HttpOnly; Path=/; SameSite=Lax; Max-Age={}{}",
        LOGIN_COOKIE,
        urlencoding::encode(&create_token(config, username, "login", LOGIN_MAX_AGE)),
        LOGIN_MAX_AGE,
        secure_suffix(headers)
    );
    response
        .headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
}

pub fn set_unlock_cookie(response: &mut Response, config: &Config, headers: &HeaderMap) {
    let cookie = format!(
        "{}={}; HttpOnly; Path=/; SameSite=Lax; Max-Age={}{}",
        UNLOCK_COOKIE,
        urlencoding::encode(&create_token(
            config,
            &config.user,
            "unlock",
            UNLOCK_MAX_AGE
        )),
        UNLOCK_MAX_AGE,
        secure_suffix(headers)
    );
    response
        .headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
}

pub fn logout_response() -> Response {
    let mut response = axum::response::Redirect::to("/login").into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_static("codex_dashboard=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"),
    );
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "codex_dashboard_unlock=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
        ),
    );
    response
}
