import { createClient } from "@supabase/supabase-js";

// Cliente propio para las rutas de servidor: mismas credenciales que usa el
// resto de la app (no hay clave de servicio distinta), así que las políticas
// RLS de las tablas webauthn_* deben ser tan permisivas como las demás.
export const supabaseServidor = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type TipoCredencial = "admin" | "piloto" | "coordinador";

export function datosOrigenYRpId(request: Request) {
  const host = request.headers.get("host") ?? "localhost";
  const hostname = host.split(":")[0];
  const proto = request.headers.get("x-forwarded-proto") ?? (hostname === "localhost" ? "http" : "https");
  return { origin: `${proto}://${host}`, rpID: hostname };
}

// Un desafío vencido (más de 5 minutos) no se acepta más, por si quedó
// abandonado a medias.
export function desafioVencido(creadoEn: string): boolean {
  return Date.now() - new Date(creadoEn).getTime() > 5 * 60 * 1000;
}

export function validarAmbito(tipo: TipoCredencial, rutaId?: string | null, busId?: string | null) {
  if (tipo === "piloto" && !busId) return "Falta el bus para una credencial de piloto.";
  if (tipo === "coordinador" && !rutaId) return "Falta la ruta para una credencial de coordinador.";
  return null;
}
