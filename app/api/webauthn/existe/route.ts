import { supabaseServidor, type TipoCredencial } from "../_compartido";

// Solo dice si el ámbito ya tiene alguna huella/Face ID registrada, para que
// la pantalla decida si muestra el botón — no arranca ningún desafío.
export async function POST(request: Request) {
  const { tipo, rutaId, busId } = (await request.json()) as {
    tipo: TipoCredencial;
    rutaId?: string;
    busId?: string;
  };

  let q = supabaseServidor.from("webauthn_credenciales").select("id", { count: "exact", head: true }).eq("tipo", tipo);
  if (rutaId) q = q.eq("ruta_id", rutaId);
  if (busId) q = q.eq("bus_id", busId);
  const { count } = await q;

  return Response.json({ existe: (count ?? 0) > 0 });
}
