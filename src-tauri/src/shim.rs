//! Statusline shim mode (`halo --shim`).
//!
//! Claude Code pipes its statusline JSON to this process on every refresh.
//! We tee the payload to latest.json (+ a throttled utilization history),
//! then run the user's original statusline command with the same stdin so
//! their statusline keeps working exactly as before.
//!
//! This runs inside Claude Code constantly: it must never panic, never hang,
//! and always produce the original statusline output.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

const HISTORY_MIN_INTERVAL_MS: u128 = 60_000;
const HISTORY_MAX_BYTES: u64 = 512 * 1024;
const HISTORY_KEEP_LINES: usize = 2000;

pub fn monitor_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("usage-monitor")
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn utilization(bucket: &serde_json::Value) -> Option<f64> {
    let v = bucket.get("utilization")?.as_f64()?;
    Some(if v <= 1.0 { v * 100.0 } else { v })
}

fn capture(raw: &str) {
    let dir = monitor_dir();
    let _ = std::fs::create_dir_all(&dir);

    let mut payload: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return,
    };
    if let Some(obj) = payload.as_object_mut() {
        obj.insert(
            "__captured_at".into(),
            serde_json::Value::from(now_ms() as u64),
        );
    }

    let latest = dir.join("latest.json");
    let tmp = dir.join("latest.json.tmp");
    if std::fs::write(&tmp, payload.to_string()).is_ok() {
        let _ = std::fs::rename(&tmp, &latest);
    }

    record_history(&payload);
}

/// Append a utilization sample at most once per minute; feeds the pace
/// projection and the sparkline in the widget.
fn record_history(payload: &serde_json::Value) {
    let Some(rl) = payload.get("rate_limits") else {
        return;
    };
    let history = monitor_dir().join("history.jsonl");

    if let Ok(meta) = std::fs::metadata(&history) {
        if let Ok(modified) = meta.modified() {
            if let Ok(age) = std::time::SystemTime::now().duration_since(modified) {
                if age.as_millis() < HISTORY_MIN_INTERVAL_MS {
                    return;
                }
            }
        }
        if meta.len() > HISTORY_MAX_BYTES {
            if let Ok(text) = std::fs::read_to_string(&history) {
                let lines: Vec<&str> = text.lines().collect();
                let keep = lines.len().saturating_sub(HISTORY_KEEP_LINES);
                let _ = std::fs::write(&history, lines[keep..].join("\n") + "\n");
            }
        }
    }

    let sample = serde_json::json!({
        "t": now_ms() as u64,
        "fh": rl.get("five_hour").and_then(utilization),
        "sd": rl.get("seven_day").and_then(utilization),
    });
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&history)
    {
        let _ = writeln!(f, "{sample}");
    }
}

fn original_command() -> Option<String> {
    let config = monitor_dir().join("shim-config.json");
    let text = std::fs::read_to_string(config).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("originalCommand")?.as_str().map(String::from)
}

fn passthrough(raw: &str) {
    match original_command() {
        Some(cmd) if !cmd.trim().is_empty() => {
            #[cfg(target_os = "windows")]
            let mut command = {
                let mut c = Command::new("cmd");
                c.args(["/C", &cmd]);
                c
            };
            #[cfg(not(target_os = "windows"))]
            let mut command = {
                let mut c = Command::new("sh");
                c.args(["-c", &cmd]);
                c
            };
            let mut child = command
                .stdin(Stdio::piped())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .spawn();

            if let Ok(child) = child.as_mut() {
                if let Some(stdin) = child.stdin.take() {
                    let mut stdin = stdin;
                    let _ = stdin.write_all(raw.as_bytes());
                }
                let _ = child.wait();
            } else {
                fallback_line(raw);
            }
        }
        _ => fallback_line(raw),
    }
}

/// Minimal statusline for users who had none configured.
fn fallback_line(raw: &str) {
    let payload: serde_json::Value = serde_json::from_str(raw).unwrap_or_default();
    let model = payload
        .pointer("/model/display_name")
        .or_else(|| payload.pointer("/model/id"))
        .and_then(|v| v.as_str())
        .unwrap_or("Claude");
    let mut parts = vec![model.to_string()];
    if let Some(rl) = payload.get("rate_limits") {
        if let Some(v) = rl.get("five_hour").and_then(utilization) {
            parts.push(format!("5h {}%", v.round() as i64));
        }
        if let Some(v) = rl.get("seven_day").and_then(utilization) {
            parts.push(format!("7d {}%", v.round() as i64));
        }
    }
    print!("{}", parts.join(" | "));
}

pub fn run() {
    let mut raw = String::new();
    let _ = std::io::stdin().read_to_string(&mut raw);
    capture(&raw);
    passthrough(&raw);
}
