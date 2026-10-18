import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The phone needs HTTPS for its camera, so dev runs on the self-signed
// certificate that `bun run setup` creates.
const certFile = ".certs/cert.pem";
const keyFile = ".certs/key.pem";
const https =
  existsSync(certFile) && existsSync(keyFile)
    ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
    : undefined;

const api = `http://127.0.0.1:${process.env.PORT ?? 8787}`;
const proxy = {
  "/api": { target: api, xfwd: true },
  "/ws": { target: api, ws: true },
};

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173, https, proxy },
  preview: { host: true, port: 4173, https, proxy },
  build: {
    target: "es2022",
    rollupOptions: { input: { board: "index.html", viewer: "viewer/index.html" } },
  },
});
