import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Floor.app empaquetado: `next build` deja un servidor autocontenido en
  // .next/standalone que Electron arranca con su propio Node (ver apps/desktop).
  output: "standalone",
  // onnxruntime-node abre su dylib con dlopen: el trazado solo ve el .node.
  // Sin esto las incrustaciones (Map, busqueda) fallan en el .app.
  outputFileTracingIncludes: { "/**": ["./node_modules/onnxruntime-node/bin/napi-v6/darwin/**"] },
  turbopack: { root: __dirname },
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"]
};

export default nextConfig;
