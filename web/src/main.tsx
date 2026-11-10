import { render } from "preact";
import { App } from "./app";
import styles from "./styles.css?inline";

// Inyectar el CSS por JS en vez de <link>: en el webview de Tauri (Linux /
// webkit2gtk) un <link rel="stylesheet" crossorigin href="/assets/…"> no se
// aplica (MIME estricto + CORS del protocolo tauri://). Como <style> siempre
// funciona, y en el navegador es idéntico.
const styleEl = document.createElement("style");
styleEl.textContent = styles;
document.head.appendChild(styleEl);

render(<App />, document.getElementById("app")!);
