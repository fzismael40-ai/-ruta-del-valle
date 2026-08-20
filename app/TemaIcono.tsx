"use client";
import { useEffect, useState } from "react";
import { leerTema, aplicarTema, type Tema } from "./tema";

export default function TemaIcono() {
  const [tema, setTema] = useState<Tema>("claro");

  useEffect(() => {
    const t = leerTema();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTema(t);
    aplicarTema(t);
  }, []);

  const alternar = () => {
    const nuevo = tema === "claro" ? "oscuro" : "claro";
    setTema(nuevo);
    aplicarTema(nuevo);
    localStorage.setItem("tema", nuevo);
  };

  return (
    <button
      onClick={alternar}
      aria-label={tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      style={{ touchAction: "manipulation" }}
      className="w-9 h-9 rounded-full border border-forest/20 flex items-center justify-center text-ink hover:bg-forest/5 transition shrink-0"
    >
      {tema === "oscuro" ? "🌙" : "☀️"}
    </button>
  );
}
