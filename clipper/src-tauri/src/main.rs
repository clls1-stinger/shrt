// shrt-clipper: comparte capturas y grabaciones, y acorta los links copiados.
// El token de administrador nunca viene en el binario: lo pone cada usuario.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    base: String,
    token: String,
    enabled: bool,
    replace_clipboard: bool,
    flash: bool,
    notify: bool,
    screenshots: bool,
    clip_images: bool,
    autostart: bool,
    onboarded: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            base: "https://shrt.emky.com.mx".into(),
            token: String::new(),
            enabled: true,
            replace_clipboard: true,
            flash: true,
            notify: true,
            screenshots: false,
            clip_images: false,
            autostart: true,
            onboarded: false,
        }
    }
}

#[derive(Clone, Serialize)]
struct HistItem {
    original: String,
    short: String,
    ts: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct MediaItem {
    code: String,
    url: String,
    direct_url: String,
    kind: String,
    status: String,
    expires_at: u64,
    delete_key: String,
    #[serde(default)]
    ts: u64,
}

struct AppState {
    config: Mutex<Config>,
    history: Mutex<Vec<HistItem>>,
    media: Mutex<Vec<MediaItem>>,
}

static LAST_IMAGE: AtomicU64 = AtomicU64::new(0);
// Windows y Spectacle pueden guardar el archivo y copiar la imagen a la vez.
const DUPLICATE_WINDOW_SECS: u64 = 8;
const MAX_MEDIA_BYTES: u64 = 95 * 1024 * 1024;

fn config_path() -> std::path::PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    p.push("shrt-clipper");
    let _ = std::fs::create_dir_all(&p);
    p.push("config.json");
    p
}
fn load_config() -> Config {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn save_config_file(c: &Config) {
    if let Ok(s) = serde_json::to_string_pretty(c) {
        let _ = std::fs::write(config_path(), s);
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn host_of(u: &str) -> Option<String> {
    u.split("://").nth(1)?.split('/').next().map(|h| h.to_string())
}

// ¿Es un único URL acortable? (no texto con link embebido, no nuestro propio dominio)
fn is_shortenable(text: &str, base: &str) -> bool {
    let t = text.trim();
    if !(t.starts_with("http://") || t.starts_with("https://")) {
        return false;
    }
    if t.split_whitespace().count() != 1 || t.len() > 2000 {
        return false;
    }
    if let Some(h) = host_of(t) {
        if base.contains(&h) || h.contains("shrt.emky.com.mx") {
            return false;
        }
    }
    true
}

fn media_path() -> PathBuf {
    config_path().with_file_name("media.json")
}
fn load_media() -> Vec<MediaItem> {
    let now = now_secs();
    std::fs::read_to_string(media_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<MediaItem>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|i| i.expires_at > now)
        .collect()
}
fn save_media(items: &[MediaItem]) {
    if let Ok(s) = serde_json::to_string(items) {
        let _ = std::fs::write(media_path(), s);
    }
}

fn upload_error(code: &str) -> String {
    match code {
        "unsupported_type" | "invalid_media" => "El archivo no es una imagen o video válido",
        "too_large" => "El archivo es demasiado grande",
        "too_long" => "El video dura más de 10 minutos",
        "rate_limited" => "Demasiadas subidas. Intenta en un rato",
        "storage_full" => "El servidor no tiene espacio ahora",
        "busy" => "Hay muchos videos en cola",
        _ => "No se pudo subir el archivo",
    }
    .into()
}

fn upload(base: &str, body: Vec<u8>) -> Result<MediaItem, String> {
    let b = base.trim_end_matches('/');
    let resp = reqwest::blocking::Client::new()
        .post(format!("{b}/api/media"))
        .header("content-type", "application/octet-stream")
        .body(body)
        .timeout(Duration::from_secs(600))
        .send()
        .map_err(|_| "No hay conexión con el servidor".to_string())?;
    if !resp.status().is_success() {
        let v: serde_json::Value = resp.json().unwrap_or_default();
        return Err(upload_error(v["error"].as_str().unwrap_or("")));
    }
    let mut item: MediaItem = resp.json().map_err(|_| "Respuesta inválida del servidor".to_string())?;
    item.ts = now_secs();
    Ok(item)
}

fn wait_ready(base: &str, code: &str) -> String {
    let b = base.trim_end_matches('/');
    let client = reqwest::blocking::Client::new();
    for _ in 0..300 {
        let status = client
            .get(format!("{b}/api/media/{code}/status"))
            .timeout(Duration::from_secs(15))
            .send()
            .ok()
            .and_then(|r| r.json::<serde_json::Value>().ok())
            .and_then(|v| v["status"].as_str().map(String::from));
        match status.as_deref() {
            Some("processing") | None => thread::sleep(Duration::from_secs(3)),
            Some(s) => return s.to_string(),
        }
    }
    "failed".into()
}

fn remember_media(app: &tauri::AppHandle, item: MediaItem) {
    let cfg = app.state::<AppState>().config.lock().unwrap().clone();
    {
        let state = app.state::<AppState>();
        let mut items = state.media.lock().unwrap();
        items.retain(|i| i.code != item.code);
        items.insert(0, item.clone());
        items.truncate(300);
        save_media(&items);
    }
    if cfg.replace_clipboard {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let _ = cb.set_text(item.url.clone());
        }
    }
    if cfg.notify {
        let title = if item.kind == "video" { "Video listo. Link copiado" } else { "Captura subida. Link copiada" };
        let _ = app.notification().builder().title(title).body(&item.url).show();
    }
    if cfg.flash {
        flash_cursor(app);
    }
    let _ = app.emit("media", item.code.clone());
}

fn notify_error(app: &tauri::AppHandle, message: &str) {
    let _ = app.notification().builder().title("shrt").body(message).show();
}

// Sube en segundo plano. La llamada puede tardar por la compresión del video.
fn upload_background(app: tauri::AppHandle, body: Vec<u8>) {
    thread::spawn(move || {
        let base = app.state::<AppState>().config.lock().unwrap().base.clone();
        match upload(&base, body) {
            Ok(mut item) => {
                if item.status == "processing" {
                    item.status = wait_ready(&base, &item.code);
                }
                if item.status == "ready" {
                    remember_media(&app, item);
                } else {
                    notify_error(&app, "No se pudo procesar el video");
                }
            }
            Err(e) => notify_error(&app, &e),
        }
    });
}

fn capture_dirs() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    roots.extend(dirs::picture_dir());
    roots.extend(dirs::video_dir());
    roots.extend(dirs::home_dir());
    let names = ["Screenshots", "Capturas de pantalla", "Videocapturas de pantalla", "Screencasts", "Captures", "Capturas"];
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for root in roots {
        for name in names {
            let p = root.join(name);
            if p.is_dir() && seen.insert(p.clone()) {
                out.push(p);
            }
        }
    }
    out
}

fn is_media_file(p: &Path) -> bool {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.starts_with('.') || name.ends_with(".part") {
        return false;
    }
    matches!(
        p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "mp4" | "webm" | "mkv" | "mov")
    )
}

