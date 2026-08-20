"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "./supabaseClient";
import TemaIcono from "./TemaIcono";

type Ruta = {
  id: string;
  nombre: string;
  slug: string;
  descripcion: string | null;
};

// Si la tabla "rutas" todavía no existe, o no hay ninguna activa, se muestra
// igual Ruta del Valle — es la única lista para pruebas ahora mismo, y
// RutaApp ya sabe funcionar sin la migración corrida.
const RUTA_VALLE_RESPALDO: Ruta = {
  id: "respaldo",
  nombre: "Ruta del Valle",
  slug: "ruta-del-valle",
  descripcion: "Hotel Valle Grande – Av. 19, El Playón",
};

export default function Home() {
  const router = useRouter();
  const [rutas, setRutas] = useState<Ruta[]>([RUTA_VALLE_RESPALDO]);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    const fetchRutas = async () => {
      const { data } = await supabase.from("rutas").select("id,nombre,slug,descripcion").eq("activa", true).order("nombre");
      if (data && data.length > 0) setRutas(data as Ruta[]);
    };
    fetchRutas();
  }, []);

  const rutasFiltradas = rutas.filter((r) =>
    r.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  return (
    <main className="min-h-screen bg-cream">
      <header className="border-b border-forest/10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onDoubleClick={() => router.push("/admin?full=1")}
            style={{ touchAction: "manipulation" }}
            className="font-display font-semibold text-lg text-ink select-none"
          >
            Next Route
          </button>
          <TemaIcono />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-14">
        <span className="inline-block text-xs font-semibold tracking-widest uppercase text-terracotta bg-terracotta/10 px-3 py-1 rounded-full mb-5">
          Mérida, Venezuela
        </span>
        <h1 className="font-display text-3xl sm:text-4xl text-ink leading-tight mb-3">
          Elige tu ruta
        </h1>
        <p className="text-ink/60 mb-6 max-w-xl">
          Next Route rastrea buses en tiempo real, ruta por ruta.
        </p>

        {rutas.length > 1 && (
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar ruta..."
            className="w-full max-w-md mb-8 text-sm border border-forest/15 rounded-full px-4 py-2.5 bg-paper focus:outline-none focus:border-forest/40"
          />
        )}

        <div className="grid sm:grid-cols-2 gap-4 max-w-md">
          {rutasFiltradas.map((r) => (
            <Link
              key={r.id}
              href={`/r/${r.slug}`}
              className="block bg-paper border border-forest/10 rounded-2xl p-6 shadow-sm hover:border-forest/30 hover:shadow-md transition"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-teal animate-pulse"></span>
                <span className="text-xs font-medium text-teal-dark uppercase tracking-wide">En vivo</span>
              </div>
              <h2 className="font-display text-xl text-ink mb-1">{r.nombre}</h2>
              {r.descripcion && <p className="text-sm text-ink/60">{r.descripcion}</p>}
            </Link>
          ))}
        </div>
      </div>

      <footer className="border-t border-forest/10 py-8">
        <div className="max-w-4xl mx-auto px-6 text-center text-xs text-ink/40">
          Next Route · Construido por Ismael Fermín,{" "}
          <span onDoubleClick={() => router.push("/admin")} style={{ touchAction: "manipulation" }}>
            administrador
          </span>{" "}
          · &copy; {new Date().getFullYear()}
        </div>
      </footer>
    </main>
  );
}
