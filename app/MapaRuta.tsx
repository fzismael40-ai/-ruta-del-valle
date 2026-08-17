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

// Punto más cercano dentro de un segmento a-b (proyección, no solo el vértice
// más próximo) — así el marcador queda pegado a la vía aunque el GPS real
// haya quedado un poco a un lado.
function puntoEnSegmento(p: Coord, a: Coord, b: Coord): Coord {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const largo2 = dx * dx + dy * dy;
  if (largo2 === 0) return a;
  let t = ((px - ax) * dx + (py - ay) * dy) / largo2;
  t = Math.max(0, Math.min(1, t));
  return [ax + t * dx, ay + t * dy];
}

function distancia2(a: Coord, b: Coord): number {
  const dLat = a[0] - b[0];
  const dLng = a[1] - b[1];
  return dLat * dLat + dLng * dLng;
}

function pegarARuta(punto: Coord, ruta: Coord[]): Coord {
  if (ruta.length === 0) return punto;
  let mejor = ruta[0];
  let mejorDist = Infinity;
  for (let i = 0; i < ruta.length - 1; i++) {
    const candidato = puntoEnSegmento(punto, ruta[i], ruta[i + 1]);
    const d = distancia2(punto, candidato);
    if (d < mejorDist) {
      mejorDist = d;
      mejor = candidato;
    }
  }
  return mejor;
}

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

  // Las paradas se guardan con su coordenada GPS real (para que el check-in
  // por QR y las distancias sean exactas), pero para el dibujo en el mapa se
  // proyectan sobre el trazado más cercano para que no se vean "flotando"
  // lejos de la vía — es solo visual, no toca la coordenada real guardada.
  const paradasEnRuta = paradas.map((p) => {
    const candidatoIda = pegarARuta([p.lat, p.lng], trazadoIda);
    const candidatoVuelta = pegarARuta([p.lat, p.lng], trazadoVuelta);
    const masCercano =
      distancia2([p.lat, p.lng], candidatoIda) <= distancia2([p.lat, p.lng], candidatoVuelta)
        ? candidatoIda
        : candidatoVuelta;
    return { ...p, lat: masCercano[0], lng: masCercano[1] };
  });

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

      {paradasEnRuta.map((parada) => (
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