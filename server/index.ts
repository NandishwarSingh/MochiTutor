import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { startApp } from "./app";
import { config } from "./config";
import { createSessionGrant, locateInImage } from "./gemini";

const distDir = resolve(import.meta.dir, "../dist");
const tls = config.tlsCert && config.tlsKey ? { cert: config.tlsCert, key: config.tlsKey } : undefined;

if (!config.apiKey) console.warn("GEMINI_API_KEY is not set; lessons can't start until you add it to .env.");

const server = startApp({
  host: config.host,
  port: config.port,
  createGrant: config.apiKey
    ? (resumeHandle) =>
        createSessionGrant({ apiKey: config.apiKey, model: config.model, voice: config.voice, resumeHandle })
    : null,
  locate: config.apiKey
    ? (imageBase64, target) => locateInImage({ apiKey: config.apiKey, model: config.visionModel, imageBase64, target })
    : null,
  sessionLimit: config.sessionLimit,
  sessionWindowMs: config.sessionWindowMs,
  staticDir: existsSync(distDir) && process.env.NODE_ENV === "production" ? distDir : undefined,
  tls,
});

console.log(`MochiTutor server on ${server.url} (model ${config.model}, voice ${config.voice})`);
