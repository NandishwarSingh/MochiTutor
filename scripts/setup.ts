// One-time local setup:
//  1. .env from .env.example if there isn't one
//  2. a self-signed HTTPS certificate covering localhost and this machine's LAN
//     addresses, because phone browsers only open the camera on https
//  3. the sample VRoid avatar (pixiv's VRM 1.0 sample, redistribution allowed)

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { lanAddresses } from "../server/app";

const root = new URL("..", import.meta.url).pathname;
const path = (p: string) => `${root}${p}`;

const SAMPLE_URL =
  "https://raw.githubusercontent.com/pixiv/three-vrm/v3.5.5/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm";
const SAMPLE_SHA256 = "12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2";

function step(msg: string) {
  console.log(`- ${msg}`);
}

if (!existsSync(path(".env"))) {
  copyFileSync(path(".env.example"), path(".env"));
  step("created .env, add your GEMINI_API_KEY to it");
} else {
  step(".env already exists");
}

async function certificateCovers(ips: string[]): Promise<boolean> {
  if (!existsSync(path(".certs/cert.pem"))) return false;
  const out = await Bun.$`openssl x509 -in ${path(".certs/cert.pem")} -noout -ext subjectAltName`
    .quiet()
    .nothrow()
    .text();
  return ips.every((ip) => out.includes(ip));
}

const ips = lanAddresses();
if (await certificateCovers(ips)) {
  step("HTTPS certificate is up to date");
} else {
  mkdirSync(path(".certs"), { recursive: true });
  const san = ["DNS:localhost", "IP:127.0.0.1", ...ips.map((ip) => `IP:${ip}`)].join(",");
  await Bun.$`openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 -subj /CN=MochiTutor-dev -keyout ${path(".certs/key.pem")} -out ${path(".certs/cert.pem")} -addext subjectAltName=${san}`.quiet();
  step(`created a self-signed certificate for localhost${ips.length ? `, ${ips.join(", ")}` : ""}`);
}

const avatar = path("public/avatars/sample.vrm");
if (existsSync(avatar)) {
  step("sample avatar already downloaded");
} else {
  mkdirSync(path("public/avatars"), { recursive: true });
  step("downloading the sample avatar (10.8 MB)");
  const res = await fetch(SAMPLE_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== SAMPLE_SHA256) throw new Error(`Checksum mismatch for the sample avatar (${sha})`);
  await Bun.write(avatar, bytes);
  step("saved public/avatars/sample.vrm");
}

console.log("\nDone. Start it with: bun run dev");
