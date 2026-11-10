// Puente opcional con Tauri. En la web (navegador) isTauri=false y todo cae al
// comportamiento normal (same-origin + localStorage). En la app de escritorio
// usamos los comandos Rust (config con token) y eventos.
const T: any = typeof window !== "undefined" ? (window as any).__TAURI__ : undefined;

export const isTauri = !!T;

export const invoke: (cmd: string, args?: any) => Promise<any> = isTauri
  ? T.core.invoke
  : async () => {
      throw new Error("no-tauri");
    };

export const listen: (event: string, cb: (e: any) => void) => Promise<() => void> = isTauri
  ? T.event.listen
  : async () => () => {};

export interface ClipperConfig {
  base: string;
  token: string;
  enabled: boolean;
  replace_clipboard: boolean;
  flash: boolean;
  notify: boolean;
  screenshots: boolean;
  clip_images: boolean;
  autostart: boolean;
  onboarded: boolean;
}
