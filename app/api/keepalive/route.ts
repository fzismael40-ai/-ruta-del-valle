import { supabase } from "../../supabaseClient";

// Ping programado (ver vercel.json) para que Supabase no pause el proyecto
// free por inactividad — un proyecto pausado deja de servir paradas, buses
// y mapa hasta que alguien entra al dashboard a reactivarlo a mano.
export async function GET() {
  const { error } = await supabase.from("paradas").select("id", { head: true, count: "exact" }).limit(1);
  return Response.json({ ok: !error, error: error?.message ?? null });
}
