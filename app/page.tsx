"use client";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { supabase } from "./supabaseClient";

const MapaRuta = dynamic(() => import("./MapaRuta"), { ssr: false });

type Bus = {
  id: string;
  nombre: string;
  ocupacion_actual: number;
  capacidad_total: number;
  latitud: number | null;
  longitud: number | null;
  parada_actual: string | null;
  parada_orden: number;
  necesita_refuerzo: boolean;
  sentido: "ida" | "vuelta";
  refuerzo_desde: string | null;
};

const CLAVE_PILOTO = "valle2026";

type Parada = {
  id: string;
  nombre: string;
  orden: number | null;
  orden_vuelta: number | null;
  latitud: number | null;
  longitud: number | null;
  ocupacion_tipica: number | null;
};

export default function Home() {
  const [role, setRole] = useState<"pasajero" | "piloto" | "coordinador">("pasajero");
  const [buses, setBuses] = useState<Bus[]>([]);
  const [paradas, setParadas] = useState<Parada[]>([]);
  const [ahora, setAhora] = useState(() => Date.now());
  const [busSeleccionadoId, setBusSeleccionadoId] = useState<string | null>(null);
  const [salidas, setSalidas] = useState<
    { id: string; nombre: string; sentido: "ida" | "vuelta"; at: number; gapMin: number | null }[]
  >([]);
  const prevBusesRef = useRef<Map<string, Bus>>(new Map());
  const lastSalidaRef = useRef<{ ida: number | null; vuelta: number | null }>({ ida: null, vuelta: null });
  const [demanda, setDemanda] = useState<{ ida: number; vuelta: number } | null>(null);
  const [pilotoDesbloqueado, setPilotoDesbloqueado] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("piloto-clave") === CLAVE_PILOTO
  );
  const [claveInput, setClaveInput] = useState("");
  const [claveError, setClaveError] = useState(false);
  const [ubicacionActiva, setUbicacionActiva] = useState(false);
  const [ubicacionError, setUbicacionError] = useState<string | null>(null);
  const ultimoEnvioUbicacionRef = useRef(0);

  const intentarDesbloquearPiloto = () => {
    if (claveInput === CLAVE_PILOTO) {
      localStorage.setItem("piloto-clave", CLAVE_PILOTO);
      setPilotoDesbloqueado(true);
      setClaveError(false);
    } else {
      setClaveError(true);
    }
  };

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fetchParadas = async () => {
      const { data } = await supabase.from("paradas").select("*");
      if (data) setParadas(data as Parada[]);
    };
    fetchParadas();
  }, []);

  useEffect(() => {
    const fetchBuses = async () => {
      const { data } = await supabase.from("buses").select("*").order("nombre");
      if (!data) return;
      const nuevos = data as Bus[];
      const prevMap = prevBusesRef.current;

      if (prevMap.size > 0) {
        const eventosNuevos: typeof salidas = [];
        for (const b of nuevos) {
          const anterior = prevMap.get(b.id);
          // Una "salida" es cuando el bus reinicia ciclo: cambia de sentido y vuelve a la parada 1.
          if (anterior && anterior.sentido !== b.sentido && b.parada_orden === 1) {
            const ts = Date.now();
            const ultima = lastSalidaRef.current[b.sentido];
            const gapMin = ultima ? Math.round((ts - ultima) / 60000) : null;
            lastSalidaRef.current[b.sentido] = ts;
            eventosNuevos.push({ id: b.id, nombre: b.nombre, sentido: b.sentido, at: ts, gapMin });
          }
        }
        if (eventosNuevos.length > 0) {
          setSalidas((prev) => [...eventosNuevos, ...prev].slice(0, 8));
        }
      }

      prevBusesRef.current = new Map(nuevos.map((b) => [b.id, b]));
      setBuses(nuevos);
    };
    fetchBuses();

    const channel = supabase
      .channel("buses-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "buses" }, () => fetchBuses())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const fetchDemanda = async () => {
      const desde = new Date(Date.now() - 30 * 60000).toISOString();
      const { data, error } = await supabase.from("checkins").select("sentido").gte("created_at", desde);
      if (error) return; // la tabla todavía no existe o no hay permiso: se oculta el panel
      setDemanda({
        ida: data.filter((c) => c.sentido === "ida").length,
        vuelta: data.filter((c) => c.sentido === "vuelta").length,
      });
    };
    fetchDemanda();

    const channel = supabase
      .channel("checkins-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "checkins" }, () => fetchDemanda())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const paradasIda = paradas.filter((p) => p.orden !== null).sort((a, b) => a.orden! - b.orden!);
  const paradasVuelta = paradas.filter((p) => p.orden_vuelta !== null).sort((a, b) => a.orden_vuelta! - b.orden_vuelta!);

  const idBusEfectivo = busSeleccionadoId ?? buses[0]?.id ?? null;
  const miBus = buses.find((b) => b.id === idBusEfectivo) ?? buses[0];
  const listaActual = miBus?.sentido === "vuelta" ? paradasVuelta : paradasIda;
  const totalParadas = listaActual.length;
  const esVuelta = miBus?.sentido === "vuelta";
  const esFinalDeLista = miBus ? miBus.parada_orden >= totalParadas : false;

  // Ubicación real del piloto: mientras esté activa, actualiza la posición
  // del bus seleccionado en Supabase (máximo una escritura cada 5s).
  useEffect(() => {
    if (role !== "piloto" || !pilotoDesbloqueado || !miBus?.id || !navigator.geolocation) {
      return;
    }
    const busId = miBus.id;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUbicacionActiva(true);
        setUbicacionError(null);
        const ahoraTs = Date.now();
        if (ahoraTs - ultimoEnvioUbicacionRef.current < 5000) return;
        ultimoEnvioUbicacionRef.current = ahoraTs;
        supabase
          .from("buses")
          .update({
            latitud: pos.coords.latitude,
            longitud: pos.coords.longitude,
            updated_at: new Date().toISOString(),
          })
          .eq("id", busId);
      },
      (err) => {
        setUbicacionActiva(false);
        setUbicacionError(err.message);
      },
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 }
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [role, pilotoDesbloqueado, miBus?.id]);

  const minutosEsperando = (refuerzoDesde: string | null) => {
    if (!refuerzoDesde) return 0;
    return Math.floor((ahora - new Date(refuerzoDesde).getTime()) / 60000);
  };

  const CAPACIDAD_BUSETA = 17;
  const CAPACIDAD_BUS = 30;
  const recomendarUnidad = (esperando: number) => {
    if (esperando === 0) return null;
    if (esperando <= CAPACIDAD_BUSETA) return `buseta (${CAPACIDAD_BUSETA} puestos) alcanza`;
    if (esperando <= CAPACIDAD_BUS) return `bus grande (${CAPACIDAD_BUS} puestos)`;
    const unidades = Math.ceil(esperando / CAPACIDAD_BUS);
    return `${unidades} unidades — demanda alta`;
  };

  const bump = async (delta: number) => {
    if (!miBus) return;
    const nuevaOcupacion = Math.max(0, Math.min(miBus.capacidad_total, miBus.ocupacion_actual + delta));
    const lleno = nuevaOcupacion >= miBus.capacidad_total;

    let nuevoRefuerzoDesde = miBus.refuerzo_desde;
    if (lleno && !miBus.necesita_refuerzo) nuevoRefuerzoDesde = new Date().toISOString();
    if (!lleno) nuevoRefuerzoDesde = null;

    await supabase
      .from("buses")
      .update({
        ocupacion_actual: nuevaOcupacion,
        necesita_refuerzo: lleno,
        refuerzo_desde: nuevoRefuerzoDesde,
        updated_at: new Date().toISOString(),
      })
      .eq("id", miBus.id);
  };

  const avanzarParada = async () => {
    if (!miBus) return;
    const lista = miBus.sentido === "ida" ? paradasIda : paradasVuelta;
    const total = lista.length;
    if (total === 0) return;

    if (miBus.parada_orden >= total) {
      const nuevoSentido = miBus.sentido === "ida" ? "vuelta" : "ida";
      const nuevaLista = nuevoSentido === "ida" ? paradasIda : paradasVuelta;
      const primera = nuevaLista.find((p) => (nuevoSentido === "ida" ? p.orden : p.orden_vuelta) === 1);

      // El bus sale casi vacío desde Hotel Valle Grande; a veces lo abarca un
      // grupo moderado del hotel que baja a trabajar o estudiar. Se va llenando
      // en el camino y por eso el refuerzo se activa solo (ver bump()) cuando
      // llega a capacidad, no desde la salida.
      const saleDesdeElValle = nuevoSentido === "vuelta";

      await supabase
        .from("buses")
        .update({
          sentido: nuevoSentido,
          parada_orden: 1,
          parada_actual: primera?.nombre ?? miBus.parada_actual,
          ocupacion_actual: saleDesdeElValle ? 2 : 0,
          necesita_refuerzo: false,
          refuerzo_desde: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", miBus.id);
      return;
    }

    const siguienteOrden = miBus.parada_orden + 1;
    const siguienteParada = lista.find((p) => (miBus.sentido === "ida" ? p.orden : p.orden_vuelta) === siguienteOrden);
    if (!siguienteParada) return;

    await supabase
      .from("buses")
      .update({
        parada_orden: siguienteOrden,
        parada_actual: siguienteParada.nombre,
        updated_at: new Date().toISOString(),
      })
      .eq("id", miBus.id);
  };

  const marcarAtendido = async (busId: string) => {
    await supabase.from("buses").update({ necesita_refuerzo: false, refuerzo_desde: null }).eq("id", busId);
  };

  const textoBotonPiloto = esFinalDeLista
    ? esVuelta
      ? "Iniciar nueva ida (vía Milla) →"
      : "Iniciar retorno (vía Calle 1) ↺"
    : esVuelta
    ? "Siguiente parada (bajando) ↓"
    : "Siguiente parada (subiendo) ↑";

  // Coordenadas para el mapa
  const rutaIdaCoords: [number, number][] = paradasIda
    .filter((p) => p.latitud !== null && p.longitud !== null)
    .map((p) => [p.latitud as number, p.longitud as number]);

  const rutaVueltaCoords: [number, number][] = paradasVuelta
    .filter((p) => p.latitud !== null && p.longitud !== null)
    .map((p) => [p.latitud as number, p.longitud as number]);

  const paradasEnMapa = paradas
    .filter((p) => p.latitud !== null && p.longitud !== null)
    .map((p) => ({ id: p.id, nombre: p.nombre, lat: p.latitud as number, lng: p.longitud as number }));

  const busesEnMapa = buses
    .map((b) => {
      // Si el piloto tiene GPS activo, usamos su ubicación real; si no,
      // caemos a la posición aproximada de la parada donde está reportado.
      if (b.latitud !== null && b.longitud !== null) {
        return {
          id: b.id,
          nombre: b.nombre,
          sentido: b.sentido,
          necesita_refuerzo: b.necesita_refuerzo,
          lat: b.latitud,
          lng: b.longitud,
          ocupacion_actual: b.ocupacion_actual,
          capacidad_total: b.capacidad_total,
        };
      }
      const parada = paradas.find((p) => p.nombre === b.parada_actual);
      if (!parada || parada.latitud === null || parada.longitud === null) return null;
      return {
        id: b.id,
        nombre: b.nombre,
        sentido: b.sentido,
        necesita_refuerzo: b.necesita_refuerzo,
        lat: parada.latitud,
        lng: parada.longitud,
        ocupacion_actual: b.ocupacion_actual,
        capacidad_total: b.capacidad_total,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  return (
    <>
      <header className="sticky top-0 z-30 backdrop-blur border-b border-forest/10" style={{background:"rgba(246,241,231,0.9)"}}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-lg text-forest">Ruta del Valle</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6">
            <a href="#como-funciona" className="text-sm text-forest/70 hover:text-forest transition">Cómo funciona</a>
            <a href="#embarca" className="text-sm text-forest/70 hover:text-forest transition">En vivo</a>
          </nav>
          <a href="#embarca" className="text-sm font-medium px-4 py-2 rounded-full bg-forest text-white hover:bg-forest-dark transition">Ver la app</a>
        </div>
      </header>

      <section className="relative overflow-hidden bg-cream pt-20 pb-24">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <svg viewBox="0 0 1200 400" preserveAspectRatio="none" className="absolute bottom-0 left-0 w-full h-56">
            <polygon points="0,400 0,220 220,80 430,240 620,60 900,260 1090,120 1200,220 1200,400" fill="var(--color-mountain)" opacity="0.14" />
            <polygon points="0,400 0,280 260,150 520,300 760,140 1000,290 1200,180 1200,400" fill="var(--color-forest)" opacity="0.16" />
          </svg>
        </div>

        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <span className="inline-block text-xs font-semibold tracking-widest uppercase text-terracotta bg-terracotta/10 px-3 py-1 rounded-full mb-6">
            Ruta del Valle · El Playón, Mérida
          </span>
          <h1 className="font-display text-4xl sm:text-5xl text-forest leading-tight mb-6">
            El problema no es subir. Es que el bus <span className="text-terracotta">se llena a medio camino</span>.
          </h1>
          <p className="text-forest/70 text-lg mb-10 max-w-xl mx-auto">
            Cada unidad sale casi vacía desde Hotel Valle Grande —a veces con un grupo moderado del hotel que
            baja a trabajar o estudiar— pero se llena rápido en el camino, dejando sin cupo a los vecinos de
            las paradas más abajo en El Playón. Ruta del Valle muestra en tiempo real dónde va cada bus, para
            que quien espera en la bajada sepa qué esperar y los coordinadores puedan despachar refuerzos
            antes de que alguien se quede sin subir.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-14">
            <a href="#embarca" className="text-sm font-medium px-6 py-3 rounded-full bg-forest text-white hover:bg-forest-dark transition">
              Ver la app en vivo
            </a>
            <a href="#como-funciona" className="text-sm font-medium px-6 py-3 rounded-full border border-forest/20 text-forest hover:bg-forest/5 transition">
              Cómo funciona
            </a>
          </div>

          <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto">
            <div className="bg-paper border border-forest/10 rounded-2xl px-3 py-4 shadow-sm">
              <p className="font-display text-2xl text-forest">{paradas.length || "—"}</p>
              <p className="text-xs text-forest/50 mt-1">paradas en la ruta</p>
            </div>
            <div className="bg-paper border border-forest/10 rounded-2xl px-3 py-4 shadow-sm">
              <p className="font-display text-2xl text-forest">{buses.length || "—"}</p>
              <p className="text-xs text-forest/50 mt-1">buses activos</p>
            </div>
            <div className="bg-paper border border-teal/20 rounded-2xl px-3 py-4 shadow-sm">
              <p className="font-display text-2xl text-teal-dark flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal animate-pulse"></span>
                En vivo
              </p>
              <p className="text-xs text-forest/50 mt-1">datos en tiempo real</p>
            </div>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="scroll-mt-20 py-20 bg-paper">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-xl mx-auto text-center mb-14">
            <p className="text-terracotta text-xs font-semibold tracking-widest uppercase mb-3">Cómo funciona</p>
            <h2 className="font-display text-3xl text-forest mb-4">Un mismo dato, tres roles</h2>
            <p className="text-forest/60">
              La bajada —de Hotel Valle Grande a Av. 19— es el tramo crítico: cada unidad sale casi vacía
              pero se llena rápido, y son los vecinos de las paradas más abajo en El Playón quienes se quedan
              esperando. La subida sirve sobre todo a profesores,
              estudiantes y trabajadores que viven en el centro y suben hasta El Valle por trabajo o estudio.
              Un mismo dato de ocupación se traduce distinto según quién lo mire.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            <div className="feature-card bg-cream rounded-2xl p-6 border border-forest/10">
              <div className="w-11 h-11 rounded-xl bg-forest/10 flex items-center justify-center mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-forest)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                  <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
                </svg>
              </div>
              <h3 className="font-display text-lg text-forest mb-2">Pasajero</h3>
              <p className="text-sm text-forest/60">Antes de salir, revisa si tu bus ya viene lleno desde arriba o si todavía tiene cupo, y en qué parada va.</p>
            </div>

            <div className="feature-card bg-cream rounded-2xl p-6 border border-forest/10">
              <div className="w-11 h-11 rounded-xl bg-terracotta/10 flex items-center justify-center mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-terracotta)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="8" />
                  <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
                </svg>
              </div>
              <h3 className="font-display text-lg text-forest mb-2">Piloto</h3>
              <p className="text-sm text-forest/60">Con dos botones registra quién sube y baja, y avisa cuando el bus se llena.</p>
            </div>

            <div className="feature-card bg-cream rounded-2xl p-6 border border-forest/10">
              <div className="w-11 h-11 rounded-xl bg-mustard/20 flex items-center justify-center mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-mustard-dark)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z" />
                  <circle cx="12" cy="9.5" r="2.3" />
                </svg>
              </div>
              <h3 className="font-display text-lg text-forest mb-2">Coordinador</h3>
              <p className="text-sm text-forest/60">Ve cada salida desde Hotel Valle Grande, cuánto lleva esperando refuerzo, y despacha una unidad extra a tiempo.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="embarca" className="scroll-mt-20 bg-forest py-20">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-mustard text-xs text-center uppercase tracking-widest mb-3">Pruébala tú mismo</p>
          <h2 className="font-display text-3xl text-white text-center mb-10">Tres vistas, una sola ruta</h2>

          <div className="flex justify-center gap-2 mb-8">
            <button onClick={() => setRole("pasajero")} className={`role-btn px-4 py-2 rounded-full text-sm font-medium border border-white/20 text-white ${role==="pasajero" ? "active" : ""}`}>Pasajero</button>
            <button onClick={() => setRole("piloto")} className={`role-btn px-4 py-2 rounded-full text-sm font-medium border border-white/20 text-white ${role==="piloto" ? "active" : ""}`}>Piloto</button>
            <button onClick={() => setRole("coordinador")} className={`role-btn px-4 py-2 rounded-full text-sm font-medium border border-white/20 text-white ${role==="coordinador" ? "active" : ""}`}>Coordinador</button>
          </div>

          <div className="flex justify-center">
            <div className="phone p-4">

              <div className={`view ${role==="pasajero" ? "active" : ""}`}>
                {buses.length > 0 && (
                  <select
                    value={miBus?.id ?? ""}
                    onChange={(e) => setBusSeleccionadoId(e.target.value)}
                    className="w-full mb-3 text-xs font-medium text-forest bg-cream border border-forest/15 rounded-lg px-3 py-2"
                  >
                    {buses.map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre}</option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-forest/50 mb-2">
                  Parada: {miBus?.parada_actual ?? "..."} · {miBus?.sentido === "vuelta" ? "Bajando hacia Av. 19" : "Subiendo hacia el Valle"}
                </p>
                {miBus ? (
                  <>
                    <p className="font-display text-xl text-forest mb-1">{miBus.nombre}: {miBus.ocupacion_actual}/{miBus.capacidad_total} cupos</p>
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-4 ${miBus.necesita_refuerzo ? "bg-terracotta/15" : "bg-teal/15"}`}>
                      <span className={`w-2 h-2 rounded-full ${miBus.necesita_refuerzo ? "bg-terracotta" : "bg-teal"}`}></span>
                      <span className={`text-xs font-medium ${miBus.necesita_refuerzo ? "text-terracotta-dark" : "text-teal-dark"}`}>
                        {miBus.necesita_refuerzo ? "Bus lleno — refuerzo en camino" : "Cupos disponibles"}
                      </span>
                    </div>
                  </>
                ) : <p className="text-sm text-forest/50">Cargando...</p>}
              </div>

              <div className={`view ${role==="piloto" ? "active" : ""}`}>
                {!pilotoDesbloqueado ? (
                  <div className="py-2">
                    <p className="text-sm text-forest/60 mb-3">Acceso solo para pilotos. Ingresa la clave de turno:</p>
                    <input
                      type="password"
                      value={claveInput}
                      onChange={(e) => { setClaveInput(e.target.value); setClaveError(false); }}
                      onKeyDown={(e) => e.key === "Enter" && intentarDesbloquearPiloto()}
                      placeholder="Clave"
                      className="w-full mb-2 text-sm text-forest bg-cream border border-forest/15 rounded-lg px-3 py-2"
                    />
                    {claveError && <p className="text-xs text-terracotta mb-2">Clave incorrecta.</p>}
                    <button onClick={intentarDesbloquearPiloto} className="w-full py-2.5 rounded-full bg-forest text-white text-sm font-medium">
                      Entrar
                    </button>
                  </div>
                ) : (
                  <>
                    {buses.length > 0 && (
                      <select
                        value={miBus?.id ?? ""}
                        onChange={(e) => setBusSeleccionadoId(e.target.value)}
                        className="w-full mb-3 text-xs font-medium text-forest bg-cream border border-forest/15 rounded-lg px-3 py-2"
                      >
                        {buses.map((b) => (
                          <option key={b.id} value={b.id}>{b.nombre}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full ${ubicacionActiva ? "bg-teal" : "bg-forest/25"}`}></span>
                      <span className="text-xs text-forest/50">
                        {ubicacionActiva
                          ? "Ubicación GPS activa"
                          : ubicacionError
                          ? `GPS no disponible (${ubicacionError})`
                          : "Activando GPS..."}
                      </span>
                    </div>
                    <p className="text-xs text-forest/50 mb-2">
                      {esVuelta ? "Bajando" : "Subiendo"} · Parada: {miBus?.parada_actual ?? "..."} ({miBus?.parada_orden ?? 1}/{totalParadas})
                    </p>
                    <div className="flex items-baseline gap-2 mb-3">
                      <span className="font-display text-4xl text-forest">{miBus?.ocupacion_actual ?? 0}</span>
                      <span className="text-sm text-forest/60">/ {miBus?.capacidad_total ?? 30} pasajeros</span>
                    </div>
                    <div className="h-2 bg-cream rounded-full overflow-hidden mb-4">
                      <div className="h-full bg-mustard" style={{width: `${miBus ? (miBus.ocupacion_actual/miBus.capacidad_total)*100 : 0}%`}}></div>
                    </div>
                    <div className="flex gap-3 mb-3">
                      <button onClick={() => bump(-1)} className="flex-1 py-2.5 rounded-full border border-forest/30 text-forest text-sm font-medium">− Bajó</button>
                      <button onClick={() => bump(1)} className="flex-1 py-2.5 rounded-full bg-forest text-white text-sm font-medium">+ Subió</button>
                    </div>
                    <button onClick={avanzarParada} className="w-full py-2.5 rounded-full bg-terracotta text-white text-sm font-medium">
                      {textoBotonPiloto}
                    </button>
                  </>
                )}
              </div>

              <div className={`view ${role==="coordinador" ? "active" : ""}`}>
                {demanda && (demanda.ida > 0 || demanda.vuelta > 0) && (
                  <div className="bg-mustard/15 rounded-lg px-3 py-2.5 mb-3">
                    <p className="text-xs text-mustard-dark font-medium mb-1">Demanda estimada (últimos 30 min, por check-in QR)</p>
                    {demanda.ida > 0 && (
                      <p className="text-xs text-forest/70">↑ Subiendo: {demanda.ida} esperando · manda {recomendarUnidad(demanda.ida)}</p>
                    )}
                    {demanda.vuelta > 0 && (
                      <p className="text-xs text-forest/70">↓ Bajando: {demanda.vuelta} esperando · manda {recomendarUnidad(demanda.vuelta)}</p>
                    )}
                  </div>
                )}
                <p className="text-xs text-forest/50 mb-3">↑ Subiendo hacia El Valle</p>
                {buses.filter((b) => b.sentido === "ida").map((bus) => {
                  const pct = Math.round((bus.ocupacion_actual / bus.capacidad_total) * 100);
                  return (
                    <div key={bus.id} className="flex justify-between items-center px-3 py-2.5 bg-cream rounded-lg mb-2">
                      <span className="text-sm text-forest">{bus.nombre} — {bus.parada_actual}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${pct >= 100 ? "bg-terracotta/20 text-terracotta-dark" : "bg-mustard/30 text-mustard-dark"}`}>
                        {pct}%
                      </span>
                    </div>
                  );
                })}
                {buses.filter((b) => b.sentido === "ida").length === 0 && (
                  <p className="text-xs text-forest/40 mb-3">Ningún bus subiendo ahora</p>
                )}

                <p className="text-xs text-forest/50 mb-3 mt-4">↓ Bajando hacia Av. 19</p>
                {buses.filter((b) => b.sentido === "vuelta").map((bus) => {
                  const pct = Math.round((bus.ocupacion_actual / bus.capacidad_total) * 100);
                  return (
                    <div key={bus.id} className="flex justify-between items-center px-3 py-2.5 bg-cream rounded-lg mb-2">
                      <span className="text-sm text-forest">{bus.nombre} — {bus.parada_actual}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${pct >= 100 ? "bg-terracotta/20 text-terracotta-dark" : "bg-mustard/30 text-mustard-dark"}`}>
                        {pct}%
                      </span>
                    </div>
                  );
                })}
                {buses.filter((b) => b.sentido === "vuelta").length === 0 && (
                  <p className="text-xs text-forest/40 mb-3">Ningún bus bajando ahora</p>
                )}

                {buses.filter((b) => b.necesita_refuerzo).map((bus) => {
                  const mins = minutosEsperando(bus.refuerzo_desde);
                  const urgente = mins >= 25;
                  const medio = mins >= 15 && mins < 25;
                  return (
                    <div key={bus.id} className="mb-2">
                      <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg mb-2 ${urgente ? "bg-terracotta/20" : medio ? "bg-mustard/20" : "bg-terracotta/10"}`}>
                        <span className={`w-2 h-2 rounded-full mt-1.5 ${urgente ? "bg-terracotta" : "bg-mustard-dark"}`}></span>
                        <span className={`text-xs font-medium ${urgente ? "text-terracotta-dark" : "text-mustard-dark"}`}>
                          {bus.nombre} está lleno. Lleva {mins} min esperando refuerzo {urgente ? "— ¡urgente!" : ""}
                        </span>
                      </div>
                      <button
                        onClick={() => marcarAtendido(bus.id)}
                        className="w-full py-2.5 rounded-full bg-terracotta text-white text-sm font-medium"
                      >
                        Despachar refuerzo para {bus.nombre}
                      </button>
                    </div>
                  );
                })}

                {salidas.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-forest/10">
                    <p className="text-xs text-forest/50 mb-2">Salidas recientes</p>
                    {salidas.map((s) => (
                      <div key={`${s.id}-${s.at}`} className="flex justify-between items-center text-xs px-3 py-2 bg-cream rounded-lg mb-1.5">
                        <span className="text-forest">{s.nombre} · {s.sentido === "vuelta" ? "bajando" : "subiendo"}</span>
                        <span className={`font-medium ${
                          s.gapMin === null ? "text-forest/40"
                          : s.gapMin >= 30 ? "text-terracotta-dark"
                          : s.gapMin >= 20 ? "text-mustard-dark"
                          : "text-teal-dark"
                        }`}>
                          {s.gapMin === null ? "primera del turno" : `+${s.gapMin} min desde la anterior`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>

          {rutaIdaCoords.length > 0 && (
            <div className="max-w-3xl mx-auto mt-10">
              <p className="text-xs text-mustard text-center mb-1 uppercase tracking-widest">Mapa en vivo</p>
              <p className="text-xs text-white/40 text-center mb-3">Toca cualquier parada para ver su QR — así sabes si el bus ya pasó o viene en camino</p>
              <MapaRuta rutaIda={rutaIdaCoords} rutaVuelta={rutaVueltaCoords} buses={busesEnMapa} paradas={paradasEnMapa} />
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-4 text-xs text-white/50">
                <span className="flex items-center gap-2">
                  <span style={{ width: 18, height: 3, background: "#1F3D2E", display: "inline-block", borderRadius: 2 }} />
                  Bajando, hacia Av. 19
                </span>
                <span className="flex items-center gap-2">
                  <span style={{ width: 18, height: 0, borderTop: "2px dashed #C2542C", display: "inline-block" }} />
                  Subiendo, hacia Hotel Valle Grande
                </span>
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ background: "#C2542C" }} />
                  Bus en ruta
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="bg-forest-dark py-14">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid sm:grid-cols-3 gap-10 mb-10">
            <div>
              <span className="font-display text-lg text-white">Ruta del Valle</span>
              <p className="text-white/50 text-sm mt-3 leading-relaxed">
                Prototipo de rastreo de buses en tiempo real para la ruta Hotel Valle Grande – Av. 19, que
                conecta a El Playón con el centro de Mérida.
              </p>
            </div>
            <div>
              <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-3">Navegación</p>
              <ul className="space-y-2 text-sm">
                <li><a href="#como-funciona" className="text-white/50 hover:text-white transition">Cómo funciona</a></li>
                <li><a href="#embarca" className="text-white/50 hover:text-white transition">Demo en vivo</a></li>
              </ul>
            </div>
            <div>
              <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-3">Construido con</p>
              <ul className="space-y-2 text-sm text-white/50">
                <li>Next.js · Supabase Realtime</li>
                <li>React Leaflet · OpenStreetMap</li>
              </ul>
            </div>
          </div>
          <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-2 text-white/40 text-xs">
            <p>Proyecto final — prototipo académico. Ruta del Valle, Mérida.</p>
            <p>Construido por Leonardo Moscarini y Ismael Fermín · &copy; {new Date().getFullYear()}</p>
          </div>
        </div>
      </footer>
    </>
  );
}