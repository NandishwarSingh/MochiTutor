import { GoogleGenAI, Type } from "@google/genai";
import { buildLiveConfig } from "../src/live/config";

export interface SessionGrant {
  token: string;
  model: string;
  voice: string;
  expiresAt: string;
}

/**
 * Mint a single-use token for one Live session. The model, prompt and tools
 * are locked into the token, so the browser only gets permission to run
 * this exact session, never the API key.
 */
export async function createSessionGrant(opts: {
  apiKey: string;
  model: string;
  voice: string;
  resumeHandle?: string;
}): Promise<SessionGrant> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: expiresAt,
      newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
      liveConnectConstraints: {
        model: opts.model,
        config: buildLiveConfig({ voice: opts.voice, resumeHandle: opts.resumeHandle }),
      },
      httpOptions: { apiVersion: "v1alpha" },
    },
  });
  if (!token.name) throw new Error("The token response had no name");
  return { token: token.name, model: opts.model, voice: opts.voice, expiresAt };
}

export type Box = [number, number, number, number];

/**
 * Find where a piece of writing is on a notebook photo. The Live model's own
 * boxes are rough, so the board asks a vision model for a precise one.
 */
export async function locateInImage(opts: {
  apiKey: string;
  model: string;
  imageBase64: string;
  target: string;
}): Promise<Box | null> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const res = await ai.models.generateContent({
    model: opts.model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: opts.imageBase64, mimeType: "image/jpeg" } },
          {
            text: `This is a photo of a student's notebook. Find this part of their working: "${opts.target}". Return the bounding box of that whole line or step as box_2d [ymin, xmin, ymax, xmax], normalised to 0-1000.`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: { box_2d: { type: Type.ARRAY, items: { type: Type.INTEGER } } },
        required: ["box_2d"],
      },
    },
  });
  const box = (JSON.parse(res.text ?? "{}") as { box_2d?: unknown }).box_2d;
  if (!Array.isArray(box) || box.length !== 4 || !box.every((v) => typeof v === "number" && v >= 0 && v <= 1000)) {
    return null;
  }
  const [y0, x0, y1, x1] = box as Box;
  return y1 > y0 && x1 > x0 ? [y0, x0, y1, x1] : null;
}
