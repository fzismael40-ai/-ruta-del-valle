"use client";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "./supabaseClient";
import { rutaIdaCarretera, rutaVueltaCarretera } from "./rutaCarreteras";
import { soportaHuellaOFace, existeHuella, entrarConHuella, registrarHuella } from "./webauthnCliente";

const MapaRuta = dynamic(() => import("./MapaRuta"), { ssr: false });

type RutaInfo = {
  id: string;
  nombre: string;
  slug: string;
  descripcion: string | null;
};

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
  activo: boolean;
  clave_actual: string | null;
  clave_fecha: string | null;
  clave_fija: boolean;
  parada_desde: string | null;
  ubicacion_actualizada: string | null;
};

// Si el GPS no manda una ubicación nueva en más de esto, se considera
// "sin señal" (aunque haya un último punto real guardado) y el bus pasa al
// modo animado — pasa seguido en el tramo entre la laguna artificial y la
// Alfarería, donde tarda en agarrar señal de nuevo.
const UMBRAL_GPS_SIN_SENAL_MS = 20000;

// Estimado fijo (no hay datos reales de tiempos aún) usado tanto para la
// cuenta regresiva de "faltan X min" como para la duración de la animación
// del bus moviéndose por la ruta entre paradas.
const MINUTOS_ESTIMADOS_POR_PARADA = 3;

// Cada unidad (piloto) y el coordinador tienen una clave que el admin asigna
// día a día desde /admin — al cambiar la fecha, la clave de ayer deja de
// servir sola, así que cada turno nuevo necesita que le den la de hoy.
const hoy = () => new Date().toISOString().slice(0, 10);

type PromptInstalacion = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Parada = {
  id: string;
  nombre: string;
  orden: number | null;
  orden_vuelta: number | null;
  latitud: number | null;
  longitud: number | null;
  ocupacion_tipica: number | null;
};

