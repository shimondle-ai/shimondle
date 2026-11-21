use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;

static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn cancelled() -> &'static Mutex<HashSet<String>> {
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_cancelled(id: &str) -> bool {
    cancelled().lock().map(|s| s.contains(id)).unwrap_or(false)
}

fn clear_cancelled(id: &str) {
    if let Ok(mut s) = cancelled().lock() {
        s.remove(id);
    }
}

fn endpoint(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

#[derive(Serialize, Clone)]
pub struct ModelInfo {
    name: String,
    size: u64,
    params: String,
    quant: String,
    family: String,
}

#[tauri::command]
async fn list_models(base_url: String) -> Result<Vec<ModelInfo>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(endpoint(&base_url, "/api/tags"))
        .send()
        .await
        .map_err(|e| format!("Can't reach Ollama: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Ollama responded {}", res.status()));
    }

    let payload: Value = res.json().await.map_err(|e| e.to_string())?;
    let models = payload
        .get("models")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(models
        .iter()
        .map(|m| ModelInfo {
            name: m["name"].as_str().unwrap_or_default().to_string(),
            size: m["size"].as_u64().unwrap_or(0),
            params: m["details"]["parameter_size"].as_str().unwrap_or_default().to_string(),
            quant: m["details"]["quantization_level"].as_str().unwrap_or_default().to_string(),
            family: m["details"]["family"].as_str().unwrap_or_default().to_string(),
        })
        .collect())
}

#[tauri::command]
async fn ping(base_url: String) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .connect_timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    match client.get(endpoint(&base_url, "/api/tags")).send().await {
        Ok(r) => Ok(r.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[derive(Deserialize)]
struct ChatMsg {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatArgs {
    base_url: String,
    model: String,
    system: String,
    messages: Vec<ChatMsg>,
    temperature: f64,
    num_ctx: u32,
    request_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatEvent {
    delta: Option<String>,
    done: bool,
    error: Option<String>,
    eval_count: Option<u64>,
    total_ms: Option<u64>,
}

fn event_delta(chunk: &str, _id: &str) -> ChatEvent {
    ChatEvent { delta: Some(chunk.to_string()), done: false, error: None, eval_count: None, total_ms: None }
}

#[tauri::command]
async fn chat(args: ChatArgs, on_event: Channel<ChatEvent>) -> Result<(), String> {
    clear_cancelled(&args.request_id);

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let mut messages: Vec<Value> = Vec::new();
    if !args.system.trim().is_empty() {
        messages.push(json!({ "role": "system", "content": args.system }));
    }
    for m in &args.messages {
        messages.push(json!({ "role": m.role, "content": m.content }));
    }

    let body = json!({
        "model": args.model,
        "messages": messages,
        "stream": true,
        "options": {
            "temperature": args.temperature,
            "num_ctx": args.num_ctx
        }
    });

    let res = match client
        .post(endpoint(&args.base_url, "/api/chat"))
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Can't reach Ollama: {e}");
            let _ = on_event.send(ChatEvent { delta: None, done: true, error: Some(msg.clone()), eval_count: None, total_ms: None });
            return Err(msg);
        }
    };

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
            .unwrap_or_else(|| text.chars().take(240).collect());
        let msg = format!("Ollama error {status}: {detail}");
        let _ = on_event.send(ChatEvent { delta: None, done: true, error: Some(msg.clone()), eval_count: None, total_ms: None });
        return Err(msg);
    }

    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    let mut eval_count: Option<u64> = None;

    while let Some(chunk) = stream.next().await {
        if is_cancelled(&args.request_id) {
            clear_cancelled(&args.request_id);
            let _ = on_event.send(ChatEvent { delta: None, done: true, error: None, eval_count, total_ms: None });
            return Ok(());
        }

        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                let msg = format!("stream: {e}");
                let _ = on_event.send(ChatEvent { delta: None, done: true, error: Some(msg.clone()), eval_count, total_ms: None });
                return Err(msg);
            }
        };

        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let value: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if let Some(err) = value.get("error").and_then(|e| e.as_str()) {
                let _ = on_event.send(ChatEvent { delta: None, done: true, error: Some(err.to_string()), eval_count, total_ms: None });
                return Ok(());
            }

            if let Some(text) = value["message"]["content"].as_str() {
                if !text.is_empty() {
                    let _ = on_event.send(event_delta(text, &args.request_id));
                }
            }

            if let Some(count) = value["eval_count"].as_u64() {
                eval_count = Some(count);
            }

            if value["done"].as_bool().unwrap_or(false) {
                let total_ms = value["total_duration"].as_u64().map(|ns| ns / 1_000_000);
                let _ = on_event.send(ChatEvent { delta: None, done: true, error: None, eval_count, total_ms });
                clear_cancelled(&args.request_id);
                return Ok(());
            }
        }
    }

    let _ = on_event.send(ChatEvent { delta: None, done: true, error: None, eval_count, total_ms: None });
    clear_cancelled(&args.request_id);
    Ok(())
}

#[tauri::command]
fn cancel_chat(request_id: String) {
    if let Ok(mut set) = cancelled().lock() {
        set.insert(request_id);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_models, ping, chat, cancel_chat])
        .run(tauri::generate_context!())
        .expect("error while running Shimondle");
}
