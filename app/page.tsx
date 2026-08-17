"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "./supabaseClient";

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

type PromptInstalacion = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function Home() {
  const router = useRouter();
  const [rutas, setRutas] = useState<Ruta[]>([RUTA_VALLE_RESPALDO]);
  const [instalarPrompt, setInstalarPrompt] = useState<PromptInstalacion | null>(null);
  const [mostrarBotonInstalar, setMostrarBotonInstalar] = useState(true);
  const [mensajeInstalacion, setMensajeInstalacion] = useState<string | null>(null);

  useEffect(() => {
    const fetchRutas = async () => {
      const { data } = await supabase.from("rutas").select("id,nombre,slug,descripcion").eq("activa", true).order("nombre");
      if (data && data.length > 0) setRutas(data as Ruta[]);
    };
    fetchRutas();
  }, []);

  useEffect(() => {
    const alPoderInstalar = (e: Event) => {
      e.preventDefault();
      setInstalarPrompt(e as PromptInstalacion);
    };
    const alInstalar = () => setMostrarBotonInstalar(false);
    window.addEventListener("beforeinstallprompt", alPoderInstalar);
    window.addEventListener("appinstalled", alInstalar);
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

  return (
    <main className="min-h-screen bg-cream">
      <header className="border-b border-forest/10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onDoubleClick={() => router.push("/admin")}
            style={{ touchAction: "manipulation" }}
            className="font-display font-semibold text-lg text-forest select-none"
          >
            Next Route
          </button>
          {mostrarBotonInstalar && (
            <button
              onClick={descargarApp}
              className="text-sm font-medium px-4 py-2 rounded-full border border-forest text-forest hover:bg-forest/5 transition"
            >
              ⬇ Descargar
            </button>
          )}
        </div>
        {mensajeInstalacion && (
          <div className="max-w-4xl mx-auto px-6 pb-3 -mt-1">
            <div className="bg-teal/15 text-teal-dark text-xs rounded-lg px-3 py-2 flex justify-between items-center">
              <span>{mensajeInstalacion}</span>
              <button onClick={() => setMensajeInstalacion(null)} className="text-teal-dark/60 hover:text-teal-dark ml-3">✕</button>
            </div>
          </div>
        )}
      </header>

      <div className="max-w-4xl mx-auto px-6 py-14">
        <span className="inline-block text-xs font-semibold tracking-widest uppercase text-terracotta bg-terracotta/10 px-3 py-1 rounded-full mb-5">
          Mérida, Venezuela
        </span>
        <h1 className="font-display text-3xl sm:text-4xl text-forest leading-tight mb-3">
          Elige tu ruta
        </h1>
        <p className="text-forest/60 mb-10 max-w-xl">
          Next Route rastrea buses en tiempo real, ruta por ruta.
        </p>

        <div className="grid sm:grid-cols-2 gap-4 max-w-md">
          {rutas.map((r) => (
            <Link
              key={r.id}
              href={`/r/${r.slug}`}
              className="block bg-paper border border-forest/10 rounded-2xl p-6 shadow-sm hover:border-forest/30 hover:shadow-md transition"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-teal animate-pulse"></span>
                <span className="text-xs font-medium text-teal-dark uppercase tracking-wide">En vivo</span>
              </div>
              <h2 className="font-display text-xl text-forest mb-1">{r.nombre}</h2>
              {r.descripcion && <p className="text-sm text-forest/60">{r.descripcion}</p>}
            </Link>
          ))}
        </div>
      </div>

      <footer className="border-t border-forest/10 py-8">
        <div className="max-w-4xl mx-auto px-6 text-center text-xs text-forest/40">
          Next Route · Construido por Ismael Fermín · &copy; {new Date().getFullYear()}
        </div>
      </footer>
    </main>
  );
}
