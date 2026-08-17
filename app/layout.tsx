import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Next-Router — Mérida",
  description:
    "Rastreo de buses en tiempo real para varias rutas de transporte en Mérida — empezando por Ruta del Valle (Hotel Valle Grande – Av. 19). Ocupación en vivo, próxima parada y refuerzos automáticos.",
  openGraph: {
    title: "Next-Router — Mérida",
    description:
      "Rastreo de buses en tiempo real para varias rutas de transporte en Mérida.",
    locale: "es_VE",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Next-Router",
  },
};

export const viewport: Viewport = {
  themeColor: "#1F3D2E",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}