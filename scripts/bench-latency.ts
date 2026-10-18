// Measures how fast Mochi starts answering, through the same path the browser
// uses: a short-lived token, the app's exact Live config, and the real tool
// handlers on a headless board. A spoken question is streamed in real time,
// followed by silence; the clock runs from the end of speech to Mochi's first
// audio, so Gemini's own end-of-speech wait is included.
//
//   bun run bench                        3 runs per clip with the default model
//   bun run bench --runs 5 --model gemini-3.1-flash-live-preview

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type FunctionResponse, GoogleGenAI, type LiveServerMessage } from "@google/genai";
import { BoardStore } from "../src/board/store";
import { runTool } from "../src/board/tools";
import { buildLiveConfig, DEFAULT_MODEL, DEFAULT_VOICE } from "../src/live/config";
import { median } from "../src/viewer/pose";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: process.env.MOCHI_MODEL ?? DEFAULT_MODEL },
    runs: { type: "string", default: "3" },
  },
});
const model = values.model as string;
const runs = Number(values.runs);
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("Set GEMINI_API_KEY in .env first");

const root = new URL("..", import.meta.url).pathname;
const CLIPS = [
  {
    name: "hinglish-coin",
    voice: "Lekha",
    text: "मोची, मुझे probability समझाओ ना, coin toss में heads आने का chance कितना है?",
  },
  {
    name: "hinglish-dice",
    voice: "Lekha",
    text: "अच्छा, अगर मैं दो dice roll करूँ, तो sum seven आने की probability क्या होगी? Board पर लिख के बताओ।",
  },
  { name: "english-monty", voice: "Rishi", text: "Okay Mochi, can you explain the Monty Hall problem to me?" },
];

async function ensureClips() {
  mkdirSync(`${root}bench/clips`, { recursive: true });
  for (const c of CLIPS) {
    const wav = `${root}bench/clips/${c.name}.wav`;
    if (existsSync(wav)) continue;
    if (process.platform !== "darwin") throw new Error(`Missing ${wav}; clips are generated with macOS "say"`);
    const aiff = `${root}bench/clips/${c.name}.aiff`;
    await Bun.$`say -v ${c.voice} -o ${aiff} ${c.text}`.quiet();
    await Bun.$`afconvert -f WAVE -d LEI16@16000 -c 1 ${aiff} ${wav}`.quiet();
    await Bun.$`rm ${aiff}`.quiet();
  }
}

function readPcm(path: string): Int16Array {
  const buf = readFileSync(path);
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data")
      return new Int16Array(buf.buffer.slice(buf.byteOffset + off + 8, buf.byteOffset + off + 8 + size));
    off += 8 + size + (size % 2);
  }
  throw new Error(`No audio data in ${path}`);
}

const b64 = (a: Int16Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RunResult {
  clip: string;
  firstAudioMs: number | null;
  firstToolMs: number | null;
  tools: string[];
  heard: string;
  said: string;
}

async function runOnce(clip: (typeof CLIPS)[number]): Promise<RunResult> {
  const config = buildLiveConfig({ voice: DEFAULT_VOICE });
  const token = await new GoogleGenAI({ apiKey }).authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(Date.now() + 10 * 60_000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      liveConnectConstraints: { model, config },
      httpOptions: { apiVersion: "v1alpha" },
    },
  });
  const ai = new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion: "v1alpha" } });
  const board = new BoardStore();
  const ctx = {
    board,
    takeNotebookPhoto: async () => null,
    react: () => {},
    onBoardChange: () => {},
  };
  let tEnd = 0;
  let firstAudio: number | null = null;
  let firstTool: number | null = null;
  const tools: string[] = [];
  const heard: string[] = [];
  const said: string[] = [];
  let ready!: () => void;
  let done!: () => void;
  const setup = new Promise<void>((r) => {
    ready = r;
  });
  const finished = new Promise<void>((r) => {
    done = r;
  });
  const session = await ai.live.connect({
    model,
    config,
    callbacks: {
      onmessage: (m: LiveServerMessage) => {
        const now = performance.now();
        if (m.setupComplete) ready();
        if (m.toolCall?.functionCalls) {
          if (tEnd && firstTool === null) firstTool = now - tEnd;
          const calls = m.toolCall.functionCalls;
          tools.push(...calls.map((c) => c.name ?? "?"));
          void Promise.all(calls.map((c) => runTool(c, ctx, new AbortController().signal))).then(
            (responses: FunctionResponse[]) => session.sendToolResponse({ functionResponses: responses }),
          );
        }
        const sc = m.serverContent;
        for (const p of sc?.modelTurn?.parts ?? []) {
          if (p.inlineData?.data && tEnd && firstAudio === null) firstAudio = now - tEnd;
        }
        if (sc?.inputTranscription?.text) heard.push(sc.inputTranscription.text);
        if (sc?.outputTranscription?.text) said.push(sc.outputTranscription.text);
        if (sc?.turnComplete && firstAudio !== null) done();
      },
      onerror: (e) => console.error("error:", e.message),
      onclose: () => done(),
    },
  });
  await setup;
  const pcm = readPcm(`${root}bench/clips/${clip.name}.wav`);
  const chunk = 640;
  const start = performance.now();
  for (let i = 0; i < pcm.length; i += chunk) {
    session.sendRealtimeInput({ audio: { data: b64(pcm.subarray(i, i + chunk)), mimeType: "audio/pcm;rate=16000" } });
    await sleep(Math.max(0, start + ((i + chunk) / 16000) * 1000 - performance.now()));
  }
  tEnd = performance.now();
  const silence = new Int16Array(chunk);
  for (let j = 0; j < 200 && firstAudio === null; j++) {
    session.sendRealtimeInput({ audio: { data: b64(silence), mimeType: "audio/pcm;rate=16000" } });
    await sleep(40);
  }
  await Promise.race([finished, sleep(30_000)]);
  session.close();
  return {
    clip: clip.name,
    firstAudioMs: firstAudio === null ? null : Math.round(firstAudio),
    firstToolMs: firstTool === null ? null : Math.round(firstTool),
    tools,
    heard: heard.join("").trim(),
    said: said.join("").trim(),
  };
}

await ensureClips();
const results: RunResult[] = [];
for (const clip of CLIPS) {
  for (let r = 0; r < runs; r++) {
    const res = await runOnce(clip);
    results.push(res);
    console.log(
      `${clip.name} #${r + 1}: first audio ${res.firstAudioMs ?? "none"} ms, first tool ${res.firstToolMs ?? "none"} ms, tools [${res.tools.join(", ")}]`,
    );
    if (r === 0) console.log(`  heard: ${res.heard}\n  said:  ${res.said}`);
  }
}

const audio = results
  .map((r) => r.firstAudioMs)
  .filter((v): v is number => v !== null)
  .sort((a, b) => a - b);
const p90 = audio[Math.min(audio.length - 1, Math.ceil(audio.length * 0.9) - 1)];
const summary = {
  date: new Date().toISOString(),
  model,
  runs: results.length,
  firstAudioMs: {
    median: audio.length ? median(audio) : null,
    p90: p90 ?? null,
    min: audio[0] ?? null,
    max: audio.at(-1) ?? null,
  },
  results,
};
mkdirSync(`${root}bench/results`, { recursive: true });
const out = `${root}bench/results/${summary.date.slice(0, 10)}-${model}.json`;
await Bun.write(out, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `\nfirst audio after you stop talking: median ${summary.firstAudioMs.median} ms, p90 ${summary.firstAudioMs.p90} ms (n=${audio.length})`,
);
console.log(`saved ${out.replace(root, "")}`);
