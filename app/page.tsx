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
  activa: boolean;
};

type PromptInstalacion = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function Home() {
  const router = useRouter();
  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [instalarPrompt, setInstalarPrompt] = useState<PromptInstalacion | null>(null);
  const [mostrarBotonInstalar, setMostrarBotonInstalar] = useState(true);
  const [mensajeInstalacion, setMensajeInstalacion] = useState<string | null>(null);

  useEffect(() => {
    const fetchRutas = async () => {
      const { data } = await supabase.from("rutas").select("*").order("activa", { ascending: false }).order("nombre");
      setRutas((data as Ruta[]) ?? []);
      setCargando(false);
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
            Next-Router
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
          Next-Router agrupa el rastreo de buses en tiempo real de varias rutas de transporte. Empezó con Ruta
          del Valle (Hotel Valle Grande – Av. 19, El Playón) y va a ir sumando el resto.
        </p>

        {cargando ? (
          <p className="text-sm text-forest/40">Cargando rutas...</p>
        ) : rutas.length === 0 ? (
          <p className="text-sm text-forest/40">Todavía no hay rutas cargadas.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {rutas.map((r) =>
              r.activa ? (
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
              ) : (
                <div
                  key={r.id}
                  className="bg-paper/50 border border-forest/10 border-dashed rounded-2xl p-6 opacity-70"
                >
                  <span className="text-xs font-medium text-forest/40 uppercase tracking-wide">Próximamente</span>
                  <h2 className="font-display text-xl text-forest/70 mb-1 mt-2">{r.nombre}</h2>
                  {r.descripcion && <p className="text-sm text-forest/40">{r.descripcion}</p>}
                </div>
              )
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-forest/10 py-8">
        <div className="max-w-4xl mx-auto px-6 text-center text-xs text-forest/40">
          Next-Router · Construido por Leonardo Moscarini y Ismael Fermín · &copy; {new Date().getFullYear()}
        </div>
      </footer>
    </main>
  );
}
