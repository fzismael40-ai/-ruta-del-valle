import { generateRegistrationOptions } from "@simplewebauthn/server";
import { supabaseServidor, datosOrigenYRpId, validarAmbito, type TipoCredencial } from "../_compartido";

export async function POST(request: Request) {
  const { tipo, rutaId, busId } = (await request.json()) as {
    tipo: TipoCredencial;
    rutaId?: string;
    busId?: string;
  };

  const error = validarAmbito(tipo, rutaId, busId);
  if (error) return Response.json({ error }, { status: 400 });

  const { rpID } = datosOrigenYRpId(request);

  let q = supabaseServidor.from("webauthn_credenciales").select("credential_id").eq("tipo", tipo);
  if (rutaId) q = q.eq("ruta_id", rutaId);
  if (busId) q = q.eq("bus_id", busId);
  const { data: existentes } = await q;

  const opciones = await generateRegistrationOptions({
    rpName: "Next Route",
    rpID,
    userName: busId ?? rutaId ?? tipo,
    attestationType: "none",
    excludeCredentials: (existentes ?? []).map((c) => ({ id: c.credential_id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required", authenticatorAttachment: "platform" },
  });

  const { data: desafio, error: errDesafio } = await supabaseServidor
    .from("webauthn_desafios")
    .insert({ challenge: opciones.challenge, tipo, ruta_id: rutaId ?? null, bus_id: busId ?? null })
    .select("id")
    .single();

  if (errDesafio || !desafio) {
    return Response.json({ error: "No se pudo guardar el desafío. ¿Corriste el SQL de webauthn?" }, { status: 500 });
  }

  return Response.json({ opciones, desafioId: desafio.id });
}
