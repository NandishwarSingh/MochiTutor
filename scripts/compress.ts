// Write a brotli copy next to every compressible file in dist/, so the server
// can send it as-is instead of compressing on every request. The avatar alone
// goes from 10.8 MB to about 7 MB.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const dist = join(import.meta.dir, "../dist");
const COMPRESSIBLE = /\.(html|js|css|svg|json|txt|xml|ttf|vrm)$/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (COMPRESSIBLE.test(name)) yield path;
  }
}

let before = 0;
let after = 0;
for (const path of files(dist)) {
  const raw = readFileSync(path);
  const br = brotliCompressSync(raw, {
    params: {
      // Quality 11 is slow on multi-megabyte files for a few percent more.
      [constants.BROTLI_PARAM_QUALITY]: raw.length > 1_000_000 ? 9 : 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  if (br.length > raw.length * 0.9) continue;
  writeFileSync(`${path}.br`, br);
  before += raw.length;
  after += br.length;
  if (raw.length > 500_000) console.log(`${relative(dist, path)}: ${raw.length} -> ${br.length} bytes`);
}
console.log(`brotli: ${before} -> ${after} bytes`);
