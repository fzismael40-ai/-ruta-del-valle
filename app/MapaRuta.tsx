"use client";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import { QRCodeSVG } from "qrcode.react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { rutaIdaCarretera, rutaVueltaCarretera } from "./rutaCarreteras";

type Coord = [number, number];

type BusEnMapa = {
  id: string;
  nombre: string;
  sentido: "ida" | "vuelta";
  lat: number;
  lng: number;
  ocupacion_actual: number;
  capacidad_total: number;
  necesita_refuerzo: boolean;
};

type ParadaEnMapa = {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
};

export default function MapaRuta({
  rutaIda,
  rutaVuelta,
  buses,
  paradas,
}: {
  rutaIda: Coord[];
  rutaVuelta: Coord[];
  buses: BusEnMapa[];
  paradas: ParadaEnMapa[];
}) {
  const centro: Coord = rutaIda[Math.floor(rutaIda.length / 2)] ?? [8.62, -71.13];

  // Trazado real de la carretera (precalculado una vez con OSRM y guardado en
  // rutaCarreteras.ts): el servidor público de OSRM es una demo gratuita y no
  // es confiable para pedirlo en cada carga de página.
  const trazadoIda = rutaIdaCarretera.length > 0 ? rutaIdaCarretera : rutaIda;
  const trazadoVuelta = rutaVueltaCarretera.length > 0 ? rutaVueltaCarretera : rutaVuelta;

  const iconoParada = L.divIcon({
    className: "",
    html: `<div style="width:8px;height:8px;background:#FFFDF7;border-radius:50%;border:2px solid #1F3D2E;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
    iconSize: [8, 8],
  });

  const iconoBus = (sentido: string, necesitaRefuerzo: boolean) => {
    const color = sentido === "vuelta" ? "#1F3D2E" : "#C2542C";
    return L.divIcon({
      className: "bus-marker-icon",
      html: `<div style="
        width:30px;height:30px;border-radius:50%;
        background:${color};
        display:flex;align-items:center;justify-content:center;
        font-size:16px;
        border:2px solid #FFFDF7;
        box-shadow:0 2px 6px rgba(0,0,0,0.35)${necesitaRefuerzo ? ", 0 0 0 3px rgba(194,84,44,0.35)" : ""};
      ">🚌</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  };

  const origen = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <MapContainer center={centro} zoom={13} style={{ height: "360px", width: "100%", borderRadius: "16px" }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <Polyline positions={trazadoIda} pathOptions={{ color: "#C2542C", weight: 3, opacity: 0.6, dashArray: "6 6" }} />
      <Polyline positions={trazadoVuelta} pathOptions={{ color: "#1F3D2E", weight: 4, opacity: 0.8 }} />

      {paradas.map((parada) => (
        <Marker key={parada.id} position={[parada.lat, parada.lng]} icon={iconoParada}>
          <Popup>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>{parada.nombre}</p>
              <QRCodeSVG value={`${origen}/parada/${parada.id}`} size={100} />
              <p style={{ fontSize: 11, marginTop: 8 }}>
                <a href={`/parada/${parada.id}`}>Ver estado de esta parada</a>
              </p>
            </div>
          </Popup>
        </Marker>
      ))}

      {buses.map((bus) => (
        <Marker key={bus.id} position={[bus.lat, bus.lng]} icon={iconoBus(bus.sentido, bus.necesita_refuerzo)}>
          <Popup>
            {bus.nombre} — {bus.ocupacion_actual}/{bus.capacidad_total} · {bus.sentido === "vuelta" ? "Bajando" : "Subiendo"}
            {bus.necesita_refuerzo && <><br />Lleno — necesita refuerzo</>}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}