export default function RutaApp({ slug }: { slug: string }) {
  const router = useRouter();
  // Empieza sin resolver en ambos lados (servidor y cliente); el useEffect de
  // abajo busca la ruta por slug solo en el navegador, después del primer
  // render, y recién ahí se sabe si existe o no.
  const [ruta, setRuta] = useState<RutaInfo | null | "not-found">(null);
  const [instalarPrompt, setInstalarPrompt] = useState<PromptInstalacion | null>(null);
  const [mostrarBotonInstalar, setMostrarBotonInstalar] = useState(true);
  const [mensajeInstalacion, setMensajeInstalacion] = useState<string | null>(null);
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
  // Posición interpolada mientras el bus "camina" por la ruta real entre una
  // parada y la siguiente (solo para buses sin GPS en vivo — con GPS activo
  // se usa la posición real). animacionesRef guarda el intervalo activo por
  // bus para poder cancelarlo si llega una actualización nueva a mitad de
  // camino. paradasRef evita que el efecto de buses use una lista de paradas
  // vieja al buscar las coordenadas.
  const [posicionesAnimadas, setPosicionesAnimadas] = useState<Record<string, [number, number]>>({});
  const animacionesRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const paradasRef = useRef<Parada[]>([]);
  const [demanda, setDemanda] = useState<{ ida: number; vuelta: number } | null>(null);
  // Empieza vacío en ambos lados (servidor y cliente) para evitar un
  // desajuste de hidratación; el useEffect de abajo confirma lo verificado
  // leyendo localStorage solo en el navegador, después del primer render.
  // Guarda, por bus, la última clave verificada y la fecha en que se
  // verificó — si la fecha no es hoy, o el admin cambió la clave del bus
  // desde entonces, se vuelve a pedir.
  const [verificacionesPiloto, setVerificacionesPiloto] = useState<Record<string, { fecha: string; clave: string }>>({});
  const [claveBusInput, setClaveBusInput] = useState("");
  const [claveBusError, setClaveBusError] = useState(false);
  const [claveDiaCoordinador, setClaveDiaCoordinador] = useState<{ clave: string | null; fecha: string | null; fija: boolean }>({ clave: null, fecha: null, fija: false });
  const [verificacionCoordinador, setVerificacionCoordinador] = useState<{ fecha: string; clave: string } | null>(null);
  const [claveCoordInput, setClaveCoordInput] = useState("");
  const [claveCoordError, setClaveCoordError] = useState(false);
  const [huellaBusDisponible, setHuellaBusDisponible] = useState(false);
  const [ofrecerActivarHuellaBus, setOfrecerActivarHuellaBus] = useState(false);
  const [huellaMensajeBus, setHuellaMensajeBus] = useState<string | null>(null);
  const [huellaCoordDisponible, setHuellaCoordDisponible] = useState(false);
  const [ofrecerActivarHuellaCoord, setOfrecerActivarHuellaCoord] = useState(false);
  const [huellaMensajeCoord, setHuellaMensajeCoord] = useState<string | null>(null);
  const [ubicacionActiva, setUbicacionActiva] = useState(false);
  const [ubicacionError, setUbicacionError] = useState<string | null>(null);
  const ultimoEnvioUbicacionRef = useRef(0);
  // Empieza en modo web (con presentación) en ambos lados para evitar un
  // desajuste de hidratación; se confirma el modo app instalada después del
  // primer render, cuando ya se puede consultar display-mode con seguridad.
  const [esAppInstalada, setEsAppInstalada] = useState(false);

  // rutaId=null puede significar dos cosas: todavía no se resolvió (ruta===null,
  // los efectos de abajo esperan) o ya se intentó y no hay que filtrar por ruta
  // (el caso de compatibilidad de Ruta del Valle mientras no se corra la
  // migración de "rutas" — ver más abajo). "resuelta" distingue esos dos casos.
  const resuelta = ruta !== null;
  const rutaId = ruta && ruta !== "not-found" ? ruta.id : null;

  useEffect(() => {
    const fetchRuta = async () => {
      const { data, error } = await supabase.from("rutas").select("id,nombre,slug,descripcion").eq("slug", slug).maybeSingle();
      if (data) {
        setRuta(data);
        return;
      }
      if (error && slug === "ruta-del-valle") {
        // La tabla "rutas" todavía no existe (falta correr la migración):
        // Ruta del Valle sigue funcionando exactamente igual que siempre,
        // sin filtrar nada por ruta_id (ver "resuelta"/"rutaId" arriba).
        setRuta("not-found");
        return;
      }
      setRuta("not-found");
    };
    fetchRuta();
  }, [slug]);

  useEffect(() => {
    try {
      const guardadas = JSON.parse(localStorage.getItem("piloto-verificaciones") ?? "{}");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVerificacionesPiloto(guardadas);
    } catch {
      // localStorage corrupto o vacío: se queda sin nada verificado.
    }
    try {
      const guardada = JSON.parse(localStorage.getItem(`coordinador-verificacion-${slug}`) ?? "null");
      setVerificacionCoordinador(guardada);
    } catch {
      // localStorage corrupto o vacío: se queda sin verificar.
    }
  }, [slug]);

  useEffect(() => {
    if (!resuelta) return;
    const fetchClaveCoordinador = async () => {
      let q = supabase.from("claves_dia").select("*").eq("rol", "coordinador");
      if (rutaId) q = q.eq("ruta_id", rutaId);
      const { data } = await q.maybeSingle();
      setClaveDiaCoordinador({ clave: data?.clave ?? null, fecha: data?.fecha ?? null, fija: data?.fija ?? false });
    };
    fetchClaveCoordinador();
  }, [resuelta, rutaId]);

  useEffect(() => {
    const alPoderInstalar = (e: Event) => {
      e.preventDefault();
      setInstalarPrompt(e as PromptInstalacion);
    };
    const alInstalar = () => setMostrarBotonInstalar(false);
    window.addEventListener("beforeinstallprompt", alPoderInstalar);
    window.addEventListener("appinstalled", alInstalar);
    if (window.matchMedia("(display-mode: standalone)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMostrarBotonInstalar(false);
      setEsAppInstalada(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", alPoderInstalar);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, []);

  const descargarApp = async () => {
    if (instalarPrompt) {
      instalarPrompt.prompt();
      const eleccion = await instalarPrompt.userChoice;
      if (eleccion.outcome === "accepted") setMostrarBotonInstalar(false);
      setInstalarPrompt(null);
      return;
    }
    setMensajeInstalacion(
      "En iPhone: toca el ícono de compartir (⬆) en Safari y elige \"Agregar a pantalla de inicio\". En Android, desde el menú (⋮) elige \"Instalar app\"."
    );
  };

  const marcarBusVerificado = (bus: Bus) => {
    const nuevas = { ...verificacionesPiloto, [bus.id]: { fecha: hoy(), clave: bus.clave_actual! } };
    localStorage.setItem("piloto-verificaciones", JSON.stringify(nuevas));
    setVerificacionesPiloto(nuevas);
    setClaveBusError(false);
    setClaveBusInput("");
    // Al entrar, la unidad vuelve a aparecer en el mapa: así no depende de
    // que el piloto se acuerde de "Reincorporarme".
    supabase.from("buses").update({ activo: true }).eq("id", bus.id);
  };

  const intentarDesbloquearBus = (bus: Bus) => {
    if ((bus.clave_fija || bus.clave_fecha === hoy()) && bus.clave_actual !== null && claveBusInput === bus.clave_actual) {
      marcarBusVerificado(bus);
      if (soportaHuellaOFace()) {
        existeHuella({ tipo: "piloto", busId: bus.id }).then((existe) => {
          setHuellaBusDisponible(existe);
          if (!existe) setOfrecerActivarHuellaBus(true);
        });
      }
    } else {
      setClaveBusError(true);
    }
  };

  const entrarConHuellaBus = async (bus: Bus) => {
    setHuellaMensajeBus(null);
    const r = await entrarConHuella({ tipo: "piloto", busId: bus.id });
    if (r.ok) {
      marcarBusVerificado(bus);
    } else if (!r.sinCredencial) {
      setHuellaMensajeBus(r.error ?? "No se pudo entrar con huella.");
    }
  };

  const activarHuellaBus = async (bus: Bus) => {
    setHuellaMensajeBus(null);
    const r = await registrarHuella({ tipo: "piloto", busId: bus.id }, bus.nombre);
    if (r.ok) {
      setHuellaBusDisponible(true);
      setOfrecerActivarHuellaBus(false);
    } else {
      setHuellaMensajeBus(r.error ?? "No se pudo activar.");
    }
  };

  const marcarCoordinadorVerificado = (clave: string) => {
    const nueva = { fecha: hoy(), clave };
    localStorage.setItem(`coordinador-verificacion-${slug}`, JSON.stringify(nueva));
    setVerificacionCoordinador(nueva);
    setClaveCoordError(false);
    setClaveCoordInput("");
  };

  const intentarDesbloquearCoordinador = () => {
    if ((claveDiaCoordinador.fija || claveDiaCoordinador.fecha === hoy()) && claveDiaCoordinador.clave !== null && claveCoordInput === claveDiaCoordinador.clave) {
      marcarCoordinadorVerificado(claveDiaCoordinador.clave);
      if (soportaHuellaOFace()) {
        existeHuella({ tipo: "coordinador", rutaId: rutaId ?? undefined }).then((existe) => {
          setHuellaCoordDisponible(existe);
          if (!existe) setOfrecerActivarHuellaCoord(true);
        });
      }
    } else {
      setClaveCoordError(true);
    }
  };

  const entrarConHuellaCoord = async () => {
    setHuellaMensajeCoord(null);
    const r = await entrarConHuella({ tipo: "coordinador", rutaId: rutaId ?? undefined });
    if (r.ok && claveDiaCoordinador.clave) {
      marcarCoordinadorVerificado(claveDiaCoordinador.clave);
    } else if (!r.sinCredencial) {
      setHuellaMensajeCoord(r.error ?? "No se pudo entrar con huella.");
    }
  };

  const activarHuellaCoord = async () => {
    setHuellaMensajeCoord(null);
    const r = await registrarHuella({ tipo: "coordinador", rutaId: rutaId ?? undefined }, "Coordinador");
    if (r.ok) {
      setHuellaCoordDisponible(true);
      setOfrecerActivarHuellaCoord(false);
    } else {
      setHuellaMensajeCoord(r.error ?? "No se pudo activar.");
    }
  };

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!resuelta) return;
    const fetchParadas = async () => {
      let q = supabase.from("paradas").select("*");
      if (rutaId) q = q.eq("ruta_id", rutaId);
      const { data } = await q;
      if (data) setParadas(data as Parada[]);
    };
    fetchParadas();
  }, [resuelta, rutaId]);

  useEffect(() => {
    paradasRef.current = paradas;
  }, [paradas]);

  // Encuentra, dentro del trazado real de la vía, el tramo entre dos puntos
  // (la parada anterior y la nueva) para animar al bus recorriéndolo, en vez
  // de saltar directo en línea recta de una a otra.
  const tramoDeRuta = (desde: [number, number], hasta: [number, number], sentido: "ida" | "vuelta"): [number, number][] => {
    const ruta = (sentido === "vuelta" ? rutaVueltaCarretera : rutaIdaCarretera) as [number, number][];
    if (ruta.length < 2) return [desde, hasta];
    const idxCercano = (p: [number, number]) => {
      let mejorI = 0;
      let mejorD = Infinity;
      ruta.forEach((q, i) => {
        const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
        if (d < mejorD) {
          mejorD = d;
          mejorI = i;
        }
      });
      return mejorI;
    };
    const i1 = idxCercano(desde);
    const i2 = idxCercano(hasta);
    const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
    let tramo = ruta.slice(lo, hi + 1);
    if (i1 > i2) tramo = [...tramo].reverse();
    return tramo.length >= 2 ? tramo : [desde, hasta];
  };

  const animarMovimientoBus = (busId: string, desde: [number, number], hasta: [number, number], sentido: "ida" | "vuelta") => {
    const tramo = tramoDeRuta(desde, hasta, sentido);
    const activa = animacionesRef.current[busId];
    if (activa) clearInterval(activa);
    const duracionMs = MINUTOS_ESTIMADOS_POR_PARADA * 60000;
    const inicio = Date.now();
    const intervalId = setInterval(() => {
      const frac = Math.min(1, (Date.now() - inicio) / duracionMs);
      const idx = Math.min(tramo.length - 1, Math.floor(frac * (tramo.length - 1)));
      setPosicionesAnimadas((prev) => ({ ...prev, [busId]: tramo[idx] }));
      if (frac >= 1) {
        clearInterval(intervalId);
        delete animacionesRef.current[busId];
      }
    }, 1000);
    animacionesRef.current[busId] = intervalId;
  };

  useEffect(() => {
    const animaciones = animacionesRef.current;
    return () => {
      Object.values(animaciones).forEach((id) => clearInterval(id));
    };
  }, []);

  useEffect(() => {
    if (!resuelta) return;
    const fetchBuses = async () => {
      let q = supabase.from("buses").select("*");
      if (rutaId) q = q.eq("ruta_id", rutaId);
      const { data } = await q.order("nombre");
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
          // Si avanzó de parada y no tiene GPS en vivo (nunca lo tuvo, o se
          // quedó sin señal — como suele pasar entre la laguna artificial y
          // la Alfarería), se anima caminando por la vía real entre el
          // último punto conocido y la parada nueva, en vez de saltar
          // directo o quedarse congelado.
          const gpsViejo =
            b.ubicacion_actualizada !== null && Date.now() - new Date(b.ubicacion_actualizada).getTime() >= UMBRAL_GPS_SIN_SENAL_MS;
          const sinGpsEnVivo = b.latitud === null || b.longitud === null || gpsViejo;
          if (anterior && anterior.parada_actual !== b.parada_actual && sinGpsEnVivo) {
            const paradaNueva = paradasRef.current.find((p) => p.nombre === b.parada_actual);
            let desde: [number, number] | null = null;
            if (b.latitud !== null && b.longitud !== null) {
              // Último punto GPS real conocido, aunque la señal ya esté vieja.
              desde = [b.latitud, b.longitud];
            } else {
              const paradaAnterior = paradasRef.current.find((p) => p.nombre === anterior.parada_actual);
              if (paradaAnterior?.latitud != null && paradaAnterior?.longitud != null) {
                desde = [paradaAnterior.latitud, paradaAnterior.longitud];
              }
            }
            if (desde && paradaNueva?.latitud != null && paradaNueva?.longitud != null) {
              animarMovimientoBus(b.id, desde, [paradaNueva.latitud, paradaNueva.longitud], b.sentido);
            }
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
      .channel(`buses-realtime-${rutaId ?? "legacy"}`)
      .on(
        "postgres_changes",
        rutaId
          ? { event: "*", schema: "public", table: "buses", filter: `ruta_id=eq.${rutaId}` }
          : { event: "*", schema: "public", table: "buses" },
        () => fetchBuses()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuelta, rutaId]);

  useEffect(() => {
    if (!resuelta) return;
    const fetchDemanda = async () => {
      const desde = new Date(Date.now() - 30 * 60000).toISOString();
      let q = supabase.from("checkins").select("sentido").gte("created_at", desde);
      if (rutaId) q = q.eq("ruta_id", rutaId);
      const { data, error } = await q;
      if (error) return; // la tabla todavía no existe o no hay permiso: se oculta el panel
      setDemanda({
        ida: data.filter((c) => c.sentido === "ida").length,
        vuelta: data.filter((c) => c.sentido === "vuelta").length,
      });
    };
    fetchDemanda();

    const channel = supabase
      .channel(`checkins-realtime-${rutaId ?? "legacy"}`)
      .on(
        "postgres_changes",
        rutaId
          ? { event: "INSERT", schema: "public", table: "checkins", filter: `ruta_id=eq.${rutaId}` }
          : { event: "INSERT", schema: "public", table: "checkins" },
        () => fetchDemanda()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [resuelta, rutaId]);

  const paradasIda = paradas.filter((p) => p.orden !== null).sort((a, b) => a.orden! - b.orden!);
  const paradasVuelta = paradas.filter((p) => p.orden_vuelta !== null).sort((a, b) => a.orden_vuelta! - b.orden_vuelta!);
  // Los buses "fuera de línea" (el piloto salió de turno) se ocultan de
  // pasajero/coordinador/mapa, pero el piloto los sigue viendo en su selector
  // para poder reincorporarse.
  // "!== false" en vez de solo "b.activo": si la columna todavía no existe en
  // Supabase (antes de correr la migración), el campo llega undefined y no
  // debe ocultar todos los buses de golpe.
  const busesActivos = buses.filter((b) => b.activo !== false);

  // GPS "fresco" = llegó una ubicación real hace menos de UMBRAL_GPS_SIN_SENAL_MS.
  // Si el bus tiene lat/lng pero la señal se puso vieja, se trata como si no
  // tuviera GPS en vivo (cae al modo animado) en vez de quedarse congelado en
  // el último punto real.
  const gpsFresco = (bus: Bus | undefined) => {
    if (!bus || bus.latitud === null || bus.longitud === null) return false;
    if (!bus.ubicacion_actualizada) return true; // migración vieja sin esta columna: no se puede saber, se asume fresco
    return ahora - new Date(bus.ubicacion_actualizada).getTime() < UMBRAL_GPS_SIN_SENAL_MS;
  };

  const idBusEfectivo = busSeleccionadoId ?? busesActivos[0]?.id ?? buses[0]?.id ?? null;
  const miBus = buses.find((b) => b.id === idBusEfectivo) ?? buses[0];
  const listaActual = miBus?.sentido === "vuelta" ? paradasVuelta : paradasIda;
  const totalParadas = listaActual.length;
  const esVuelta = miBus?.sentido === "vuelta";
  const esFinalDeLista = miBus ? miBus.parada_orden >= totalParadas : false;

  useEffect(() => {
    if (!miBus?.id || !soportaHuellaOFace()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHuellaBusDisponible(false);
      return;
    }
    existeHuella({ tipo: "piloto", busId: miBus.id }).then(setHuellaBusDisponible);
  }, [miBus?.id]);

  useEffect(() => {
    if (!soportaHuellaOFace()) return;
    existeHuella({ tipo: "coordinador", rutaId: rutaId ?? undefined }).then(setHuellaCoordDisponible);
  }, [rutaId]);

  const pilotoBusDesbloqueado = (bus: Bus | undefined) => {
    if (!bus || bus.clave_actual === null || (!bus.clave_fija && bus.clave_fecha !== hoy())) return false;
    const verificada = verificacionesPiloto[bus.id];
    if (!verificada || verificada.clave !== bus.clave_actual) return false;
    // Con clave fija no hace falta que la verificación sea de hoy: se queda
    // desbloqueado hasta que el admin cambie la clave.
    return bus.clave_fija || verificada.fecha === hoy();
  };
  const miBusDesbloqueado = pilotoBusDesbloqueado(miBus);
  const coordinadorDesbloqueado = (() => {
    if (claveDiaCoordinador.clave === null || (!claveDiaCoordinador.fija && claveDiaCoordinador.fecha !== hoy())) return false;
    if (!verificacionCoordinador || verificacionCoordinador.clave !== claveDiaCoordinador.clave) return false;
    return claveDiaCoordinador.fija || verificacionCoordinador.fecha === hoy();
  })();

  // Ubicación real del piloto: mientras esté activa, actualiza la posición
  // del bus seleccionado en Supabase (máximo una escritura cada 5s).
  useEffect(() => {
    if (role !== "piloto" || !miBusDesbloqueado || !miBus?.id || !navigator.geolocation) {
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
            ubicacion_actualizada: new Date().toISOString(),
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
  }, [role, miBusDesbloqueado, miBus?.id]);

  // Mantiene la pantalla encendida mientras el piloto está rastreando, y la
  // vuelve a pedir si el navegador la soltó al cambiar de pestaña.
  useEffect(() => {
    if (role !== "piloto" || !miBusDesbloqueado || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelado = false;

    const pedirWakeLock = async () => {
      try {
        const s = await navigator.wakeLock.request("screen");
        if (cancelado) {
          s.release();
          return;
        }
        sentinel = s;
      } catch {
        // el usuario puede haber negado el permiso o la pestaña no está visible; no es crítico
      }
    };
    pedirWakeLock();

    const alVolverVisible = () => {
      if (document.visibilityState === "visible" && !sentinel) pedirWakeLock();
    };
    document.addEventListener("visibilitychange", alVolverVisible);

    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", alVolverVisible);
      sentinel?.release();
    };
  }, [role, miBusDesbloqueado]);

  const minutosEsperando = (refuerzoDesde: string | null) => {
    if (!refuerzoDesde) return 0;
    return Math.floor((ahora - new Date(refuerzoDesde).getTime()) / 60000);
  };

  // Semáforo de ocupación: verde/teal hasta la mitad, amarillo de ahí a
  // lleno, rojo cuando ya está lleno — usado en piloto, pasajero y coordinador.
  const estiloOcupacion = (actual: number, capacidad: number) => {
    const pct = capacidad > 0 ? actual / capacidad : 0;
    if (pct >= 1) {
      return { barra: "bg-terracotta", chip: "bg-terracotta/20 text-terracotta-dark", pill: "bg-terracotta/15", dot: "bg-terracotta", texto: "text-terracotta-dark", etiqueta: "Bus lleno — refuerzo en camino" };
    }
    if (pct >= 0.5) {
      return { barra: "bg-mustard", chip: "bg-mustard/30 text-mustard-dark", pill: "bg-mustard/15", dot: "bg-mustard", texto: "text-mustard-dark", etiqueta: "Se está llenando" };
    }
    return { barra: "bg-teal", chip: "bg-teal/20 text-teal-dark", pill: "bg-teal/15", dot: "bg-teal", texto: "text-teal-dark", etiqueta: "Cupos disponibles" };
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
          parada_desde: new Date().toISOString(),
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
        parada_desde: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", miBus.id);
  };

  // Estimado de minutos para la siguiente parada: cuenta regresiva fija
  // desde que el piloto avanzó a la parada actual (no hay datos reales de
  // tiempos de recorrido todavía).
  const minutosParaLaSiguiente = (bus: Bus | undefined): number | null => {
    if (!bus?.parada_desde) return null;
    const transcurridos = (ahora - new Date(bus.parada_desde).getTime()) / 60000;
    return Math.max(0, Math.ceil(MINUTOS_ESTIMADOS_POR_PARADA - transcurridos));
  };

  const marcarAtendido = async (busId: string) => {
    await supabase.from("buses").update({ necesita_refuerzo: false, refuerzo_desde: null }).eq("id", busId);
  };

  const alternarActivo = async () => {
    if (!miBus) return;
    await supabase.from("buses").update({ activo: !miBus.activo, updated_at: new Date().toISOString() }).eq("id", miBus.id);
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

  const busesEnMapa = busesActivos
    .map((b) => {
      // Si el piloto tiene GPS activo y con señal reciente, usamos su
      // ubicación real; si no, caemos a la animación o a la parada.
      if (gpsFresco(b) && b.latitud !== null && b.longitud !== null) {
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
      const animada = posicionesAnimadas[b.id];
      if (animada) {
        return {
          id: b.id,
          nombre: b.nombre,
          sentido: b.sentido,
          necesita_refuerzo: b.necesita_refuerzo,
          lat: animada[0],
          lng: animada[1],
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

  if (ruta === "not-found" && slug !== "ruta-del-valle") {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center px-6 text-center">
        <div>
          <p className="font-display text-2xl text-forest mb-3">Ruta no encontrada</p>
          <Link href="/" className="text-sm text-terracotta hover:underline">Volver al inicio</Link>
        </div>
      </main>
    );
  }

  if (ruta === null) {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center px-6 text-center">
        <p className="text-sm text-forest/50">Cargando ruta...</p>
      </main>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 backdrop-blur border-b border-forest/10" style={{background:"rgba(246,241,231,0.9)"}}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onDoubleClick={() => router.push("/admin?full=1")}
              style={{ touchAction: "manipulation" }}
              className="font-display font-semibold text-lg text-forest select-none"
            >
              Next Route
            </button>
          </div>
          {!esAppInstalada && (
            <nav className="hidden sm:flex items-center gap-6">
              <a href="#como-funciona" className="text-sm text-forest/70 hover:text-forest transition">Cómo funciona</a>
              <a href="#embarca" className="text-sm text-forest/70 hover:text-forest transition">En vivo</a>
            </nav>
          )}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              {mostrarBotonInstalar && (
                <button
                  onClick={descargarApp}
                  className="text-sm font-medium px-4 py-2 rounded-full border border-forest text-forest hover:bg-forest/5 transition"
                >
                  ⬇ Descargar
                </button>
              )}
              {!esAppInstalada && (
                <a href="#embarca" className="text-sm font-medium px-4 py-2 rounded-full bg-forest text-white hover:bg-forest-dark transition">Ver la app</a>
              )}
            </div>
            {mostrarBotonInstalar && (
              <span className="text-xs text-forest/40">🗺️ Más rutas en camino</span>
            )}
          </div>
        </div>
        {mensajeInstalacion && (
          <div className="max-w-6xl mx-auto px-6 pb-3 -mt-1">
            <div className="bg-teal/15 text-teal-dark text-xs rounded-lg px-3 py-2 flex justify-between items-center">
              <span>{mensajeInstalacion}</span>
              <button onClick={() => setMensajeInstalacion(null)} className="text-teal-dark/60 hover:text-teal-dark ml-3">✕</button>
            </div>
          </div>
        )}
      </header>

      {!esAppInstalada && (
      <>
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
              <p className="font-display text-2xl text-forest">{busesActivos.length || "—"}</p>
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
      </>
      )}

      <section id="embarca" className={`scroll-mt-20 bg-forest ${esAppInstalada ? "pt-10 pb-20" : "py-20"}`}>
        <div className="max-w-6xl mx-auto px-6">
          {!esAppInstalada && (
            <>
              <p className="text-mustard text-xs text-center uppercase tracking-widest mb-3">Pruébala tú mismo</p>
              <h2 className="font-display text-3xl text-white text-center mb-10">Tres vistas, una sola ruta</h2>
            </>
          )}

          <div className="flex justify-center gap-2 mb-8">
            <button onClick={() => setRole("pasajero")} className={`role-btn px-4 py-2 rounded-full text-sm font-medium border border-white/20 text-white ${role==="pasajero" ? "active" : ""}`}>Pasajero</button>
            <button onClick={() => setRole("piloto")} className={`role-btn px-4 py-2 rounded-full text-sm font-medium border border-white/20 text-white ${role==="piloto" ? "active" : ""}`}>Piloto</button>
            <button onClick={() => setRole("coordinador")} className={`role-btn px-4 py-2 rounded-full text-sm font-medium border border-white/20 text-white ${role==="coordinador" ? "active" : ""}`}>Coordinador</button>
          </div>

          <div className="flex justify-center">
            <div className="phone p-4">

              <div className={`view ${role==="pasajero" ? "active" : ""}`}>
                {busesActivos.length > 0 && (
                  <select
                    value={miBus?.id ?? ""}
                    onChange={(e) => setBusSeleccionadoId(e.target.value)}
                    className="w-full mb-3 text-xs font-medium text-forest bg-cream border border-forest/15 rounded-lg px-3 py-2"
                  >
                    {busesActivos.map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre}</option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-forest/50 mb-2">
                  Parada: {miBus?.parada_actual ?? "..."} · {miBus?.sentido === "vuelta" ? "Bajando hacia Av. 19" : "Subiendo hacia el Valle"}
                </p>
                {(() => {
                  const min = minutosParaLaSiguiente(miBus);
                  if (min === null) return null;
                  return (
                    <p className="text-xs text-teal-dark font-medium mb-2">
                      {min === 0 ? "Está por llegar a la próxima parada" : `≈ ${min} min para la próxima parada`}
                    </p>
                  );
                })()}
                {busesActivos.length === 0 ? (
                  <p className="text-sm text-forest/50">Ninguna unidad en línea ahora mismo.</p>
                ) : miBus ? (
                  <>
                    <p className="font-display text-xl text-forest mb-1">{miBus.nombre}: {miBus.ocupacion_actual}/{miBus.capacidad_total} cupos</p>
                    {(() => {
                      const e = estiloOcupacion(miBus.ocupacion_actual, miBus.capacidad_total);
                      return (
                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-4 ${e.pill}`}>
                          <span className={`w-2 h-2 rounded-full ${e.dot}`}></span>
                          <span className={`text-xs font-medium ${e.texto}`}>{e.etiqueta}</span>
                        </div>
                      );
                    })()}
                  </>
                ) : <p className="text-sm text-forest/50">Cargando...</p>}
              </div>

              <div className={`view ${role==="piloto" ? "active" : ""}`}>
                {buses.length > 0 && (
                  <select
                    value={miBus?.id ?? ""}
                    onChange={(e) => { setBusSeleccionadoId(e.target.value); setClaveBusInput(""); setClaveBusError(false); }}
                    className="w-full mb-3 text-xs font-medium text-forest bg-cream border border-forest/15 rounded-lg px-3 py-2"
                  >
                    {buses.map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre}</option>
                    ))}
                  </select>
                )}
                {!miBus ? (
                  <p className="text-sm text-forest/50">Cargando...</p>
                ) : !miBusDesbloqueado ? (
                  <div className="py-2">
                    {miBus.clave_actual === null || (!miBus.clave_fija && miBus.clave_fecha !== hoy()) ? (
                      <p className="text-sm text-forest/60">
                        Todavía no hay clave asignada hoy para {miBus.nombre}. Pídesela al coordinador o al admin.
                      </p>
                    ) : (
                      <>
                        <p className="text-sm text-forest/60 mb-3">Clave de hoy para {miBus.nombre}:</p>
                        <input
                          type="password"
                          value={claveBusInput}
                          onChange={(e) => { setClaveBusInput(e.target.value); setClaveBusError(false); }}
                          onKeyDown={(e) => e.key === "Enter" && intentarDesbloquearBus(miBus)}
                          placeholder="Clave"
                          className="w-full mb-2 text-sm text-forest bg-cream border border-forest/15 rounded-lg px-3 py-2"
                        />
                        {claveBusError && <p className="text-xs text-terracotta mb-2">Clave incorrecta.</p>}
                        <button onClick={() => intentarDesbloquearBus(miBus)} className="w-full py-2.5 rounded-full bg-forest text-white text-sm font-medium">
                          Entrar
                        </button>
                        {huellaBusDisponible && (
                          <button
                            onClick={() => entrarConHuellaBus(miBus)}
                            className="w-full mt-2 py-2.5 rounded-full border border-forest text-forest text-sm font-medium"
                          >
                            👆 Entrar con huella / Face ID
                          </button>
                        )}
                        {huellaMensajeBus && <p className="text-xs text-terracotta mt-2">{huellaMensajeBus}</p>}
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {ofrecerActivarHuellaBus && miBus && (
                      <div className="bg-mustard/15 text-forest text-xs rounded-lg px-3 py-2.5 mb-3 flex items-center justify-between gap-2">
                        <span>¿Activar huella / Face ID para {miBus.nombre}?</span>
                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => activarHuellaBus(miBus)} className="font-medium px-2.5 py-1 rounded-full bg-forest text-white">Activar</button>
                          <button onClick={() => setOfrecerActivarHuellaBus(false)} className="text-forest/50">Ahora no</button>
                        </div>
                      </div>
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
                      <div
                        className={`h-full transition-colors ${miBus ? estiloOcupacion(miBus.ocupacion_actual, miBus.capacidad_total).barra : "bg-teal"}`}
                        style={{width: `${miBus ? (miBus.ocupacion_actual/miBus.capacidad_total)*100 : 0}%`}}
                      ></div>
                    </div>
                    <div className="flex gap-3 mb-3">
                      <button onClick={() => bump(-1)} className="flex-1 py-2.5 rounded-full border border-forest/30 text-forest text-sm font-medium">− Bajó</button>
                      <button onClick={() => bump(1)} className="flex-1 py-2.5 rounded-full bg-forest text-white text-sm font-medium">+ Subió</button>
                    </div>
                    <button onClick={avanzarParada} className="w-full py-2.5 rounded-full bg-terracotta text-white text-sm font-medium">
                      {textoBotonPiloto}
                    </button>
                    <button
                      onClick={alternarActivo}
                      className={`w-full mt-2 py-2 rounded-full border text-xs font-medium transition ${
                        miBus?.activo === false
                          ? "border-teal text-teal-dark hover:bg-teal/10"
                          : "border-forest/20 text-forest/60 hover:bg-forest/5"
                      }`}
                    >
                      {miBus?.activo === false ? "↩ Reincorporarme a la línea" : "Salir de la línea (fin de turno)"}
                    </button>
                    {miBus?.activo === false && (
                      <p className="text-xs text-terracotta text-center mt-2">
                        Estás fuera de línea: pasajeros y coordinador no ven este bus.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className={`view ${role==="coordinador" ? "active" : ""}`}>
                {!coordinadorDesbloqueado ? (
                  <div className="py-2">
                    {claveDiaCoordinador.clave === null || (!claveDiaCoordinador.fija && claveDiaCoordinador.fecha !== hoy()) ? (
                      <p className="text-sm text-forest/60">Todavía no hay clave asignada hoy para coordinador. Pídesela al admin.</p>
                    ) : (
                      <>
                        <p className="text-sm text-forest/60 mb-3">Acceso solo para coordinadores. Ingresa la clave:</p>
                        <input
                          type="password"
                          value={claveCoordInput}
                          onChange={(e) => { setClaveCoordInput(e.target.value); setClaveCoordError(false); }}
                          onKeyDown={(e) => e.key === "Enter" && intentarDesbloquearCoordinador()}
                          placeholder="Clave"
                          className="w-full mb-2 text-sm text-forest bg-cream border border-forest/15 rounded-lg px-3 py-2"
                        />
                        {claveCoordError && <p className="text-xs text-terracotta mb-2">Clave incorrecta.</p>}
                        <button onClick={intentarDesbloquearCoordinador} className="w-full py-2.5 rounded-full bg-forest text-white text-sm font-medium">
                          Entrar
                        </button>
                        {huellaCoordDisponible && (
                          <button
                            onClick={entrarConHuellaCoord}
                            className="w-full mt-2 py-2.5 rounded-full border border-forest text-forest text-sm font-medium"
                          >
                            👆 Entrar con huella / Face ID
                          </button>
                        )}
                        {huellaMensajeCoord && <p className="text-xs text-terracotta mt-2">{huellaMensajeCoord}</p>}
                      </>
                    )}
                  </div>
                ) : (
                  <>
                {ofrecerActivarHuellaCoord && (
                  <div className="bg-mustard/15 text-forest text-xs rounded-lg px-3 py-2.5 mb-3 flex items-center justify-between gap-2">
                    <span>¿Activar huella / Face ID para coordinador?</span>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={activarHuellaCoord} className="font-medium px-2.5 py-1 rounded-full bg-forest text-white">Activar</button>
                      <button onClick={() => setOfrecerActivarHuellaCoord(false)} className="text-forest/50">Ahora no</button>
                    </div>
                  </div>
                )}
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
                {busesActivos.filter((b) => b.sentido === "ida").map((bus) => {
                  const pct = Math.round((bus.ocupacion_actual / bus.capacidad_total) * 100);
                  return (
                    <div key={bus.id} className="flex justify-between items-center px-3 py-2.5 bg-cream rounded-lg mb-2">
                      <span className="text-sm text-forest">{bus.nombre} — {bus.parada_actual}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${estiloOcupacion(bus.ocupacion_actual, bus.capacidad_total).chip}`}>
                        {pct}%
                      </span>
                    </div>
                  );
                })}
                {busesActivos.filter((b) => b.sentido === "ida").length === 0 && (
                  <p className="text-xs text-forest/40 mb-3">Ningún bus subiendo ahora</p>
                )}

                <p className="text-xs text-forest/50 mb-3 mt-4">↓ Bajando hacia Av. 19</p>
                {busesActivos.filter((b) => b.sentido === "vuelta").map((bus) => {
                  const pct = Math.round((bus.ocupacion_actual / bus.capacidad_total) * 100);
                  return (
                    <div key={bus.id} className="flex justify-between items-center px-3 py-2.5 bg-cream rounded-lg mb-2">
                      <span className="text-sm text-forest">{bus.nombre} — {bus.parada_actual}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${estiloOcupacion(bus.ocupacion_actual, bus.capacidad_total).chip}`}>
                        {pct}%
                      </span>
                    </div>
                  );
                })}
                {busesActivos.filter((b) => b.sentido === "vuelta").length === 0 && (
                  <p className="text-xs text-forest/40 mb-3">Ningún bus bajando ahora</p>
                )}

                {busesActivos.filter((b) => b.necesita_refuerzo).map((bus) => {
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
                  </>
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
              {mostrarBotonInstalar && (
                <div className="text-center mt-8">
                  <p className="text-xs text-white/40 mb-3">🗺️ Hay más rutas en proceso — descarga la app</p>
                  <button
                    onClick={descargarApp}
                    className="text-sm font-medium px-6 py-3 rounded-full border border-white/30 text-white hover:bg-white/10 transition"
                  >
                    ⬇ Descargar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {!esAppInstalada && (
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
            <p>Construido por Ismael Fermín · &copy; {new Date().getFullYear()}</p>
          </div>
        </div>
      </footer>
      )}
    </>
  );
}
