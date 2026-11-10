#!/usr/bin/env bash
# Lanza shrt-clipper con el entorno Nix correcto (webkitgtk etc. en runtime).
# Usado por el autostart de KDE. Resuelve nixpkgs dinámicamente (sobrevive updates).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$HERE/src-tauri/target/release/shrt-clipper"

if [ ! -x "$BIN" ]; then
  echo "binario no compilado: $BIN — corre el build primero" >&2
  exit 1
fi

# El autostart puede arrancar sin el entorno gráfico. Sin WAYLAND_DISPLAY, arboard
# no abre el portapapeles y el hilo vigilante termina sin avisar.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [ -z "${WAYLAND_DISPLAY:-}" ]; then
  for _ in $(seq 1 30); do
    WAYLAND_DISPLAY="$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name 'wayland-*' -printf '%f\n' | head -1)"
    [ -n "$WAYLAND_DISPLAY" ] && break
    sleep 1
  done
  export WAYLAND_DISPLAY
fi

# nixpkgs del sistema (registry) con fallback al pin conocido
NP="$(nix --extra-experimental-features 'nix-command flakes' eval --raw nixpkgs#path 2>/dev/null || true)"
[ -z "$NP" ] && NP="/nix/store/77dbgds155bbz3vd3qywq1sii07i5ljs-source"
export NIX_PATH="nixpkgs=$NP"

# nix-shell aporta LD_LIBRARY_PATH con webkit2gtk/gtk3 para el runtime del webview
exec nix-shell "$HERE/shell.nix" --run "exec '$BIN'"