fn is_image_file(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif")
    )
}

// Solo sube archivos nacidos desde que la opción está activa, y cuando ya dejaron de crecer.
fn capture_loop(app: tauri::AppHandle) {
    let mut floor = std::time::SystemTime::now();
    let mut done: HashSet<PathBuf> = HashSet::new();
    let mut growing: HashMap<PathBuf, (u64, u32)> = HashMap::new();
    loop {
        thread::sleep(Duration::from_millis(1500));
        let on = app.state::<AppState>().config.lock().unwrap().screenshots;
        if !on {
            floor = std::time::SystemTime::now();
            growing.clear();
            continue;
        }
        for dir in capture_dirs() {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if done.contains(&path) || !is_media_file(&path) {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                if meta.modified().map(|m| m < floor).unwrap_or(true) || meta.len() == 0 {
                    continue;
                }
                let slot = growing.entry(path.clone()).or_insert((meta.len(), 0));
                if slot.0 != meta.len() {
                    *slot = (meta.len(), 0);
                    continue;
                }
                slot.1 += 1;
                if slot.1 < 2 {
                    continue;
                }
                growing.remove(&path);
                done.insert(path.clone());
                if meta.len() > MAX_MEDIA_BYTES {
                    notify_error(&app, "El archivo pesa más de 95 MB y no se subió");
                    continue;
                }
                if is_image_file(&path) {
                    let t = now_secs();
                    if t.saturating_sub(LAST_IMAGE.load(Ordering::SeqCst)) < DUPLICATE_WINDOW_SECS {
                        continue;
                    }
                    LAST_IMAGE.store(t, Ordering::SeqCst);
                }
                if let Ok(body) = std::fs::read(&path) {
                    upload_background(app.clone(), body);
                }
            }
        }
    }
}

fn encode_png(img: &arboard::ImageData) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, img.width as u32, img.height as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        enc.write_header().ok()?.write_image_data(&img.bytes).ok()?;
    }
    Some(out)
}

