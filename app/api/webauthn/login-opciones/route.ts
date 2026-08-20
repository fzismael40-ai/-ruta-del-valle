import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { supabaseServidor, datosOrigenYRpId, type TipoCredencial } from "../_compartido";

export async function POST(request: Request) {
  const { tipo, rutaId, busId } = (await request.json()) as {
    tipo: TipoCredencial;
    rutaId?: string;
    busId?: string;
  };

  let q = supabaseServidor.from("webauthn_credenciales").select("credential_id").eq("tipo", tipo);
  if (rutaId) q = q.eq("ruta_id", rutaId);
  if (busId) q = q.eq("bus_id", busId);
  const { data: existentes } = await q;

  if (!existentes || existentes.length === 0) {
    return Response.json({ error: "sin-credencial" }, { status: 404 });
  }

  const { rpID } = datosOrigenYRpId(request);

  const opciones = await generateAuthenticationOptions({
    rpID,
    allowCredentials: existentes.map((c) => ({ id: c.credential_id })),
    userVerification: "required",
  });

  const { data: desafio, error: errDesafio } = await supabaseServidor
    .from("webauthn_desafios")
    .insert({ challenge: opciones.challenge, tipo, ruta_id: rutaId ?? null, bus_id: busId ?? null })
    .select("id")
    .single();

  if (errDesafio || !desafio) {
    return Response.json({ error: "No se pudo guardar el desafío." }, { status: 500 });
  }

  return Response.json({ opciones, desafioId: desafio.id });
}
