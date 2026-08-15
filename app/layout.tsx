import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ruta del Valle — Mérida",
  description:
    "Rastreo de buses en tiempo real para la ruta Hotel Valle Grande – Av. 19, en Mérida. Ocupación en vivo, próxima parada y refuerzos automáticos.",
  openGraph: {
    title: "Ruta del Valle — Mérida",
    description:
      "Rastreo de buses en tiempo real para la ruta Hotel Valle Grande – Av. 19, en Mérida.",
    locale: "es_VE",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Ruta del Valle",
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