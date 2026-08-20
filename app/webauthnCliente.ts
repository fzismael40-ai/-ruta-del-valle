import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

type Ambito = { tipo: "admin" | "piloto" | "coordinador"; rutaId?: string; busId?: string };

export function soportaHuellaOFace(): boolean {
  return typeof window !== "undefined" && browserSupportsWebAuthn();
}

export async function existeHuella(ambito: Ambito): Promise<boolean> {
  try {
    const res = await fetch("/api/webauthn/existe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ambito) });
    const datos = await res.json();
    return !!datos.existe;
  } catch {
    return false;
  }
}

async function pedirJSON(url: string, cuerpo: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const datos = await res.json();
  if (!res.ok) throw new Error(datos.error ?? "Error de red");
  return datos;
}

// Registra este dispositivo (huella o Face ID) para el ámbito dado. Se llama
// justo después de que la persona entró con la clave normal.
export async function registrarHuella(ambito: Ambito, etiqueta?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { opciones, desafioId } = await pedirJSON("/api/webauthn/registro-opciones", ambito);
    const respuesta = await startRegistration({ optionsJSON: opciones });
    await pedirJSON("/api/webauthn/registro-verificar", { ...ambito, desafioId, respuesta, etiqueta });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo activar." };
  }
}

// Intenta entrar con huella/Face ID. Si el ámbito no tiene ninguna huella
// registrada todavía, devuelve sinCredencial:true sin mostrar ningún error
// (para que la pantalla simplemente no ofrezca el botón).
export async function entrarConHuella(ambito: Ambito): Promise<{ ok: boolean; sinCredencial?: boolean; error?: string }> {
  try {
    const { opciones, desafioId } = await pedirJSON("/api/webauthn/login-opciones", ambito);
    const respuesta = await startAuthentication({ optionsJSON: opciones });
    await pedirJSON("/api/webauthn/login-verificar", { ...ambito, desafioId, respuesta });
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === "sin-credencial") return { ok: false, sinCredencial: true };
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo entrar." };
  }
}
