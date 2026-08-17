import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Next Route — Mérida",
    short_name: "Next Route",
    description: "Rastreo de buses en tiempo real para varias rutas de transporte en Mérida.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5EFE1",
    theme_color: "#1F3D2E",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
