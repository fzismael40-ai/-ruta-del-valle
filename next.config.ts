import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // react-leaflet's MapContainer can't safely remount into the same DOM
  // node, which React's Strict Mode double-invoke triggers in dev.
  reactStrictMode: false,
};

export default nextConfig;
