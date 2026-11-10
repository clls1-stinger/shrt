import { useState, useEffect } from "preact/hooks";
import { getToken, clearToken, setTauriCreds } from "./api";
import { isTauri, invoke } from "./tauri";
import { Login } from "./components/Login";
import { Overview } from "./components/Overview";
import { LinksList } from "./components/LinksList";
import { CreateLink } from "./components/CreateLink";
import { LinkStats } from "./components/LinkStats";
import { Media } from "./components/Media";
import { Settings } from "./components/Settings";

type View =
  | { name: "media" } | { name: "overview" } | { name: "links" }
  | { name: "stats"; code: string } | { name: "settings" } | { name: "login" };

export function App() {
  const [ready, setReady] = useState(!isTauri);
  const [authed, setAuthed] = useState(!isTauri && !!getToken());
  const [view, setView] = useState<View>({ name: "media" });
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ m: string; err: boolean } | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!isTauri) return;
    invoke("get_config")
      .then((c: any) => { setTauriCreds(c.base, c.token); setAuthed(!!c.token); })
      .finally(() => setReady(true));
  }, []);

  function flash(m: string, err = false) {
    setToast({ m, err });
    setTimeout(() => setToast(null), err ? 4500 : 2200);
  }

  if (!ready) return <div class="login-wrap"><span class="spin" /></div>;

  const openStats = (code: string) => setView({ name: "stats", code });
  const onLinks = view.name === "links" || view.name === "stats";
  const tab = (active: boolean, label: string, next: View) => (
    <button class={`tab ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setView(next)}>{label}</button>
  );

  function logout() {
    clearToken();
    setAuthed(false);
    setView({ name: "media" });
  }

  return (
    <div class="shell">
      <header class="topbar">
        <div class="logo"><span class="dot">🔗</span> shrt</div>
        <div class="spacer" />
        <nav class="tabs" aria-label="Secciones">
          {tab(view.name === "media", "Capturas", { name: "media" })}
          {authed && tab(onLinks, "Links", { name: "links" })}
          {authed && tab(view.name === "overview", "Resumen", { name: "overview" })}
          {isTauri && tab(view.name === "settings", "Ajustes", { name: "settings" })}
        </nav>
        {!isTauri && (authed
          ? <button class="btn ghost sm" onClick={logout}>Salir</button>
          : <button class="btn ghost sm" onClick={() => setView({ name: "login" })}>Entrar</button>)}
      </header>

      <main>
        {view.name === "media" && <Media toast={flash} />}
        {view.name === "login" && <Login onOk={() => { setAuthed(true); setView({ name: "links" }); }} />}
        {view.name === "overview" && <Overview key={refresh} onOpen={openStats} />}
        {view.name === "links" && <LinksList key={refresh} onOpen={openStats} onCreate={() => setCreating(true)} toast={flash} />}
        {view.name === "stats" && <LinkStats code={view.code} onBack={() => setView({ name: "links" })} toast={flash} />}
        {view.name === "settings" && <Settings toast={flash} onAuth={setAuthed} />}
      </main>

      {creating && (
        <CreateLink onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); setRefresh((r) => r + 1); setView({ name: "links" }); }} toast={flash} />
      )}
      {toast && <div class={`toast ${toast.err ? "err" : ""}`} role="status">{toast.m}</div>}
    </div>
  );
}
