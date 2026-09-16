import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Floor.app empaquetado: `next build` deja un servidor autocontenido en
  // .next/standalone que Electron arranca con su propio Node (ver apps/desktop).
  output: "standalone",
  // onnxruntime-node: transformers lo carga con un require dinamico que el
  // trazado no sigue, y su dylib se abre con dlopen. Sin esto las
  // incrustaciones (Map, busqueda) fallan en el .app con "Cannot find module".
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**",
      "./node_modules/onnxruntime-node/lib/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/**"
    ]
  },
  turbopack: { root: __dirname },
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"]
};

export default nextConfig;
