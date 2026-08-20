import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { RegistrationResponseJSON } from "@simplewebauthn/browser";
import { supabaseServidor, datosOrigenYRpId, type TipoCredencial } from "../_compartido";

export async function POST(request: Request) {
  const { tipo, rutaId, busId, desafioId, respuesta, etiqueta } = (await request.json()) as {
    tipo: TipoCredencial;
    rutaId?: string;
    busId?: string;
    desafioId: string;
    respuesta: RegistrationResponseJSON;
    etiqueta?: string;
  };

  const { data: fila } = await supabaseServidor.from("webauthn_desafios").select("*").eq("id", desafioId).maybeSingle();
  if (fila) await supabaseServidor.from("webauthn_desafios").delete().eq("id", desafioId);
  if (!fila) return Response.json({ error: "Desafío no encontrado o ya usado." }, { status: 400 });

  const { origin, rpID } = datosOrigenYRpId(request);

  let verificacion;
  try {
    verificacion = await verifyRegistrationResponse({
      response: respuesta,
      expectedChallenge: fila.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    return Response.json({ error: "No se pudo verificar el registro." }, { status: 400 });
  }

  if (!verificacion.verified) {
    return Response.json({ error: "Registro no verificado." }, { status: 400 });
  }

  const { credential } = verificacion.registrationInfo;
  const { error } = await supabaseServidor.from("webauthn_credenciales").insert({
    tipo,
    ruta_id: rutaId ?? null,
    bus_id: busId ?? null,
    credential_id: credential.id,
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    etiqueta: etiqueta ?? null,
  });

  if (error) return Response.json({ error: "No se pudo guardar la credencial. " + error.message }, { status: 500 });

  return Response.json({ ok: true });
}