fn image_hash(img: &arboard::ImageData) -> u64 {
    let mut h = DefaultHasher::new();
    img.width.hash(&mut h);
    img.height.hash(&mut h);
    img.bytes.hash(&mut h);
    h.finish()
}

#[derive(Deserialize)]
struct CreateResp {
    short_url: Option<String>,
    code: Option<String>,
}

fn shorten(base: &str, token: &str, url: &str) -> Result<String, String> {
    let b = base.trim_end_matches('/');
    let resp = reqwest::blocking::Client::new()
        .post(format!("{b}/api/links"))
        .header("authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "url": url }))
        .timeout(Duration::from_secs(12))
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let cr: CreateResp = resp.json().map_err(|e| e.to_string())?;
    cr.short_url
        .or_else(|| cr.code.map(|c| format!("{b}/{c}")))
        .ok_or_else(|| "respuesta sin short_url".into())
}

// ---------- comandos para el frontend ----------
#[tauri::command]
fn get_config(state: tauri::State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(_app: tauri::AppHandle, state: tauri::State<AppState>, config: Config) {
    let mut c = state.config.lock().unwrap();
    *c = config;
    save_config_file(&c);
    #[cfg(windows)]
    apply_autostart(&_app, c.autostart);
}

#[cfg(windows)]
fn apply_autostart(app: &tauri::AppHandle, on: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let _ = if on { manager.enable() } else { manager.disable() };
}

#[tauri::command]
fn get_history(state: tauri::State<AppState>) -> Vec<HistItem> {
    state.history.lock().unwrap().iter().rev().take(50).cloned().collect()
}

#[tauri::command(async)]
fn shorten_now(app: tauri::AppHandle, text: String) -> Result<String, String> {
    let cfg = app.state::<AppState>().config.lock().unwrap().clone();
    if cfg.token.is_empty() {
        return Err("Configura el admin token primero".into());
    }
    let short = shorten(&cfg.base, &cfg.token, text.trim())?;
    record(&app, &text, &short, &cfg);
    Ok(short)
}

#[tauri::command]
fn get_media(state: tauri::State<AppState>) -> Vec<MediaItem> {
    state.media.lock().unwrap().clone()
}

#[tauri::command(async)]
fn media_done(app: tauri::AppHandle, item: MediaItem) {
    remember_media(&app, item);
}

#[tauri::command]
fn forget_media(state: tauri::State<AppState>, code: String) {
    let mut items = state.media.lock().unwrap();
    items.retain(|i| i.code != code);
    save_media(&items);
}

#[tauri::command(async)]
fn copy_text(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn platform() -> &'static str {
    std::env::consts::OS
}

#[tauri::command(async)]
fn start_capture() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("ms-screenclip:")
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let dir = dirs::picture_dir()
            .or_else(dirs::home_dir)
            .ok_or("No encontré la carpeta de imágenes")?
            .join("Capturas de pantalla");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = dir.join(format!("shrt_{}.png", now_secs()));
        std::process::Command::new("spectacle")
            .args(["-r", "-b", "-n", "-o"])
            .arg(file)
            .spawn()
            .map_err(|_| "Spectacle no está instalado".to_string())?;
        Ok(())
    }
}

#[tauri::command(async)]
fn start_record(mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "r" | "s" | "w") {
        return Err("Modo inválido".into());
    }
    std::process::Command::new("spectacle")
        .args(["-R", &mode])
        .spawn()
        .map_err(|_| "Spectacle no está instalado".to_string())?;
    Ok(())
}

#[tauri::command(async)]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("URL inválida".into());
    }
    #[cfg(windows)]
    let mut command = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", &url]);
        c
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn close_flash(window: tauri::WebviewWindow) {
    let _ = window.close();
}

// Resumen de links desde el API (code, target, clicks…) para mostrar en la ventana.
#[tauri::command(async)]
fn get_links(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let cfg = app.state::<AppState>().config.lock().unwrap().clone();
    if cfg.token.is_empty() {
        return Err("Configura el admin token primero".into());
    }
    let b = cfg.base.trim_end_matches('/');
    let resp = reqwest::blocking::Client::new()
        .get(format!("{b}/api/links"))
        .header("authorization", format!("Bearer {}", cfg.token))
        .timeout(Duration::from_secs(10))
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json::<serde_json::Value>().map_err(|e| e.to_string())
}

