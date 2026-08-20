import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { supabaseServidor, datosOrigenYRpId, type TipoCredencial } from "../_compartido";

export async function POST(request: Request) {
  const { tipo, rutaId, busId, desafioId, respuesta } = (await request.json()) as {
    tipo: TipoCredencial;
    rutaId?: string;
    busId?: string;
    desafioId: string;
    respuesta: AuthenticationResponseJSON;
  };

  const { data: fila } = await supabaseServidor.from("webauthn_desafios").select("*").eq("id", desafioId).maybeSingle();
  if (fila) await supabaseServidor.from("webauthn_desafios").delete().eq("id", desafioId);
  if (!fila) return Response.json({ error: "Desafío no encontrado o ya usado." }, { status: 400 });

  let q = supabaseServidor.from("webauthn_credenciales").select("*").eq("tipo", tipo).eq("credential_id", respuesta.id);
  if (rutaId) q = q.eq("ruta_id", rutaId);
  if (busId) q = q.eq("bus_id", busId);
  const { data: credencial } = await q.maybeSingle();

  if (!credencial) return Response.json({ error: "Credencial no reconocida." }, { status: 400 });

  const { origin, rpID } = datosOrigenYRpId(request);

  let verificacion;
  try {
    verificacion = await verifyAuthenticationResponse({
      response: respuesta,
      expectedChallenge: fila.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credencial.credential_id,
        publicKey: isoBase64URL.toBuffer(credencial.public_key),
        counter: credencial.counter,
      },
    });
  } catch {
    return Response.json({ error: "No se pudo verificar." }, { status: 400 });
  }

  if (!verificacion.verified) {
    return Response.json({ error: "No verificado." }, { status: 400 });
  }

  await supabaseServidor
    .from("webauthn_credenciales")
    .update({ counter: verificacion.authenticationInfo.newCounter })
    .eq("id", credencial.id);

  return Response.json({ ok: true });
}
