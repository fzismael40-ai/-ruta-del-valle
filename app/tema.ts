export type Tema = "claro" | "oscuro";

export function leerTema(): Tema {
  const guardado = localStorage.getItem("tema");
  if (guardado === "claro" || guardado === "oscuro") return guardado;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}

export function aplicarTema(tema: Tema) {
  document.documentElement.setAttribute("data-theme", tema === "oscuro" ? "dark" : "light");
}
