"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient";

const CLAVE_ADMIN = "Ismael.1234";

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
};

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

  const [nuevaParada, setNuevaParada] = useState({ nombre: "", orden: "", orden_vuelta: "", lat: "", lng: "" });
  const [agregandoParada, setAgregandoParada] = useState(false);
  const [nuevoBus, setNuevoBus] = useState({ nombre: "", capacidad: "17" });

  const [editandoParadaId, setEditandoParadaId] = useState<string | null>(null);
  const [editParada, setEditParada] = useState({ nombre: "", orden: "", orden_vuelta: "", lat: "", lng: "" });
  const [confirmandoEliminarId, setConfirmandoEliminarId] = useState<string | null>(null);
  const [editandoBusId, setEditandoBusId] = useState<string | null>(null);
  const [editBus, setEditBus] = useState({ nombre: "", capacidad: "" });

  const cargarDatos = async () => {
    const { data: p } = await supabase.from("paradas").select("id,nombre,orden,orden_vuelta,latitud,longitud").order("orden");
    if (p) setParadas(p as Parada[]);
    const { data: b } = await supabase.from("buses").select("id,nombre,capacidad_total,sentido").order("nombre");
    if (b) setBuses(b as Bus[]);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("admin-clave") === CLAVE_ADMIN) setDesbloqueado(true);
  }, []);

  useEffect(() => {
    if (!desbloqueado) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarDatos();
  }, [desbloqueado]);

  const intentarDesbloquear = () => {
    if (claveInput === CLAVE_ADMIN) {
      localStorage.setItem("admin-clave", CLAVE_ADMIN);
      setDesbloqueado(true);
      setClaveError(false);
    } else {
      setClaveError(true);
    }
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
      orden: p.orden?.toString() ?? "",
      orden_vuelta: p.orden_vuelta?.toString() ?? "",
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
        orden: editParada.orden ? Number(editParada.orden) : null,
        orden_vuelta: editParada.orden_vuelta ? Number(editParada.orden_vuelta) : null,
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

  const iniciarEdicionBus = (b: Bus) => {
    setEditandoBusId(b.id);
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

    const { error } = await supabase.from("paradas").insert({
      nombre: nuevaParada.nombre.trim(),
      orden: nuevaParada.orden ? Number(nuevaParada.orden) : null,
      orden_vuelta: nuevaParada.orden_vuelta ? Number(nuevaParada.orden_vuelta) : null,
      latitud: lat,
      longitud: lng,
    });
    setAgregandoParada(false);
    if (error) {
      setMensaje(`Error al agregar parada: ${error.message}`);
      return;
    }
    setMensaje(
      origenUbicacion === "manual"
        ? `Parada "${nuevaParada.nombre}" agregada con la coordenada que escribiste.`
        : origenUbicacion === "gps"
        ? `Parada "${nuevaParada.nombre}" agregada con tu ubicación actual.`
        : `Parada "${nuevaParada.nombre}" agregada sin ubicación (no se pudo obtener tu GPS) — usa "Fijar aquí" o escribe la coordenada manual después.`
    );
    setNuevaParada({ nombre: "", orden: "", orden_vuelta: "", lat: "", lng: "" });
    cargarDatos();
  };

  const agregarBus = async () => {
    if (!nuevoBus.nombre.trim()) {
      setMensaje("Ponle un nombre a la unidad.");
      return;
    }
    const { error } = await supabase.from("buses").insert({
      nombre: nuevoBus.nombre.trim(),
      capacidad_total: Number(nuevoBus.capacidad) || 17,
      ocupacion_actual: 0,
      sentido: "ida",
      parada_orden: 1,
      necesita_refuerzo: false,
    });
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
          <p className="font-display text-2xl text-forest mb-4 text-center">Panel de administrador</p>
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
        <Link href="/" className="text-xs text-forest/50 hover:text-forest transition">&larr; Ruta del Valle</Link>
        <h1 className="font-display text-3xl text-forest mb-6 mt-2">Panel de administrador</h1>

        {mensaje && (
          <div className="bg-teal/15 text-teal-dark text-sm rounded-lg px-4 py-2.5 mb-6 flex justify-between items-center">
            <span>{mensaje}</span>
            <button onClick={() => setMensaje(null)} className="text-teal-dark/60 hover:text-teal-dark ml-3">✕</button>
          </div>
        )}

        <section className="bg-paper border border-forest/10 rounded-2xl p-5 mb-6">
          <h2 className="font-display text-lg text-forest mb-3">Agregar parada</h2>
          <p className="text-xs text-forest/50 mb-3">
            Párate en el sitio físico antes de agregarla — se captura tu ubicación GPS automáticamente.
            Si no hay buena señal, escribe la coordenada manual abajo (opcional).
          </p>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <input
              value={nuevaParada.nombre}
              onChange={(e) => setNuevaParada({ ...nuevaParada, nombre: e.target.value })}
              placeholder="Nombre"
              className="col-span-3 sm:col-span-1 text-sm border border-forest/15 rounded-lg px-3 py-2"
            />
            <input
              value={nuevaParada.orden}
              onChange={(e) => setNuevaParada({ ...nuevaParada, orden: e.target.value })}
              placeholder="Orden subida"
              type="number"
              className="text-sm border border-forest/15 rounded-lg px-3 py-2"
            />
            <input
              value={nuevaParada.orden_vuelta}
              onChange={(e) => setNuevaParada({ ...nuevaParada, orden_vuelta: e.target.value })}
              placeholder="Orden bajada"
              type="number"
              className="text-sm border border-forest/15 rounded-lg px-3 py-2"
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

        <section className="bg-paper border border-forest/10 rounded-2xl p-5 mb-6">
          <h2 className="font-display text-lg text-forest mb-3">Paradas ({paradas.length})</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {paradas.map((p) =>
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
                      value={editParada.orden}
                      onChange={(e) => setEditParada({ ...editParada, orden: e.target.value })}
                      placeholder="Orden subida"
                      type="number"
                      className="text-sm border border-forest/15 rounded-lg px-3 py-1.5"
                    />
                    <input
                      value={editParada.orden_vuelta}
                      onChange={(e) => setEditParada({ ...editParada, orden_vuelta: e.target.value })}
                      placeholder="Orden bajada"
                      type="number"
                      className="text-sm border border-forest/15 rounded-lg px-3 py-1.5"
                    />
                  </div>
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
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-cream rounded-lg text-sm">
                  <button onClick={() => iniciarEdicionParada(p)} className="text-left flex-1 min-w-0">
                    <p className="text-forest font-medium hover:underline">{p.nombre}</p>
                    <p className="text-forest/50 text-xs">
                      subida {p.orden ?? "—"} · bajada {p.orden_vuelta ?? "—"} ·{" "}
                      {p.latitud !== null ? `${p.latitud.toFixed(5)}, ${p.longitud?.toFixed(5)}` : "sin ubicar"}
                    </p>
                  </button>
                  <button
                    onClick={() => fijarUbicacionAqui(p.id)}
                    disabled={fijandoId === p.id}
                    className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border border-terracotta text-terracotta hover:bg-terracotta/10 transition disabled:opacity-50"
                  >
                    {fijandoId === p.id ? "Ubicando..." : p.latitud !== null ? "📍 Recalibrar" : "📍 Fijar aquí"}
                  </button>
                </div>
              )
            )}
          </div>
        </section>

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
                </div>
              ) : (
                <button
                  key={b.id}
                  onClick={() => iniciarEdicionBus(b)}
                  className="w-full flex justify-between px-3 py-2 bg-cream rounded-lg text-sm hover:bg-forest/5 transition"
                >
                  <span className="text-forest">{b.nombre}</span>
                  <span className="text-forest/50">{b.capacidad_total} puestos · editar</span>
                </button>
              )
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