// Persiste, reemplaza el portapapeles, notifica, destella y emite evento.
fn record(app: &tauri::AppHandle, original: &str, short: &str, cfg: &Config) {
    let item = HistItem { original: original.trim().to_string(), short: short.to_string(), ts: now_secs() };
    app.state::<AppState>().history.lock().unwrap().push(item.clone());

    if cfg.replace_clipboard {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let _ = cb.set_text(short.to_string());
        }
    }
    if cfg.notify {
        let _ = app.notification().builder().title("Link acortado ✓").body(short).show();
    }
    if cfg.flash {
        flash_cursor(app);
    }
    let _ = app.emit("shortened", item);
}

// Muestra y enfoca la ventana principal (desde el tray).
fn reveal(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

static FLASH_ID: AtomicUsize = AtomicUsize::new(0);

// Ventana frameless transparente que pulsa junto al cursor y se autocierra.
fn flash_cursor(app: &tauri::AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let pos = app.cursor_position().ok();
        let id = FLASH_ID.fetch_add(1, Ordering::SeqCst);
        let label = format!("flash-{id}");
        let size = 160.0_f64;

        let mut b = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("flash.html".into()))
            .title("flash")
            .inner_size(size, size)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .shadow(false);
        b = match pos {
            Some(p) => b.position(p.x - size / 2.0, p.y - size / 2.0),
            None => b.center(),
        };
        if let Ok(w) = b.build() {
            // respaldo: cerrar aunque el JS no corra
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(950));
                let _ = w.close();
            });
        }
    });
}

fn watcher_loop(app: tauri::AppHandle) {
    // Puede fallar al inicio de sesión: se reintenta en vez de quedar muerto sin avisar.
    let mut clipboard = loop {
        match arboard::Clipboard::new() {
            Ok(c) => break c,
            Err(_) => thread::sleep(Duration::from_secs(5)),
        }
    };
    let mut last = String::new();
    // La imagen que ya estaba copiada al abrir la app no se sube.
    let mut last_image = clipboard.get_image().ok().map(|i| image_hash(&i)).unwrap_or(0);
    loop {
        thread::sleep(Duration::from_millis(800));
        let cfg = app.state::<AppState>().config.lock().unwrap().clone();
        let text = match clipboard.get_text() {
            Ok(t) => t,
            Err(_) => {
                if !cfg.clip_images {
                    continue;
                }
                let Ok(img) = clipboard.get_image() else { continue };
                let hash = image_hash(&img);
                if hash == last_image {
                    continue;
                }
                last_image = hash;
                let t = now_secs();
                if t.saturating_sub(LAST_IMAGE.load(Ordering::SeqCst)) < DUPLICATE_WINDOW_SECS {
                    continue;
                }
                LAST_IMAGE.store(t, Ordering::SeqCst);
                if let Some(body) = encode_png(&img) {
                    upload_background(app.clone(), body);
                }
                continue;
            }
        };
        if !cfg.enabled || cfg.token.is_empty() {
            continue;
        }
        if text == last || text.is_empty() {
            continue;
        }
        last = text.clone();
        if !is_shortenable(&text, &cfg.base) {
            continue;
        }
        match shorten(&cfg.base, &cfg.token, text.trim()) {
            Ok(short) => {
                last = short.clone(); // no re-procesar lo que acabamos de poner
                record(&app, &text, &short, &cfg);
            }
            Err(e) => {
                let _ = app.emit("shorten_error", e);
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            config: Mutex::new(load_config()),
            history: Mutex::new(Vec::new()),
            media: Mutex::new(load_media()),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_history,
            get_links,
            shorten_now,
            get_media,
            media_done,
            forget_media,
            copy_text,
            platform,
            start_capture,
            start_record,
            open_url,
            close_flash
        ])
        .setup(|app| {
            #[cfg(windows)]
            {
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    Some(vec!["--minimized"]),
                ))?;
                let on = app.state::<AppState>().config.lock().unwrap().autostart;
                apply_autostart(app.handle(), on);
                if std::env::args().any(|a| a == "--minimized") {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            }
            // --- Tray (estilo Telegram): vive en la barra, click reabre la ventana ---
            let show = MenuItem::with_id(app, "show", "Abrir shrt", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("shrt")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => reveal(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal(tray.app_handle());
                    }
                })
                .build(app)?;

            // Cerrar la ventana = ocultar a la bandeja (no salir).
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            let handle = app.handle().clone();
            thread::spawn(move || watcher_loop(handle));
            let handle = app.handle().clone();
            thread::spawn(move || capture_loop(handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar shrt-clipper");
}
