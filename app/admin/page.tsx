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

  const [nuevaParada, setNuevaParada] = useState({ nombre: "", orden: "", orden_vuelta: "" });
  const [nuevoBus, setNuevoBus] = useState({ nombre: "", capacidad: "17" });

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
        const { error } = await supabase
          .from("paradas")
          .update({ latitud: pos.coords.latitude, longitud: pos.coords.longitude })
          .eq("id", paradaId);
        setFijandoId(null);
        if (error) {
          setMensaje(`Error al guardar: ${error.message}`);
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

  const agregarParada = async () => {
    if (!nuevaParada.nombre.trim()) {
      setMensaje("Ponle un nombre a la parada.");
      return;
    }
    const { error } = await supabase.from("paradas").insert({
      nombre: nuevaParada.nombre.trim(),
      orden: nuevaParada.orden ? Number(nuevaParada.orden) : null,
      orden_vuelta: nuevaParada.orden_vuelta ? Number(nuevaParada.orden_vuelta) : null,
    });
    if (error) {
      setMensaje(`Error al agregar parada: ${error.message}`);
      return;
    }
    setMensaje(`Parada "${nuevaParada.nombre}" agregada. Ahora ve al sitio físico y usa "Fijar aquí".`);
    setNuevaParada({ nombre: "", orden: "", orden_vuelta: "" });
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
          <div className="grid grid-cols-3 gap-2 mb-3">
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
          <button onClick={agregarParada} className="text-sm font-medium px-4 py-2 rounded-full bg-forest text-white hover:bg-forest-dark transition">
            Agregar parada
          </button>
        </section>

        <section className="bg-paper border border-forest/10 rounded-2xl p-5 mb-6">
          <h2 className="font-display text-lg text-forest mb-3">Paradas ({paradas.length})</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {paradas.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-cream rounded-lg text-sm">
                <div>
                  <p className="text-forest font-medium">{p.nombre}</p>
                  <p className="text-forest/50 text-xs">
                    subida {p.orden ?? "—"} · bajada {p.orden_vuelta ?? "—"} ·{" "}
                    {p.latitud !== null ? `${p.latitud.toFixed(5)}, ${p.longitud?.toFixed(5)}` : "sin ubicar"}
                  </p>
                </div>
                <button
                  onClick={() => fijarUbicacionAqui(p.id)}
                  disabled={fijandoId === p.id}
                  className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border border-terracotta text-terracotta hover:bg-terracotta/10 transition disabled:opacity-50"
                >
                  {fijandoId === p.id ? "Ubicando..." : "📍 Fijar aquí"}
                </button>
              </div>
            ))}
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
            {buses.map((b) => (
              <div key={b.id} className="flex justify-between px-3 py-2 bg-cream rounded-lg text-sm">
                <span className="text-forest">{b.nombre}</span>
                <span className="text-forest/50">{b.capacidad_total} puestos</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
