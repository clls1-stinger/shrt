import { useState } from "preact/hooks";
import { api, setToken } from "../api";

export function Login({ onOk }: { onOk: () => void }) {
  const [token, setTok] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setErr("");
    setToken(token.trim());
    try {
      await api.listLinks(); // valida el token
      onOk();
    } catch {
      setErr("Token inválido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="login-wrap">
      <form class="card login-card" onSubmit={submit}>
        <div class="logo" style="justify-content:center;font-size:28px;margin-bottom:8px">
          <span class="dot">🔗</span> shrt
        </div>
        <p class="muted" style="margin-top:0">Panel privado · acortador de links</p>
        <div class="field" style="text-align:left;margin-top:18px">
          <label>Admin token</label>
          <input class="input" type="password" value={token} autoFocus
            onInput={(e) => setTok((e.target as HTMLInputElement).value)}
            placeholder="••••••••••••••••" />
        </div>
        {err && <p style="color:var(--red);margin:0 0 12px">{err}</p>}
        <button class="btn primary" style="width:100%" disabled={busy}>
          {busy ? <span class="spin" /> : "Entrar"}
        </button>
      </form>
    </div>
  );
}
