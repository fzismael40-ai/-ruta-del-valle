"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../supabaseClient";

type Bus = {
  id: string;
  nombre: string;
  ocupacion_actual: number;
  capacidad_total: number;
  parada_orden: number;
  sentido: "ida" | "vuelta";
};

type Parada = {
  id: string;
  nombre: string;
  orden: number | null;
  orden_vuelta: number | null;
  ruta_id: string | null;
};

function estadoDireccion(busesDireccion: Bus[], ordenParada: number | null) {
  if (ordenParada === null) return null;
  const enCamino = busesDireccion
    .filter((b) => b.parada_orden <= ordenParada)
    .sort((a, b) => b.parada_orden - a.parada_orden);
  const yaPasaron = busesDireccion.some((b) => b.parada_orden > ordenParada);
  const proximo = enCamino[0] ?? null;
  return {
    proximo,
    distancia: proximo ? ordenParada - proximo.parada_orden : null,
    yaPasaron,
  };
}

const VENTANA_ESPERA_MIN = 30;

export default function ParadaStatus({ id }: { id: string }) {
  const [parada, setParada] = useState<Parada | null | "not-found">(null);
  const [rutaSlug, setRutaSlug] = useState<string | null>(null);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [checkinsDisponibles, setCheckinsDisponibles] = useState(true);
  const [conteo, setConteo] = useState<{ ida: number; vuelta: number }>({ ida: 0, vuelta: 0 });
  // Empieza sin marcar en ambos lados (servidor y cliente) para evitar un
  // desajuste de hidratación; el useEffect de abajo confirma leyendo
  // localStorage solo en el navegador, después del primer render.
  const [yaMarcado, setYaMarcado] = useState<{ ida: boolean; vuelta: boolean }>({ ida: false, vuelta: false });
  const [enviando, setEnviando] = useState<"ida" | "vuelta" | null>(null);

  useEffect(() => {
    const hoy = new Date().toDateString();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setYaMarcado({
      ida: localStorage.getItem(`checkin-${id}-ida`) === hoy,
      vuelta: localStorage.getItem(`checkin-${id}-vuelta`) === hoy,
    });
  }, [id]);

  useEffect(() => {
    const fetchParada = async () => {
      const { data } = await supabase.from("paradas").select("*").eq("id", id).maybeSingle();
      setParada(data ?? "not-found");
      if (data?.ruta_id) {
        const { data: ruta } = await supabase.from("rutas").select("slug").eq("id", data.ruta_id).maybeSingle();
        setRutaSlug(ruta?.slug ?? null);
      }
    };
    fetchParada();
  }, [id]);

  useEffect(() => {
    const fetchConteo = async () => {
      const desde = new Date(Date.now() - VENTANA_ESPERA_MIN * 60000).toISOString();
      const { data, error } = await supabase
        .from("checkins")
        .select("sentido")
        .eq("parada_id", id)
        .gte("created_at", desde);
      if (error) {
        setCheckinsDisponibles(false);
        return;
      }
      setConteo({
        ida: data.filter((c) => c.sentido === "ida").length,
        vuelta: data.filter((c) => c.sentido === "vuelta").length,
      });
    };
    fetchConteo();

    const channel = supabase
      .channel(`checkins-${id}-realtime`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "checkins", filter: `parada_id=eq.${id}` }, () => fetchConteo())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const marcarEspera = async (sentido: "ida" | "vuelta") => {
    setEnviando(sentido);
    const { error } = await supabase.from("checkins").insert({ parada_id: id, sentido });
    setEnviando(null);
    if (error) return;
    localStorage.setItem(`checkin-${id}-${sentido}`, new Date().toDateString());
    setYaMarcado((prev) => ({ ...prev, [sentido]: true }));
  };

  useEffect(() => {
    if (!parada || parada === "not-found" || !parada.ruta_id) return;
    const rutaId = parada.ruta_id;
    const fetchBuses = async () => {
      const { data } = await supabase
        .from("buses")
        .select("id,nombre,ocupacion_actual,capacidad_total,parada_orden,sentido")
        .eq("ruta_id", rutaId)
        .order("nombre");
      if (data) setBuses(data as Bus[]);
    };
    fetchBuses();

    const channel = supabase
      .channel(`parada-${id}-realtime`)
      .on("postgres_changes", { event: "*", schema: "public", table: "buses", filter: `ruta_id=eq.${rutaId}` }, () => fetchBuses())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, parada]);

  if (parada === "not-found") {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center px-6 text-center">
        <div>
          <p className="font-display text-2xl text-forest mb-3">Parada no encontrada</p>
          <Link href="/" className="text-sm text-terracotta hover:underline">Ver todas las rutas</Link>
        </div>
      </main>
    );
  }

  if (!parada) {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center px-6 text-center">
        <p className="text-sm text-forest/50">Cargando parada...</p>
      </main>
    );
  }

  const subiendo = estadoDireccion(buses.filter((b) => b.sentido === "ida"), parada.orden);
  const bajando = estadoDireccion(buses.filter((b) => b.sentido === "vuelta"), parada.orden_vuelta);

  const bloques = [
    { titulo: "Subiendo hacia Hotel Valle Grande", sentido: "ida" as const, estado: subiendo, activo: parada.orden !== null },
    { titulo: "Bajando hacia Av. 19", sentido: "vuelta" as const, estado: bajando, activo: parada.orden_vuelta !== null },
  ].filter((b) => b.activo);

  return (
    <main className="min-h-screen bg-cream px-6 py-10">
      <div className="max-w-sm mx-auto">
        <Link href={rutaSlug ? `/r/${rutaSlug}` : "/"} className="text-xs text-forest/50 hover:text-forest transition">&larr; Volver</Link>

        <p className="text-terracotta text-xs font-semibold tracking-widest uppercase mt-4 mb-2">Estado de esta parada</p>
        <h1 className="font-display text-3xl text-forest mb-8">{parada.nombre}</h1>

        <div className="space-y-4">
          {bloques.map((b) => (
            <div key={b.titulo} className="bg-paper border border-forest/10 rounded-2xl p-5 shadow-sm">
              <p className="text-xs text-forest/50 mb-3">{b.titulo}</p>
              {b.estado?.proximo ? (
                <>
                  <p className="font-display text-lg text-forest mb-1">
                    {b.estado.distancia === 0 ? "El bus está aquí" : `A ${b.estado.distancia} parada${b.estado.distancia === 1 ? "" : "s"} de aquí`}
                  </p>
                  <p className="text-sm text-forest/60">
                    {b.estado.proximo.nombre} · {b.estado.proximo.ocupacion_actual}/{b.estado.proximo.capacidad_total} cupos
                  </p>
                </>
              ) : b.estado?.yaPasaron ? (
                <p className="text-sm text-forest/60">El último bus ya pasó por aquí. Puede venir otro más tarde.</p>
              ) : (
                <p className="text-sm text-forest/40">No hay unidades circulando en este sentido ahora.</p>
              )}

              {checkinsDisponibles && (
                <div className="mt-4 pt-3 border-t border-forest/10">
                  {yaMarcado[b.sentido] ? (
                    <p className="text-xs text-teal-dark font-medium">
                      Ya te contamos esperando aquí{conteo[b.sentido] > 1 ? ` · ${conteo[b.sentido]} personas en total` : ""}.
                    </p>
                  ) : (
                    <button
                      onClick={() => marcarEspera(b.sentido)}
                      disabled={enviando === b.sentido}
                      className="w-full py-2 rounded-full border border-forest/20 text-forest text-xs font-medium hover:bg-forest/5 transition disabled:opacity-50"
                    >
                      {enviando === b.sentido
                        ? "Marcando..."
                        : conteo[b.sentido] > 0
                        ? `Voy a subir aquí · ${conteo[b.sentido]} esperando`
                        : "Voy a subir aquí"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-forest/40 text-center mt-8">Actualiza en tiempo real · vuelve a escanear cuando quieras</p>
      </div>
    </main>
  );
}
