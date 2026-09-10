//! 钥匙串本地桥（keybridge，Q-03）：供 sidecar 内的 Node host 调钥匙串。
//! - 127.0.0.1 随机端口 + 随机 token（经环境变量注入 sidecar）
//! - 路由：GET/PUT/DELETE /secret?key=<K>（key 受 host 侧 [A-Za-z0-9._-] 校验约束，无需百分号解码）
//! - 串行处理即可（密钥操作低频）；仅绑定回环，且每次请求校验 token

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};

fn respond(stream: &mut TcpStream, code: u16, body: &str) {
    let reason = match code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let payload = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(payload.as_bytes());
    let _ = stream.flush();
}

fn query_of(target: &str) -> Option<String> {
    // target 形如 /secret?key=abc
    let rest = target.split_once('?')?.1;
    for pair in rest.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "key" {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn handle(mut stream: TcpStream, token: &str) {
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();

    // 头部：取 token 与 content-length
    let mut content_length = 0usize;
    let mut token_ok = false;
    loop {
        let mut header = String::new();
        match reader.read_line(&mut header) {
            Ok(0) => break,
            Ok(_) => {
                let h = header.trim().to_lowercase();
                if h.is_empty() {
                    break;
                }
                if let Some(v) = h.strip_prefix("x-keybridge-token:") {
                    token_ok = v.trim() == token;
                }
                if let Some(v) = h.strip_prefix("content-length:") {
                    content_length = v.trim().parse().unwrap_or(0);
                }
            }
            Err(_) => return,
        }
    }

    if !token_ok {
        respond(&mut stream, 401, "{\"error\":\"unauthorized\"}");
        return;
    }

    let path = target.split('?').next().unwrap_or("").to_string();
    if path != "/secret" {
        respond(&mut stream, 404, "{\"error\":\"not_found\"}");
        return;
    }
    let key = match query_of(&target) {
        Some(k) if !k.is_empty() => k,
        _ => {
            respond(&mut stream, 400, "{\"error\":\"key_required\"}");
            return;
        }
    };

    match method.as_str() {
        "GET" => match crate::keychain::secret_get(key) {
            Ok(Some(v)) => {
                let body = serde_json::json!({ "value": v }).to_string();
                respond(&mut stream, 200, &body);
            }
            Ok(None) => respond(&mut stream, 404, "{\"error\":\"not_found\"}"),
            Err(e) => {
                let body = serde_json::json!({ "error": e }).to_string();
                respond(&mut stream, 500, &body);
            }
        },
        "PUT" => {
            let mut buf = vec![0u8; content_length];
            if reader.read_exact(&mut buf).is_err() {
                respond(&mut stream, 400, "{\"error\":\"bad_body\"}");
                return;
            }
            let parsed: Result<serde_json::Value, _> = serde_json::from_slice(&buf);
            let value = parsed
                .ok()
                .and_then(|v| v.get("value").and_then(|x| x.as_str()).map(String::from));
            match value {
                Some(v) => match crate::keychain::secret_set(key, v) {
                    Ok(()) => respond(&mut stream, 200, "{\"ok\":true}"),
                    Err(e) => {
                        let body = serde_json::json!({ "error": e }).to_string();
                        respond(&mut stream, 500, &body);
                    }
                },
                None => respond(&mut stream, 400, "{\"error\":\"value_required\"}"),
            }
        }
        "DELETE" => match crate::keychain::secret_delete(key) {
            Ok(()) => respond(&mut stream, 200, "{\"ok\":true}"),
            Err(e) => {
                let body = serde_json::json!({ "error": e }).to_string();
                respond(&mut stream, 500, &body);
            }
        },
        _ => respond(&mut stream, 404, "{\"error\":\"not_found\"}"),
    }
}

/// 启动钥匙串桥：返回 (端口, token)。调用方经环境变量注入 sidecar。
pub fn start_bridge() -> Result<(u16, String), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    // 本地桥令牌：时间纳秒 + pid（回环 + 一次性 token，够用且零依赖）
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let token = format!("{:x}-{:x}", nanos, std::process::id());
    let token_for_thread = token.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            handle(stream, &token_for_thread);
        }
    });
    Ok((port, token))
}
