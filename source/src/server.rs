use super::*;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::Mutex,
};
include!(concat!(env!("OUT_DIR"), "/assets.rs"));
fn reply(stream: &mut TcpStream, status: &str, mime: &str, body: &[u8]) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(body);
}
// Optional UI wire format: dictionary-encode repeated names and omit per-row
// JSON field names. The normal API remains unchanged for tools and tests.
fn compact_result(result: &search::Response, data: &Data) -> Vec<u8> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Compact<'a> {
        compact: bool,
        material_names: Vec<&'a str>,
        labels: Vec<&'a str>,
        rows: Vec<(
            Vec<usize>,
            f64,
            &'a [usize],
            f64,
            usize,
            usize,
            &'a str,
            bool,
        )>,
        search_ms: f64,
        survivors: usize,
        logical_total: u64,
        cancelled: bool,
    }
    let mut names: Vec<&str> = data.mats.iter().map(|m| m.name.as_str()).collect();
    names.push("");
    let material_ids: HashMap<&str, usize> =
        names.iter().enumerate().map(|(i, &s)| (s, i)).collect();
    let mut labels = Vec::new();
    let mut label_ids = HashMap::new();
    let rows = result
        .rows
        .iter()
        .map(|r| {
            let next = labels.len();
            let label = *label_ids
                .entry(r.top_result_key.as_str())
                .or_insert_with(|| {
                    labels.push(r.top_result_key.as_str());
                    next
                });
            (
                r.materials
                    .iter()
                    .map(|m| material_ids[m.as_str()])
                    .collect(),
                r.prob_per_gizmo,
                r.best_levels.as_slice(),
                r.no_effect_prob,
                r.permutations_tried,
                label,
                r.gizmo_type.as_str(),
                r.ancient,
            )
        })
        .collect();
    serde_json::to_vec(&Compact {
        compact: true,
        material_names: names,
        labels,
        rows,
        search_ms: result.search_ms,
        survivors: result.survivors,
        logical_total: result.logical_total,
        cancelled: result.cancelled,
    })
    .unwrap()
}
pub fn run(data: Data) {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn FreeConsole() -> i32;
        }
        unsafe {
            FreeConsole();
        }
    }
    let listener = TcpListener::bind("127.0.0.1:0").expect("Cannot bind local server");
    let port = listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");
    let data = Arc::new(data);
    let busy = Arc::new(Mutex::new(()));
    let cancel = Arc::new(AtomicBool::new(false));
    let last_seen = Arc::new(Mutex::new(Instant::now()));
    let sessions = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    {
        let seen = last_seen.clone();
        let sessions = sessions.clone();
        let busy = busy.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_secs(15));
                if sessions.load(Ordering::Relaxed) == 0
                    && seen.lock().unwrap().elapsed().as_secs() > 90
                    && busy.try_lock().is_ok()
                {
                    std::process::exit(0);
                }
            }
        });
    }
    if !std::env::args().any(|a| a == "--no-browser") {
        let _ = std::process::Command::new("explorer.exe").arg(&url).spawn();
    }
    if let Some(path) = std::env::args()
        .skip_while(|a| a != "--address-file")
        .nth(1)
    {
        std::fs::write(path, &url).unwrap();
    }
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let data = data.clone();
        let busy = busy.clone();
        let cancel = cancel.clone();
        let seen = last_seen.clone();
        let sessions = sessions.clone();
        let origin = url.clone();
        std::thread::spawn(move || {
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
            let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(10)));
            let mut bytes = Vec::new();
            let mut chunk = [0; 4096];
            let header_end = loop {
                let Ok(n) = stream.read(&mut chunk) else {
                    return;
                };
                if n == 0 {
                    return;
                }
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    break i + 4;
                }
                if bytes.len() > 16384 {
                    return;
                }
            };
            let headers = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
            let mut lines = headers.lines();
            let first = lines
                .next()
                .unwrap_or("")
                .split_whitespace()
                .collect::<Vec<_>>();
            if first.len() != 3 {
                return;
            }
            let header = |name: &str| {
                headers
                    .lines()
                    .filter_map(|l| l.split_once(':'))
                    .find(|(k, _)| k.eq_ignore_ascii_case(name))
                    .map(|(_, v)| v.trim())
            };
            if header("Host") != Some(origin.trim_start_matches("http://"))
                || header("Origin").is_some_and(|o| o != origin)
            {
                reply(
                    &mut stream,
                    "403 Forbidden",
                    "text/plain",
                    b"Invalid origin",
                );
                return;
            }
            let method = first[0];
            let route = first[1].split('?').next().unwrap();
            *seen.lock().unwrap() = Instant::now();
            if route == "/__session" && method == "GET" {
                sessions.fetch_add(1, Ordering::Relaxed);
                let _=stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n");
                while stream.write_all(b": alive\n\n").is_ok() {
                    std::thread::sleep(std::time::Duration::from_secs(15));
                }
                sessions.fetch_sub(1, Ordering::Relaxed);
                *seen.lock().unwrap() = Instant::now();
                return;
            }
            if route == "/api/cancel" && method == "POST" {
                cancel.store(true, Ordering::Relaxed);
                reply(&mut stream, "200 OK", "application/json", b"{}");
                return;
            }
            if route == "/api/search" && method == "POST" {
                let Ok(_guard) = busy.try_lock() else {
                    reply(
                        &mut stream,
                        "409 Conflict",
                        "text/plain",
                        b"A search is already running",
                    );
                    return;
                };
                let length = header("Content-Length")
                    .and_then(|s| s.parse::<usize>().ok())
                    .unwrap_or(0);
                if length > 65536 {
                    reply(
                        &mut stream,
                        "413 Too Large",
                        "text/plain",
                        b"Request too large",
                    );
                    return;
                }
                while bytes.len() < header_end + length {
                    let Ok(n) = stream.read(&mut chunk) else {
                        return;
                    };
                    if n == 0 {
                        return;
                    }
                    bytes.extend_from_slice(&chunk[..n]);
                }
                let request = match serde_json::from_slice::<search::Request>(
                    &bytes[header_end..header_end + length],
                ) {
                    Ok(r) => r,
                    Err(e) => {
                        reply(
                            &mut stream,
                            "400 Bad Request",
                            "text/plain",
                            e.to_string().as_bytes(),
                        );
                        return;
                    }
                };
                cancel.store(false, Ordering::Relaxed);
                match search::run(&data, request, cancel.clone()) {
                    Ok(result) => reply(
                        &mut stream,
                        "200 OK",
                        "application/json",
                        &if first[1].ends_with("?compact=1") {
                            compact_result(&result, &data)
                        } else {
                            serde_json::to_vec(&result).unwrap()
                        },
                    ),
                    Err(e) => reply(&mut stream, "400 Bad Request", "text/plain", e.as_bytes()),
                };
                return;
            }
            if method != "GET" {
                reply(
                    &mut stream,
                    "405 Method Not Allowed",
                    "text/plain",
                    b"GET required",
                );
                return;
            }
            let route = if route == "/" { "/index.html" } else { route };
            if let Some((_, content)) = ASSETS.iter().find(|(name, _)| *name == route) {
                let mime = if route.ends_with(".js") {
                    "text/javascript"
                } else if route.ends_with(".css") {
                    "text/css"
                } else if route.ends_with(".html") {
                    "text/html"
                } else if route.ends_with(".json") {
                    "application/json"
                } else if route.ends_with(".svg") {
                    "image/svg+xml"
                } else if route.ends_with(".png") {
                    "image/png"
                } else {
                    "application/octet-stream"
                };
                reply(&mut stream, "200 OK", mime, content);
            } else {
                reply(&mut stream, "404 Not Found", "text/plain", b"Not found");
            }
        });
    }
}
