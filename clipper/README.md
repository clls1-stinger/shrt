# shrt-clipper 📋→🔗

App de escritorio (**Tauri v2 + Rust**) que:

1. **Vigila el portapapeles** en segundo plano (cada 800 ms).
2. Si lo copiado es **un solo link** (`http(s)://…`, y no es ya `shrt.emky.com.mx`), lo **acorta automáticamente** llamando a `POST /api/links` de tu servidor.
3. **Reemplaza** el contenido del portapapeles por el link corto (configurable) → al pegar, ya está acortado.
4. **Destella el cursor**: una ventana frameless transparente pulsa junto al puntero como señal de que ya quedó.
5. Notificación del sistema + historial de los últimos acortados.

Todo es configurable desde la ventana (servidor, admin token, y los toggles de cada comportamiento). La config se guarda en `~/.config/shrt-clipper/config.json`.

## Build en NixOS (P46)
```bash
cd clipper
nix-shell                 # trae webkitgtk_4_1, gtk3, rust, node, cargo-tauri…
npm install               # @tauri-apps/cli
npm run tauri icon src-tauri/icons/icon.png   # (opcional) genera el set completo de iconos
npm run dev               # ventana de desarrollo
npm run build             # binario + bundle (deb/appimage) en src-tauri/target/release
```

## Notas de plataforma
- **Clipboard**: vía `arboard`. En **Plasma Wayland** el polling funciona; si el portapapeles no se lee, abre el shell con `GDK_BACKEND=x11` (XWayland).
- **Flash del cursor**: posicionar una ventana en las coordenadas exactas del puntero funciona nativo en **X11**. En **Wayland** el compositor puede ignorar la posición absoluta y centrar el destello; en ese caso la **notificación** es la señal de respaldo (toggle "Notificación del sistema").
- El admin token es el mismo `ADMIN_TOKEN` del Worker (`shrt`).

## Flujo
```
copias un link  ─▶  watcher detecta URL  ─▶  POST /api/links  ─▶  short_url
                                                     │
                          ┌──────────────────────────┼───────────────────┐
                     reemplaza clipboard       destella cursor      notifica + historial
```
