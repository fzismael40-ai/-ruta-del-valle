"use client";
import { useEffect, useRef, useState } from "react";
import { leerTema, aplicarTema, type Tema } from "./tema";

export default function Ajustes({
  huella,
}: {
  huella?: { soportada: boolean; activa: boolean; onActivar: () => void; mensaje?: string | null };
}) {
  const [abierto, setAbierto] = useState(false);
  const [tema, setTema] = useState<Tema>("claro");
  const cajaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = leerTema();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTema(t);
    aplicarTema(t);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [abierto]);

  const alternarTema = () => {
    const nuevo = tema === "claro" ? "oscuro" : "claro";
    setTema(nuevo);
    aplicarTema(nuevo);
    localStorage.setItem("tema", nuevo);
  };

  return (
    <div className="relative" ref={cajaRef}>
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-label="Ajustes"
        style={{ touchAction: "manipulation" }}
        className="w-9 h-9 rounded-full border border-forest/20 flex items-center justify-center text-ink hover:bg-forest/5 transition shrink-0"
      >
        ⚙️
      </button>
      {abierto && (
        <div className="absolute right-0 mt-2 w-64 bg-paper border border-forest/10 rounded-xl shadow-lg p-2 z-50">
          <button
            onClick={alternarTema}
            className="w-full flex items-center justify-between text-sm text-ink px-3 py-2.5 rounded-lg hover:bg-forest/5 transition"
          >
            <span>{tema === "oscuro" ? "🌙 Modo oscuro" : "☀️ Modo claro"}</span>
            <span className="text-xs text-ink/50">Cambiar</span>
          </button>
          {huella?.soportada && (
            <>
              <div className="h-px bg-forest/10 my-1" />
              {huella.activa ? (
                <p className="text-xs text-ink/50 px-3 py-2">👆 Huella / Face ID activada</p>
              ) : (
                <button
                  onClick={huella.onActivar}
                  className="w-full flex items-center justify-between text-sm text-ink px-3 py-2.5 rounded-lg hover:bg-forest/5 transition"
                >
                  <span>👆 Huella / Face ID</span>
                  <span className="text-xs font-medium text-teal-dark">Activar</span>
                </button>
              )}
              {huella.mensaje && <p className="text-xs text-terracotta px-3 pb-1">{huella.mensaje}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
