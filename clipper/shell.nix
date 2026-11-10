# Entorno de build de Tauri v2 en NixOS (P46: declarativo, sin instalar global).
# Uso:  nix-shell    →  luego:  npm install && npm run tauri dev
{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  nativeBuildInputs = with pkgs; [
    pkg-config
    rustc
    cargo
    nodejs_22
    gobject-introspection
    cargo-tauri
  ];
  buildInputs = with pkgs; [
    webkitgtk_4_1
    gtk3
    libsoup_3
    libayatana-appindicator   # tray icon (dlopen en runtime)
    openssl
    glib
    cairo
    pango
    gdk-pixbuf
    librsvg
    # clipboard (arboard) + Wayland/X11
    libxkbcommon
    wayland
    xorg.libxcb
    xorg.libX11
  ];
  # webkit necesita esto para el Webview en algunos setups Wayland/Plasma
  shellHook = ''
    export WEBKIT_DISABLE_COMPOSITING_MODE=1
    export GDK_BACKEND=''${GDK_BACKEND:-wayland,x11}
    # libappindicator (tray) se carga con dlopen en runtime → debe estar en LD_LIBRARY_PATH
    export LD_LIBRARY_PATH="${pkgs.libayatana-appindicator}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    echo "shrt-clipper dev shell · cargo $(cargo --version)"
  '';
}
