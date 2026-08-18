"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient";

const CLAVE_ADMIN = "Darley.Ismaely.123456";

type Parada = {
  id: string;
  nombre: string;
  orden: number | null;
  orden_vuelta: number | null;
  latitud: number | null;
  longitud: number | null;
};

type Bus = {
  id: string;
  nombre: string;
  capacidad_total: number;
  sentido: "ida" | "vuelta";
  clave_actual: string | null;
  clave_fecha: string | null;
  clave_fija: boolean;
};

type Ruta = {
  id: string;
  nombre: string;
  slug: string;
  descripcion: string | null;
  activa: boolean;
};

const hoy = () => new Date().toISOString().slice(0, 10);

const slugify = (texto: string) =>
  texto
    .toLowerCase()
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export default function AdminPage() {
  // Empieza bloqueado en ambos lados (servidor y cliente) para evitar un
  // desajuste de hidratación; el useEffect de abajo confirma el desbloqueo
  // leyendo localStorage solo en el navegador, después del primer render.
  const [desbloqueado, setDesbloqueado] = useState(false);
  const [claveInput, setClaveInput] = useState("");
  const [claveError, setClaveError] = useState(false);

  const [paradas, setParadas] = useState<Parada[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [fijandoId, setFijandoId] = useState<string | null>(null);

  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [rutaSeleccionadaId, setRutaSeleccionadaId] = useState<string | null>(null);
  // true si la tabla "rutas" todavía no existe (falta correr la migración):
  // en ese caso el panel sigue funcionando como antes, sin filtrar por ruta.
  const [modoSinRutas, setModoSinRutas] = useState(false);
  const [nuevaRuta, setNuevaRuta] = useState({ nombre: "", slug: "", descripcion: "" });
  const [editandoRutaId, setEditandoRutaId] = useState<string | null>(null);
  const [editRuta, setEditRuta] = useState({ nombre: "", descripcion: "", activa: true });
  const [confirmandoEliminarRutaId, setConfirmandoEliminarRutaId] = useState<string | null>(null);

  const [nuevaParada, setNuevaParada] = useState({ nombre: "", lat: "", lng: "" });
  const [agregandoParada, setAgregandoParada] = useState(false);
  const [nuevoBus, setNuevoBus] = useState({ nombre: "", capacidad: "17" });

  const [editandoParadaId, setEditandoParadaId] = useState<string | null>(null);
  const [editParada, setEditParada] = useState({ nombre: "", lat: "", lng: "" });
  const [confirmandoEliminarId, setConfirmandoEliminarId] = useState<string | null>(null);
  const [editandoBusId, setEditandoBusId] = useState<string | null>(null);
  const [editBus, setEditBus] = useState({ nombre: "", capacidad: "" });
  const [confirmandoEliminarBusId, setConfirmandoEliminarBusId] = useState<string | null>(null);
  const [claveBusInput, setClaveBusInput] = useState<Record<string, string>>({});
  const [claveBusFija, setClaveBusFija] = useState<Record<string, boolean>>({});
  const [claveCoordDia, setClaveCoordDia] = useState<{ clave: string | null; fecha: string | null; fija: boolean }>({ clave: null, fecha: null, fija: false });
  const [claveCoordInput, setClaveCoordInput] = useState("");
  const [claveCoordFijaInput, setClaveCoordFijaInput] = useState(false);

  // Arrastrar para reordenar (como una playlist): "base" es la lista al
  // iniciar el arrastre, "orden" es la lista recalculada en vivo mientras se
  // mueve el dedo, y "valores" son los números que le tocan a cada puesto al
  // soltar. Hay dos grupos arrastrables por separado: el de bajada
  // (orden_vuelta, renumerado 1..N; la subida se recalcula sola como su
  // espejo, ver sincronizarSubidaDesdeBajada) y el de las excepciones que
  // solo suben (orden, sin bajada — se reparten entre ellas mismas los
  // mismos números que ya tenían, sin tocar a las demás).
  const [arrastre, setArrastre] = useState<{
    campo: "orden_vuelta" | "orden";
    pointerId: number;
    itemId: string;
    startY: number;
    rowHeight: number;
    base: Parada[];
    idxOriginal: number;
    orden: Parada[];
    valores: number[];
  } | null>(null);
  const arrastreRef = useRef(arrastre);
  useEffect(() => {
    arrastreRef.current = arrastre;
  }, [arrastre]);

  const cargarRutas = async () => {
    const { data, error } = await supabase.from("rutas").select("*").order("nombre");
    if (error) {
      setModoSinRutas(true);
      return;
    }
    const lista = (data as Ruta[]) ?? [];
    setRutas(lista);
    setRutaSeleccionadaId((prev) => (prev && lista.some((r) => r.id === prev) ? prev : lista[0]?.id ?? null));
  };

  const cargarDatos = async (rutaId?: string) => {
    const id = rutaId ?? rutaSeleccionadaId;
    if (!id && !modoSinRutas) return;
    let qp = supabase.from("paradas").select("id,nombre,orden,orden_vuelta,latitud,longitud");
    if (id) qp = qp.eq("ruta_id", id);
    const { data: p } = await qp.order("orden");
    if (p) setParadas(p as Parada[]);
    let qb = supabase.from("buses").select("*");
    if (id) qb = qb.eq("ruta_id", id);
    const { data: b } = await qb.order("nombre");
    if (b) setBuses(b as Bus[]);
    let qc = supabase.from("claves_dia").select("*").eq("rol", "coordinador");
    if (id) qc = qc.eq("ruta_id", id);
    const { data: cd } = await qc.maybeSingle();
    setClaveCoordDia({ clave: cd?.clave ?? null, fecha: cd?.fecha ?? null, fija: cd?.fija ?? false });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("admin-clave") === CLAVE_ADMIN) setDesbloqueado(true);
  }, []);

  useEffect(() => {
    if (!desbloqueado) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarRutas();
  }, [desbloqueado]);

  useEffect(() => {
    if (rutaSeleccionadaId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      cargarDatos(rutaSeleccionadaId);
    } else if (modoSinRutas) {
      cargarDatos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutaSeleccionadaId, modoSinRutas]);

  const intentarDesbloquear = () => {
    if (claveInput === CLAVE_ADMIN) {
      localStorage.setItem("admin-clave", CLAVE_ADMIN);
      setDesbloqueado(true);
      setClaveError(false);
    } else {
      setClaveError(true);
    }
  };

  const agregarRuta = async () => {
    if (!nuevaRuta.nombre.trim()) {
      setMensaje("Ponle un nombre a la ruta.");
      return;
    }
    const slug = (nuevaRuta.slug.trim() || slugify(nuevaRuta.nombre)) || `ruta-${Date.now()}`;
    const { data, error } = await supabase
      .from("rutas")
      .insert({ nombre: nuevaRuta.nombre.trim(), slug, descripcion: nuevaRuta.descripcion.trim() || null, activa: false })
      .select();
    if (error) {
      setMensaje(`Error al agregar ruta: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      setMensaje("No se pudo agregar: falta permiso en Supabase para la tabla rutas.");
      return;
    }
    setMensaje(`Ruta "${nuevaRuta.nombre}" agregada — queda "Próximamente" hasta que la actives.`);
    setNuevaRuta({ nombre: "", slug: "", descripcion: "" });
    cargarRutas();
  };

  const iniciarEdicionRuta = (r: Ruta) => {
    setEditandoRutaId(r.id);
    setEditRuta({ nombre: r.nombre, descripcion: r.descripcion ?? "", activa: r.activa });
  };

  const guardarEdicionRuta = async (id: string) => {
    if (!editRuta.nombre.trim()) {
      setMensaje("El nombre no puede quedar vacío.");
      return;
    }
    const { data, error } = await supabase
      .from("rutas")
      .update({ nombre: editRuta.nombre.trim(), descripcion: editRuta.descripcion.trim() || null, activa: editRuta.activa })
      .eq("id", id)
      .select();
    if (error) {
      setMensaje(`Error al guardar: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      setMensaje("No se guardó: falta permiso en Supabase para actualizar rutas.");
      return;
    }
    setMensaje("Ruta actualizada.");
    setEditandoRutaId(null);
    cargarRutas();
  };

  const eliminarRuta = async (id: string) => {
    const { data, error } = await supabase.from("rutas").delete().eq("id", id).select();
    if (error) {
      // Si la ruta todavía tiene paradas, unidades o claves, la base de datos
      // bloquea el borrado en vez de arrastrarlas también — hay que vaciarla
      // primero a propósito, para no perder datos reales sin querer.
      if (error.message.toLowerCase().includes("foreign key") || error.message.toLowerCase().includes("violat")) {
        setMensaje("No se puede eliminar: esta ruta todavía tiene paradas, unidades o claves. Bórralas primero desde 'Gestionando' esa ruta.");
      } else {
        setMensaje(`Error al eliminar: ${error.message}`);
      }
      return;
    }
    if (!data || data.length === 0) {
      setMensaje("No se pudo eliminar: falta el permiso en Supabase (pide el SQL de DELETE para rutas).");
      return;
    }
    setMensaje("Ruta eliminada.");
    setConfirmandoEliminarRutaId(null);
    setEditandoRutaId(null);
    if (rutaSeleccionadaId === id) setRutaSeleccionadaId(null);
    cargarRutas();
  };

  const fijarUbicacionAqui = (paradaId: string) => {
    if (!navigator.geolocation) {
      setMensaje("Este navegador no soporta geolocalización.");
      return;
    }
    setFijandoId(paradaId);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { data, error } = await supabase
          .from("paradas")
          .update({ latitud: pos.coords.latitude, longitud: pos.coords.longitude })
          .eq("id", paradaId)
          .select();
        setFijandoId(null);
        if (error) {
          setMensaje(`Error al guardar: ${error.message}`);
          return;
        }
        if (!data || data.length === 0) {
          setMensaje("No se guardó: falta permiso en Supabase para actualizar paradas.");
          return;
        }
        setMensaje("Ubicación guardada.");
        cargarDatos();
      },
      (err) => {
        setFijandoId(null);
        setMensaje(`No se pudo obtener tu ubicación: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const iniciarEdicionParada = (p: Parada) => {
    setEditandoParadaId(p.id);
    setConfirmandoEliminarId(null);
    setEditParada({
      nombre: p.nombre,
      lat: p.latitud?.toString() ?? "",
      lng: p.longitud?.toString() ?? "",
    });
  };

  const guardarEdicionParada = async (id: string) => {
    if (!editParada.nombre.trim()) {
      setMensaje("El nombre no puede quedar vacío.");
      return;
    }
    const { data, error } = await supabase
      .from("paradas")
      .update({
        nombre: editParada.nombre.trim(),
        latitud: editParada.lat ? Number(editParada.lat) : null,
        longitud: editParada.lng ? Number(editParada.lng) : null,
      })
      .eq("id", id)
      .select();
    if (error) {
      setMensaje(`Error al guardar: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      setMensaje("No se guardó: falta permiso en Supabase para actualizar paradas.");
      return;
    }
    setMensaje("Parada actualizada.");
    setEditandoParadaId(null);
    cargarDatos();
  };

  const eliminarParada = async (id: string) => {
    // .select() es necesario para poder confirmar que sí se borró una fila:
    // si los permisos (RLS) bloquean el delete, Supabase no da error, solo
    // devuelve 0 filas — sin esto, el mensaje de éxito mentiría.
    const { data, error } = await supabase.from("paradas").delete().eq("id", id).select();
    if (error) {
      setMensaje(`Error al eliminar: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      setMensaje("No se pudo eliminar: falta el permiso en Supabase (pide el SQL de DELETE).");
      return;
    }
    setMensaje("Parada eliminada.");
    setConfirmandoEliminarId(null);
    setEditandoParadaId(null);
    cargarDatos();
  };

  // La subida es, salvo excepciones, la bajada caminada al revés. Esta
  // función recalcula "orden" (subida) a partir de "orden_vuelta" (bajada):
  // toma las paradas que están en ambos sentidos ("ambos" = tienen orden Y
  // orden_vuelta) y les asigna su nuevo puesto invertido, PRESERVANDO el
  // lugar relativo de las excepciones que solo suben (Av. 3, Milla — tienen
  // orden pero no orden_vuelta, así que no aparecen en la lista de bajada y
  // no se tocan salvo por el corrimiento de las demás).
  const sincronizarSubidaDesdeBajada = async (fuente?: Parada[]) => {
    const datos = fuente ?? paradas;
    const maestra = datos.filter((p) => p.orden_vuelta !== null).sort((a, b) => (a.orden_vuelta as number) - (b.orden_vuelta as number));
    const ambosInvertido = [...maestra.filter((p) => p.orden !== null)].reverse();
    const subidaActual = datos.filter((p) => p.orden !== null).sort((a, b) => (a.orden as number) - (b.orden as number));
    const idsMaestra = new Set(maestra.map((p) => p.id));

    const resultado: string[] = [];
    let cursor = 0;
    for (const p of subidaActual) {
      if (idsMaestra.has(p.id)) {
        // Estaba (o pasa a estar) en ambos sentidos: le toca el siguiente
        // puesto de la nueva secuencia invertida de bajada.
        if (cursor < ambosInvertido.length) {
          resultado.push(ambosInvertido[cursor].id);
          cursor++;
        }
      } else {
        // Excepción "solo sube" (no está en la lista de bajada): se preserva tal cual.
        resultado.push(p.id);
      }
    }
    while (cursor < ambosInvertido.length) {
      resultado.push(ambosInvertido[cursor].id);
      cursor++;
    }

    for (let i = 0; i < resultado.length; i++) {
      const nuevoValor = i + 1;
      const actual = datos.find((p) => p.id === resultado[i]);
      if (actual && actual.orden !== nuevoValor) {
        await supabase.from("paradas").update({ orden: nuevoValor }).eq("id", resultado[i]).select();
      }
    }
    const idsFinal = new Set(resultado);
    for (const p of datos) {
      if (p.orden !== null && !idsFinal.has(p.id)) {
        await supabase.from("paradas").update({ orden: null }).eq("id", p.id).select();
      }
    }
  };

  const iniciarArrastre = (e: ReactPointerEvent, campo: "orden_vuelta" | "orden", id: string, rowEl: HTMLElement | null) => {
    e.preventDefault();
    const base =
      campo === "orden_vuelta"
        ? paradas.filter((p) => p.orden_vuelta !== null).sort((a, b) => (a.orden_vuelta as number) - (b.orden_vuelta as number))
        : paradas.filter((p) => p.orden !== null && p.orden_vuelta === null).sort((a, b) => (a.orden as number) - (b.orden as number));
    const idxOriginal = base.findIndex((p) => p.id === id);
    if (idxOriginal === -1) return;
    const rowHeight = rowEl?.getBoundingClientRect().height ?? 44;
    // Para bajada se renumera 1..N; para las excepciones solo-subida se
    // reparten entre ellas mismas los mismos números que ya tenían, sin
    // afectar el orden de subida de las demás paradas.
    const valores = campo === "orden_vuelta" ? base.map((_, i) => i + 1) : base.map((p) => p.orden as number).sort((x, y) => x - y);
    setArrastre({ campo, pointerId: e.pointerId, itemId: id, startY: e.clientY, rowHeight, base, idxOriginal, orden: base, valores });
  };

  useEffect(() => {
    if (!arrastre) return;

    const onMove = (e: PointerEvent) => {
      const a = arrastreRef.current;
      if (!a || e.pointerId !== a.pointerId) return;
      const deltaY = e.clientY - a.startY;
      const shift = Math.round(deltaY / a.rowHeight);
      const nuevoIdx = Math.max(0, Math.min(a.base.length - 1, a.idxOriginal + shift));
      const item = a.base.find((p) => p.id === a.itemId)!;
      const sinItem = a.base.filter((p) => p.id !== a.itemId);
      sinItem.splice(nuevoIdx, 0, item);
      setArrastre({ ...a, orden: sinItem });
    };

    const onUp = async (e: PointerEvent) => {
      const a = arrastreRef.current;
      if (!a || e.pointerId !== a.pointerId) return;
      setArrastre(null);
      for (let i = 0; i < a.orden.length; i++) {
        const nuevoValor = a.valores[i];
        if (a.orden[i][a.campo] !== nuevoValor) {
          const r = await supabase.from("paradas").update({ [a.campo]: nuevoValor }).eq("id", a.orden[i].id).select();
          if (r.error || !r.data || r.data.length === 0) {
            setMensaje("No se pudo guardar el nuevo orden: revisa los permisos en Supabase.");
            cargarDatos();
            return;
          }
        }
      }
      if (a.campo === "orden_vuelta") {
        const patched = paradas.map((p) => {
          const idx = a.orden.findIndex((x) => x.id === p.id);
          return idx !== -1 ? { ...p, orden_vuelta: idx + 1 } : p;
        });
        await sincronizarSubidaDesdeBajada(patched);
      }
      cargarDatos();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrastre !== null]);

  const agregarAlFinalDeOrden = async (id: string) => {
    const maestra = paradas.filter((p) => p.orden_vuelta !== null);
    const siguiente = maestra.length > 0 ? Math.max(...maestra.map((p) => p.orden_vuelta as number)) + 1 : 1;
    // orden se marca con un valor temporal no nulo solo para que la sincronización
    // la reconozca como "ambos sentidos"; sincronizarSubidaDesdeBajada la reemplaza
    // enseguida por su puesto real invertido.
    const r = await supabase.from("paradas").update({ orden_vuelta: siguiente, orden: 999999 }).eq("id", id).select();
    if (r.error || !r.data || r.data.length === 0) {
      setMensaje("No se pudo agregar al orden: revisa los permisos en Supabase.");
      return;
    }
    const patched = paradas.map((p) => (p.id === id ? { ...p, orden_vuelta: siguiente, orden: 999999 } : p));
    await sincronizarSubidaDesdeBajada(patched);
    cargarDatos();
  };

  const alternarTambienSube = async (id: string) => {
    const p = paradas.find((x) => x.id === id);
    if (!p) return;
    const nuevoValorTemporal = p.orden !== null ? null : 999999;
    const r = await supabase.from("paradas").update({ orden: nuevoValorTemporal }).eq("id", id).select();
    if (r.error || !r.data || r.data.length === 0) {
      setMensaje("No se pudo cambiar: revisa los permisos en Supabase.");
      return;
    }
    const patched = paradas.map((x) => (x.id === id ? { ...x, orden: nuevoValorTemporal } : x));
    await sincronizarSubidaDesdeBajada(patched);
    cargarDatos();
  };

  const quitarBajaDe = async (id: string) => {
    const maestra = paradas.filter((p) => p.orden_vuelta !== null).sort((a, b) => (a.orden_vuelta as number) - (b.orden_vuelta as number));
    const restante = maestra.filter((p) => p.id !== id);
    const r = await supabase.from("paradas").update({ orden_vuelta: null }).eq("id", id).select();
    if (r.error || !r.data || r.data.length === 0) {
      setMensaje("No se pudo cambiar: revisa los permisos en Supabase.");
      return;
    }
    for (let i = 0; i < restante.length; i++) {
      const nuevoValor = i + 1;
      if (restante[i].orden_vuelta !== nuevoValor) {
        await supabase.from("paradas").update({ orden_vuelta: nuevoValor }).eq("id", restante[i].id);
      }
    }
    const patched = paradas.map((p) => {
      if (p.id === id) return { ...p, orden_vuelta: null };
      const idx = restante.findIndex((r2) => r2.id === p.id);
      return idx !== -1 ? { ...p, orden_vuelta: idx + 1 } : p;
    });
    await sincronizarSubidaDesdeBajada(patched);
    cargarDatos();
  };

  // Toggles de "Sube" / "Baja" para usar directamente desde la lista de
  // Paradas: si la parada ya está en la lista maestra de bajada, reusa la
  // sincronización con espejo; si no, es un cambio aislado (agregar/quitar
  // en un solo sentido) que no afecta al otro.
  const alternarSube = async (id: string) => {
    const p = paradas.find((x) => x.id === id);
    if (!p) return;
    if (p.orden_vuelta !== null) {
      await alternarTambienSube(id);
      return;
    }
    if (p.orden !== null) {
      const r = await supabase.from("paradas").update({ orden: null }).eq("id", id).select();
      if (r.error || !r.data || r.data.length === 0) {
        setMensaje("No se pudo cambiar: revisa los permisos en Supabase.");
        return;
      }
    } else {
      const subida = paradas.filter((x) => x.orden !== null);
      const siguiente = subida.length > 0 ? Math.max(...subida.map((x) => x.orden as number)) + 1 : 1;
      const r = await supabase.from("paradas").update({ orden: siguiente }).eq("id", id).select();
      if (r.error || !r.data || r.data.length === 0) {
        setMensaje("No se pudo cambiar: revisa los permisos en Supabase.");
        return;
      }
    }
    cargarDatos();
  };

  const alternarBaja = async (id: string) => {
    const p = paradas.find((x) => x.id === id);
    if (!p) return;
    if (p.orden_vuelta !== null) {
      await quitarBajaDe(id);
    } else {
      await agregarAlFinalDeOrden(id);
    }
  };

  const iniciarEdicionBus = (b: Bus) => {
    setEditandoBusId(b.id);
    setConfirmandoEliminarBusId(null);
    setEditBus({ nombre: b.nombre, capacidad: b.capacidad_total.toString() });
  };

  const guardarEdicionBus = async (id: string) => {
    if (!editBus.nombre.trim() || !editBus.capacidad) {
      setMensaje("Completa nombre y capacidad.");
      return;
    }
    const { data, error } = await supabase
      .from("buses")
      .update({ nombre: editBus.nombre.trim(), capacidad_total: Number(editBus.capacidad) })
      .eq("id", id)
      .select();
    if (error) {
      setMensaje(`Error al guardar: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      setMensaje("No se guardó: falta permiso en Supabase para actualizar buses.");
      return;
    }
    setMensaje("Unidad actualizada.");
    setEditandoBusId(null);
    cargarDatos();
  };

  const eliminarBus = async (id: string) => {
    const { data, error } = await supabase.from("buses").delete().eq("id", id).select();
    if (error) {
      setMensaje(`Error al eliminar: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      setMensaje("No se pudo eliminar: falta el permiso en Supabase (pide el SQL de DELETE para buses).");
      return;
    }
    setMensaje("Unidad eliminada.");
    setConfirmandoEliminarBusId(null);
    setEditandoBusId(null);
    cargarDatos();
  };

  const generarClaveAleatoria = () => String(Math.floor(1000 + Math.random() * 9000));

  const asignarClaveBus = async (busId: string) => {
    const bus = buses.find((b) => b.id === busId);
    const claveActual = bus?.clave_fecha === hoy() ? bus?.clave_actual ?? "" : "";
    const clave = (claveBusInput[busId] ?? claveActual).trim();
    if (!clave) {
      setMensaje("Escribe o genera una clave antes de asignarla.");
      return;
    }
    const fija = claveBusFija[busId] ?? bus?.clave_fija ?? false;
    // Al asignar clave, la unidad queda oculta del mapa (activo: false) hasta
    // que el piloto de turno entre con esa clave — así no depende de que
    // alguien se acuerde de tocar "Salir de la línea" al rotar turnos.
    const { data, error } = await supabase
      .from("buses")
      .update({ clave_actual: clave, clave_fecha: hoy(), clave_fija: fija, activo: false })
      .eq("id", busId)
      .select();
    if (error) {
      setMensaje(`Error al asignar clave: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      setMensaje("No se pudo asignar: falta permiso en Supabase para actualizar buses.");
      return;
    }
    setMensaje(fija ? "Clave fija asignada a la unidad (no vence sola)." : "Clave de hoy asignada a la unidad.");
    setClaveBusInput((prev) => ({ ...prev, [busId]: "" }));
    cargarDatos();
  };

  const asignarClaveCoordinador = async () => {
    if (!rutaSeleccionadaId && !modoSinRutas) {
      setMensaje("Elige primero qué ruta estás gestionando.");
      return;
    }
    const claveActual = claveCoordDia.fecha === hoy() ? claveCoordDia.clave ?? "" : "";
    const clave = (claveCoordInput || claveActual).trim();
    if (!clave) {
      setMensaje("Escribe o genera una clave antes de asignarla.");
      return;
    }
    const fija = claveCoordFijaInput || claveCoordDia.fija;
    const payload: Record<string, unknown> = { rol: "coordinador", clave, fecha: hoy(), fija };
    if (rutaSeleccionadaId) payload.ruta_id = rutaSeleccionadaId;
    const { data, error } = await supabase
      .from("claves_dia")
      .upsert(payload, { onConflict: rutaSeleccionadaId ? "ruta_id,rol" : "rol" })
      .select();
    if (error) {
      setMensaje(`Error al asignar clave: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      setMensaje("No se pudo asignar: falta permiso en Supabase para la tabla claves_dia.");
      return;
    }
    setMensaje(fija ? "Clave fija asignada al coordinador (no vence sola)." : "Clave de hoy asignada al coordinador.");
    setClaveCoordInput("");
    cargarDatos();
  };

  const obtenerUbicacionActual = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

  const agregarParada = async () => {
    if (!nuevaParada.nombre.trim()) {
      setMensaje("Ponle un nombre a la parada.");
      return;
    }
    if (!rutaSeleccionadaId && !modoSinRutas) {
      setMensaje("Elige primero qué ruta estás gestionando.");
      return;
    }
    setAgregandoParada(true);

    let lat: number | null = null;
    let lng: number | null = null;
    let origenUbicacion: "manual" | "gps" | "ninguna" = "ninguna";

    if (nuevaParada.lat.trim() && nuevaParada.lng.trim()) {
      lat = Number(nuevaParada.lat);
      lng = Number(nuevaParada.lng);
      origenUbicacion = "manual";
    } else {
      const ubicacion = await obtenerUbicacionActual();
      if (ubicacion) {
        lat = ubicacion.lat;
        lng = ubicacion.lng;
        origenUbicacion = "gps";
      }
    }

    const paradaPayload: Record<string, unknown> = {
      nombre: nuevaParada.nombre.trim(),
      orden: null,
      orden_vuelta: null,
      latitud: lat,
      longitud: lng,
    };
    if (rutaSeleccionadaId) paradaPayload.ruta_id = rutaSeleccionadaId;
    const { error } = await supabase.from("paradas").insert(paradaPayload);
    setAgregandoParada(false);
    if (error) {
      setMensaje(`Error al agregar parada: ${error.message}`);
      return;
    }
    setMensaje(
      (origenUbicacion === "manual"
        ? `Parada "${nuevaParada.nombre}" agregada con la coordenada que escribiste.`
        : origenUbicacion === "gps"
        ? `Parada "${nuevaParada.nombre}" agregada con tu ubicación actual.`
        : `Parada "${nuevaParada.nombre}" agregada sin ubicación (no se pudo obtener tu GPS) — usa "Fijar aquí" o escribe la coordenada manual después.`) +
        " Agrégala al orden de subida/bajada abajo."
    );
    setNuevaParada({ nombre: "", lat: "", lng: "" });
    cargarDatos();
  };

  const agregarBus = async () => {
    if (!nuevoBus.nombre.trim()) {
      setMensaje("Ponle un nombre a la unidad.");
      return;
    }
    if (!rutaSeleccionadaId && !modoSinRutas) {
      setMensaje("Elige primero qué ruta estás gestionando.");
      return;
    }
    const busPayload: Record<string, unknown> = {
      nombre: nuevoBus.nombre.trim(),
      capacidad_total: Number(nuevoBus.capacidad) || 17,
      ocupacion_actual: 0,
      sentido: "ida",
      parada_orden: 1,
      necesita_refuerzo: false,
    };
    if (rutaSeleccionadaId) busPayload.ruta_id = rutaSeleccionadaId;
    const { error } = await supabase.from("buses").insert(busPayload);
    if (error) {
      setMensaje(`Error al agregar unidad: ${error.message}`);
      return;
    }
    setMensaje(`Unidad "${nuevoBus.nombre}" agregada.`);
    setNuevoBus({ nombre: "", capacidad: "17" });
    cargarDatos();
  };

  if (!desbloqueado) {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center px-6">
        <div className="max-w-sm w-full">
          <p className="font-display text-2xl text-forest mb-4 text-center">Next Route — Panel de administrador</p>
          <input
            type="password"
            value={claveInput}
            onChange={(e) => { setClaveInput(e.target.value); setClaveError(false); }}
            onKeyDown={(e) => e.key === "Enter" && intentarDesbloquear()}
            placeholder="Clave"
            className="w-full mb-2 text-sm text-forest bg-paper border border-forest/15 rounded-lg px-3 py-2"
          />
          {claveError && <p className="text-xs text-terracotta mb-2">Clave incorrecta.</p>}
          <button onClick={intentarDesbloquear} className="w-full py-2.5 rounded-full bg-forest text-white text-sm font-medium">
            Entrar
          </button>
          <Link href="/" className="block text-center text-xs text-forest/50 mt-4 hover:text-forest transition">
            &larr; Volver al inicio
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-cream px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-xs text-forest/50 hover:text-forest transition">&larr; Next Route</Link>
        <h1 className="font-display text-3xl text-forest mb-1 mt-2">Panel de administrador</h1>
        <p className="text-sm text-forest/50 mb-6">
          Gestionando: <span className="font-medium text-forest">{rutas.find((r) => r.id === rutaSeleccionadaId)?.nombre ?? (modoSinRutas ? "Ruta del Valle" : "—")}</span>
        </p>

        {mensaje && (
          <div className="bg-teal/15 text-teal-dark text-sm rounded-lg px-4 py-2.5 mb-6 flex justify-between items-center">
            <span>{mensaje}</span>
            <button onClick={() => setMensaje(null)} className="text-teal-dark/60 hover:text-teal-dark ml-3">✕</button>
          </div>
        )}

        <section className="bg-paper border border-forest/10 rounded-2xl p-5 mb-6">
          <h2 className="font-display text-lg text-forest mb-3">Rutas</h2>
          <p className="text-xs text-forest/50 mb-3">Toca una ruta para gestionarla (paradas, unidades y claves de abajo aplican a la que esté seleccionada).</p>
          <div className="space-y-2 mb-4">
            {rutas.map((r) =>
              editandoRutaId === r.id ? (
                <div key={r.id} className="px-3 py-2.5 bg-cream rounded-lg text-sm space-y-2">
                  <input
                    value={editRuta.nombre}
                    onChange={(e) => setEditRuta({ ...editRuta, nombre: e.target.value })}
                    placeholder="Nombre"
                    className="w-full text-sm border border-forest/15 rounded-lg px-3 py-1.5"
                  />
                  <input
                    value={editRuta.descripcion}
                    onChange={(e) => setEditRuta({ ...editRuta, descripcion: e.target.value })}
                    placeholder="Descripción corta (opcional)"
                    className="w-full text-sm border border-forest/15 rounded-lg px-3 py-1.5"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-forest/60">
                    <input
                      type="checkbox"
                      checked={editRuta.activa}
                      onChange={(e) => setEditRuta({ ...editRuta, activa: e.target.checked })}
                    />
                    Activa (visible para elegir; si no, sale como &quot;Próximamente&quot;)
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => guardarEdicionRuta(r.id)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full bg-forest text-white">
                      Guardar
                    </button>
                    <button onClick={() => setEditandoRutaId(null)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full border border-forest/20 text-forest">
                      Cancelar
                    </button>
                  </div>
                  {confirmandoEliminarRutaId === r.id ? (
                    <div className="flex gap-2 items-center pt-1">
                      <span className="text-xs text-red-600 flex-1">¿Eliminar &quot;{r.nombre}&quot;? No se puede deshacer.</span>
                      <button onClick={() => eliminarRuta(r.id)} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full bg-red-600 text-white">
                        Sí, eliminar
                      </button>
                      <button onClick={() => setConfirmandoEliminarRutaId(null)} className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border border-forest/20 text-forest">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmandoEliminarRutaId(r.id)}
                      className="text-xs font-medium text-red-600/70 hover:text-red-600 pt-1"
                    >
                      Eliminar ruta
                    </button>
                  )}
                </div>
              ) : (
                <div
                  key={r.id}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm ${
                    r.id === rutaSeleccionadaId ? "bg-forest/10 ring-1 ring-forest/30" : "bg-cream"
                  }`}
                >
                  <button onClick={() => setRutaSeleccionadaId(r.id)} className="text-left flex-1 min-w-0">
                    <span className="text-forest font-medium">{r.nombre}</span>
                    {!r.activa && <span className="ml-2 text-xs text-forest/40">Próximamente</span>}
                  </button>
                  <button
                    onClick={() => iniciarEdicionRuta(r)}
                    className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border border-forest/20 text-forest hover:bg-forest/5 transition"
                  >
                    editar
                  </button>
                </div>
              )
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              value={nuevaRuta.nombre}
              onChange={(e) => setNuevaRuta({ ...nuevaRuta, nombre: e.target.value })}
              placeholder="Nombre (ej: Los Chorros)"
              className="col-span-2 sm:col-span-1 text-sm border border-forest/15 rounded-lg px-3 py-2"
            />
            <input
              value={nuevaRuta.descripcion}
              onChange={(e) => setNuevaRuta({ ...nuevaRuta, descripcion: e.target.value })}
              placeholder="Descripción corta (opcional)"
              className="text-sm border border-forest/15 rounded-lg px-3 py-2"
            />
          </div>
          <button onClick={agregarRuta} className="text-sm font-medium px-4 py-2 rounded-full bg-forest text-white hover:bg-forest-dark transition">
            Agregar ruta
          </button>
        </section>

        <section className="bg-paper border border-forest/10 rounded-2xl p-5 mb-6">
          <h2 className="font-display text-lg text-forest mb-3">Agregar parada</h2>
          <p className="text-xs text-forest/50 mb-3">
            Párate en el sitio físico antes de agregarla — se captura tu ubicación GPS automáticamente.
            Si no hay buena señal, escribe la coordenada manual abajo (opcional).
          </p>
          <div className="mb-2">
            <input
              value={nuevaParada.nombre}
              onChange={(e) => setNuevaParada({ ...nuevaParada, nombre: e.target.value })}
              placeholder="Nombre"
              className="w-full text-sm border border-forest/15 rounded-lg px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <input
              value={nuevaParada.lat}
              onChange={(e) => setNuevaParada({ ...nuevaParada, lat: e.target.value })}
              placeholder="Latitud (opcional)"
              type="text"
              inputMode="decimal"
              className="text-sm border border-forest/15 rounded-lg px-3 py-2"
            />
            <input
              value={nuevaParada.lng}
              onChange={(e) => setNuevaParada({ ...nuevaParada, lng: e.target.value })}
              placeholder="Longitud (opcional)"
              type="text"
              inputMode="decimal"
              className="text-sm border border-forest/15 rounded-lg px-3 py-2"
            />
          </div>
          <button
            onClick={agregarParada}
            disabled={agregandoParada}
            className="text-sm font-medium px-4 py-2 rounded-full bg-forest text-white hover:bg-forest-dark transition disabled:opacity-50"
          >
            {agregandoParada ? "Ubicando..." : "Agregar parada"}
          </button>
        </section>

        {(() => {
          const enOrdenBase = paradas.filter((p) => p.orden_vuelta !== null).sort((a, b) => (a.orden_vuelta as number) - (b.orden_vuelta as number));
          const enOrden = arrastre?.campo === "orden_vuelta" ? arrastre.orden : enOrdenBase;
          const soloSubidaBase = paradas.filter((p) => p.orden !== null && p.orden_vuelta === null).sort((a, b) => (a.orden as number) - (b.orden as number));
          const soloSubida = arrastre?.campo === "orden" ? arrastre.orden : soloSubidaBase;
          const sinNada = paradas.filter((p) => p.orden === null && p.orden_vuelta === null);
          const listaCompleta = [...enOrden, ...soloSubida, ...sinNada];
          return (
        <section className="bg-paper border border-forest/10 rounded-2xl p-5 mb-6">
          <h2 className="font-display text-lg text-forest mb-1">Paradas ({paradas.length})</h2>
          <p className="text-xs text-forest/50 mb-3">
            Arrastra ☰ en el orden real en que se camina bajando (Hotel → Av. 19) — la subida se acomoda sola, al revés.
            Toca ↑ sube / ↓ baja para marcar en qué sentido va cada parada.
          </p>
          <div className="space-y-2 max-h-[32rem] overflow-y-auto" style={{ touchAction: arrastre ? "none" : undefined }}>
            {listaCompleta.map((p, i) =>
              editandoParadaId === p.id ? (
                <div key={p.id} className="px-3 py-2.5 bg-cream rounded-lg text-sm space-y-2">
                  <input
                    value={editParada.nombre}
                    onChange={(e) => setEditParada({ ...editParada, nombre: e.target.value })}
                    placeholder="Nombre"
                    className="w-full text-sm border border-forest/15 rounded-lg px-3 py-1.5"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={editParada.lat}
                      onChange={(e) => setEditParada({ ...editParada, lat: e.target.value })}
                      placeholder="Latitud"
                      type="text"
                      inputMode="decimal"
                      className="text-sm border border-forest/15 rounded-lg px-3 py-1.5"
                    />
                    <input
                      value={editParada.lng}
                      onChange={(e) => setEditParada({ ...editParada, lng: e.target.value })}
                      placeholder="Longitud"
                      type="text"
                      inputMode="decimal"
                      className="text-sm border border-forest/15 rounded-lg px-3 py-1.5"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => guardarEdicionParada(p.id)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full bg-forest text-white">
                      Guardar
                    </button>
                    <button onClick={() => setEditandoParadaId(null)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full border border-forest/20 text-forest">
                      Cancelar
                    </button>
                  </div>
                  {confirmandoEliminarId === p.id ? (
                    <div className="flex gap-2 pt-1 border-t border-forest/10 mt-1">
                      <button onClick={() => eliminarParada(p.id)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full bg-terracotta text-white">
                        Sí, eliminar
                      </button>
                      <button onClick={() => setConfirmandoEliminarId(null)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full border border-forest/20 text-forest">
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmandoEliminarId(p.id)}
                      className="w-full text-xs font-medium px-3 py-1.5 rounded-full border border-terracotta text-terracotta hover:bg-terracotta/10 transition"
                    >
                      🗑 Eliminar parada
                    </button>
                  )}
                </div>
              ) : (
                <div
                  key={p.id}
                  data-row
                  className={`flex flex-col gap-1.5 px-3 py-2 bg-cream rounded-lg text-sm ${arrastre?.itemId === p.id ? "shadow-md ring-2 ring-forest/30" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    {p.orden_vuelta !== null ? (
                      <>
                        <button
                          onPointerDown={(e) => iniciarArrastre(e, "orden_vuelta", p.id, e.currentTarget.closest("[data-row]") as HTMLElement)}
                          style={{ touchAction: "none" }}
                          className="shrink-0 w-7 h-7 rounded-full text-forest/50 cursor-grab active:cursor-grabbing select-none"
                        >
                          ☰
                        </button>
                        <span className="text-forest/40 text-xs w-5 shrink-0">{i + 1}.</span>
                      </>
                    ) : p.orden !== null ? (
                      <>
                        <button
                          onPointerDown={(e) => iniciarArrastre(e, "orden", p.id, e.currentTarget.closest("[data-row]") as HTMLElement)}
                          style={{ touchAction: "none" }}
                          className="shrink-0 w-7 h-7 rounded-full text-forest/50 cursor-grab active:cursor-grabbing select-none"
                        >
                          ☰
                        </button>
                        <span className="text-forest/40 text-xs w-5 shrink-0">{soloSubida.findIndex((x) => x.id === p.id) + 1}.</span>
                      </>
                    ) : (
                      <span className="w-7 shrink-0" />
                    )}
                    <button onClick={() => iniciarEdicionParada(p)} className="text-left flex-1 min-w-0">
                      <p className="text-forest font-medium hover:underline">{p.nombre}</p>
                    </button>
                    <button
                      onClick={() => fijarUbicacionAqui(p.id)}
                      disabled={fijandoId === p.id}
                      className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border border-terracotta text-terracotta hover:bg-terracotta/10 transition disabled:opacity-50"
                    >
                      {fijandoId === p.id ? "Ubicando..." : p.latitud !== null ? "📍 Recalibrar" : "📍 Fijar aquí"}
                    </button>
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5 pl-9">
                    <span className="text-forest/40 text-xs">
                      {p.latitud !== null ? `${p.latitud.toFixed(5)}, ${p.longitud?.toFixed(5)}` : "sin ubicar"}
                    </span>
                    <button
                      onClick={() => alternarSube(p.id)}
                      className={`text-xs font-medium px-2 py-0.5 rounded-full border transition ${
                        p.orden !== null ? "border-teal text-teal-dark bg-teal/10" : "border-forest/20 text-forest/40"
                      }`}
                    >
                      ↑ sube{p.orden !== null ? ` (${p.orden})` : ""}
                    </button>
                    <button
                      onClick={() => alternarBaja(p.id)}
                      className={`text-xs font-medium px-2 py-0.5 rounded-full border transition ${
                        p.orden_vuelta !== null ? "border-teal text-teal-dark bg-teal/10" : "border-forest/20 text-forest/40"
                      }`}
                    >
                      ↓ baja{p.orden_vuelta !== null ? ` (${p.orden_vuelta})` : ""}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </section>
          );
        })()}

        <section className="bg-paper border border-forest/10 rounded-2xl p-5 mb-6">
          <h2 className="font-display text-lg text-forest mb-3">Agregar unidad</h2>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <input
              value={nuevoBus.nombre}
              onChange={(e) => setNuevoBus({ ...nuevoBus, nombre: e.target.value })}
              placeholder="Nombre (ej: Unidad 06)"
              className="text-sm border border-forest/15 rounded-lg px-3 py-2"
            />
            <input
              value={nuevoBus.capacidad}
              onChange={(e) => setNuevoBus({ ...nuevoBus, capacidad: e.target.value })}
              placeholder="Capacidad"
              type="number"
              className="text-sm border border-forest/15 rounded-lg px-3 py-2"
            />
          </div>
          <button onClick={agregarBus} className="text-sm font-medium px-4 py-2 rounded-full bg-forest text-white hover:bg-forest-dark transition">
            Agregar unidad
          </button>
        </section>

        <section className="bg-paper border border-forest/10 rounded-2xl p-5">
          <h2 className="font-display text-lg text-forest mb-3">Unidades ({buses.length})</h2>
          <div className="space-y-2">
            {buses.map((b) =>
              editandoBusId === b.id ? (
                <div key={b.id} className="px-3 py-2.5 bg-cream rounded-lg text-sm space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={editBus.nombre}
                      onChange={(e) => setEditBus({ ...editBus, nombre: e.target.value })}
                      placeholder="Nombre"
                      className="text-sm border border-forest/15 rounded-lg px-3 py-1.5"
                    />
                    <input
                      value={editBus.capacidad}
                      onChange={(e) => setEditBus({ ...editBus, capacidad: e.target.value })}
                      placeholder="Capacidad"
                      type="number"
                      className="text-sm border border-forest/15 rounded-lg px-3 py-1.5"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => guardarEdicionBus(b.id)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full bg-forest text-white">
                      Guardar
                    </button>
                    <button onClick={() => setEditandoBusId(null)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full border border-forest/20 text-forest">
                      Cancelar
                    </button>
                  </div>
                  <div className="pt-2 border-t border-forest/10">
                    <p className="text-xs text-forest/50 mb-1.5">Clave para el piloto de esta unidad:</p>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${
                          b.clave_fija || b.clave_fecha === hoy() ? "border-teal text-teal-dark bg-teal/10" : "border-forest/20 text-forest/40"
                        }`}
                      >
                        {b.clave_fija ? "Fija ✓" : b.clave_fecha === hoy() ? "Hoy ✓" : "Sin asignar"}
                      </span>
                      <input
                        value={claveBusInput[b.id] ?? (b.clave_fija || b.clave_fecha === hoy() ? b.clave_actual ?? "" : "")}
                        onChange={(e) => setClaveBusInput((prev) => ({ ...prev, [b.id]: e.target.value }))}
                        placeholder="Clave"
                        className="flex-1 min-w-0 text-xs border border-forest/15 rounded-lg px-2 py-1"
                      />
                      <button
                        onClick={() => setClaveBusInput((prev) => ({ ...prev, [b.id]: generarClaveAleatoria() }))}
                        title="Generar clave aleatoria"
                        className="shrink-0 text-xs px-2 py-1 rounded-lg border border-forest/20 text-forest hover:bg-forest/5 transition"
                      >
                        🎲
                      </button>
                      <button
                        onClick={() => asignarClaveBus(b.id)}
                        className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-lg bg-forest text-white hover:bg-forest-dark transition"
                      >
                        Asignar
                      </button>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-forest/60">
                      <input
                        type="checkbox"
                        checked={claveBusFija[b.id] ?? b.clave_fija}
                        onChange={(e) => setClaveBusFija((prev) => ({ ...prev, [b.id]: e.target.checked }))}
                      />
                      Sin vencimiento (no pedirle clave nueva cada día)
                    </label>
                  </div>
                  {confirmandoEliminarBusId === b.id ? (
                    <div className="flex gap-2 pt-1 border-t border-forest/10 mt-1">
                      <button onClick={() => eliminarBus(b.id)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full bg-terracotta text-white">
                        Sí, eliminar
                      </button>
                      <button onClick={() => setConfirmandoEliminarBusId(null)} className="flex-1 text-xs font-medium px-3 py-1.5 rounded-full border border-forest/20 text-forest">
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmandoEliminarBusId(b.id)}
                      className="w-full text-xs font-medium px-3 py-1.5 rounded-full border border-terracotta text-terracotta hover:bg-terracotta/10 transition"
                    >
                      🗑 Eliminar unidad
                    </button>
                  )}
                </div>
              ) : (
                <button
                  key={b.id}
                  onClick={() => iniciarEdicionBus(b)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-cream rounded-lg text-sm hover:bg-forest/5 transition text-left"
                >
                  <span className="text-forest">{b.nombre}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                        b.clave_fija || b.clave_fecha === hoy() ? "border-teal text-teal-dark bg-teal/10" : "border-forest/20 text-forest/40"
                      }`}
                    >
                      {b.clave_fija ? "Clave fija" : b.clave_fecha === hoy() ? "Clave hoy" : "Sin clave"}
                    </span>
                    <span className="text-forest/50 text-xs">{b.capacidad_total} puestos · editar</span>
                  </span>
                </button>
              )
            )}
          </div>
        </section>

        <section className="bg-paper border border-forest/10 rounded-2xl p-5 mt-6">
          <h2 className="font-display text-lg text-forest mb-1">Clave del coordinador</h2>
          <p className="text-xs text-forest/50 mb-3">
            Por defecto vence cada día. Marca &quot;sin vencimiento&quot; si prefieres que dure hasta que tú la cambies.
          </p>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                claveCoordDia.fija || claveCoordDia.fecha === hoy() ? "border-teal text-teal-dark bg-teal/10" : "border-forest/20 text-forest/40"
              }`}
            >
              {claveCoordDia.fija ? `Fija: ${claveCoordDia.clave}` : claveCoordDia.fecha === hoy() ? `Hoy: ${claveCoordDia.clave}` : "Sin clave"}
            </span>
            <input
              value={claveCoordInput || (claveCoordDia.fija || claveCoordDia.fecha === hoy() ? claveCoordDia.clave ?? "" : "")}
              onChange={(e) => setClaveCoordInput(e.target.value)}
              placeholder="Nueva clave"
              className="flex-1 min-w-0 text-xs border border-forest/15 rounded-lg px-2 py-1"
            />
            <button
              onClick={() => setClaveCoordInput(generarClaveAleatoria())}
              title="Generar clave aleatoria"
              className="shrink-0 text-xs px-2 py-1 rounded-lg border border-forest/20 text-forest hover:bg-forest/5 transition"
            >
              🎲
            </button>
            <button
              onClick={asignarClaveCoordinador}
              className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-lg bg-forest text-white hover:bg-forest-dark transition"
            >
              Asignar
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-forest/60">
            <input
              type="checkbox"
              checked={claveCoordFijaInput || claveCoordDia.fija}
              onChange={(e) => setClaveCoordFijaInput(e.target.checked)}
            />
            Sin vencimiento (no pedirle clave nueva cada día)
          </label>
        </section>
      </div>
    </main>
  );
}
