// The Live session config: Mochi's instructions and the tools it can call.
// The server locks this into each short-lived token, so the browser can't
// change the prompt or the tool list.

import { type FunctionDeclaration, type LiveConnectConfig, Modality, Type } from "@google/genai";

export const DEFAULT_MODEL = "gemini-3.8-live";
export const DEFAULT_VOICE = "Leda";

export const SYSTEM_PROMPT = `You are Mochi, a small, round, cheerful tutor who stands next to the student's laptop. The laptop screen is your classroom board and you draw on it with tools. You are in a live voice call with one student.

How you talk
- Match the student's language. If they speak Hinglish, reply in natural Hinglish, mixing Hindi and English the way Indian students do. If they speak English, reply in English. If they speak Hindi, reply in Hindi.
- You are a girl, so use feminine Hindi verb forms for yourself, like "main likh deti hoon" and "maine socha".
- Start talking straight away. When you use the board, say your first sentence first and call the board tool while you explain, never before you speak.
- Keep turns short: two to four sentences, then stop and let the student talk. Ask one question at a time.
- Be warm, playful and encouraging. Celebrate small wins. Never lecture for long.
- Say maths the way a teacher reads it aloud: "x squared", "6 by 36", "n choose r". Never read LaTeX, symbols or markup aloud.
- Never use emojis, not even in tool arguments.

How you teach
- Find out what the student already knows before explaining. Start from a simple example, then give the general idea.
- Use everyday Indian examples when they help: cricket, chai, train tickets, exam marks, Ludo dice.
- After explaining, check understanding with a quick question or a tiny problem.
- When the student is wrong, say what was right first, then point to the exact step that went wrong and let them try to fix it.
- If you are not sure about a fact, say so instead of guessing.

The board
- Put key formulas, definitions and worked steps on the board with write_on_board while you explain them. Short lines, not paragraphs. Use LaTeX for maths.
- Call clear_board when you move to a new topic.
- Use plot_function to graph a function of x.
- For probability, show instead of tell: flip_coins for long-run frequency, monty_hall to play or simulate the Monty Hall game, show_distribution to draw a distribution and shade a probability.
- Any number that needs arithmetic (fractions, factorials, combinations, distribution probabilities) must come from calculate or from a widget's result. Don't do arithmetic in your head.
- Tool results come back to you as data. Talk about what they show; don't read them out word for word.

Monty Hall
- To play: call monty_hall with action "start" and ask the student to pick a door. Then call it with action "pick" and their door. Tell them which door the host opened (it's in the result), ask whether they want to switch or stay, and stop. Only after they answer, call "switch" or "stay" and react to the result.
- To prove the two-thirds answer, call it with action "simulate" and a number of games.

The notebook
- When the student says they solved something on paper or asks you to check their work, call look_at_notebook. They get a short countdown to hold the notebook up to the webcam, then you receive the photo.
- Read their working step by step. If a step is wrong, call mark_notebook with that step copied as written, your best box around it and a short label, then explain it.

Your body
- You have an animated body that follows what you say: praise makes you cheer, a gentle "koi baat nahi" makes you look sympathetic. Just talk naturally; there's no tool for it.

Starting
- When the lesson starts, greet the student in one short sentence and ask what they want to learn today.`;

const S = Type.STRING;
const N = Type.NUMBER;
const I = Type.INTEGER;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: "write_on_board",
    description: "Write a few short lines on the board, below what is already there.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        lines: {
          type: Type.ARRAY,
          description: "Lines in order. Keep each one short.",
          items: {
            type: Type.OBJECT,
            properties: {
              kind: {
                type: S,
                enum: ["title", "text", "math", "step"],
                description:
                  "title: a heading for the topic. text: one short sentence. math: a LaTeX expression without dollar signs. step: one step of a worked solution; it can mix words with inline LaTeX written inside \\( and \\).",
              },
              content: { type: S },
            },
            required: ["kind", "content"],
          },
        },
        clear_first: { type: Type.BOOLEAN, description: "Wipe the board before writing." },
      },
      required: ["lines"],
    },
  },
  {
    name: "clear_board",
    description: "Wipe the board clean, for example when starting a new topic.",
  },
  {
    name: "plot_function",
    description: "Draw the graph of a function of x on the board.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        expression: {
          type: S,
          description:
            "The function in terms of x in calculator syntax, like x^2 - 3x + 2, sin(x), exp(-x^2/2). Use ^ for powers and * or implicit multiplication.",
        },
        x_min: { type: N },
        x_max: { type: N },
        label: { type: S, description: "Optional caption, like y = x^2 - 3x + 2." },
      },
      required: ["expression", "x_min", "x_max"],
    },
  },
  {
    name: "flip_coins",
    description:
      "Flip a coin many times on the board and draw how the share of heads settles toward the true probability. Returns the counts.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        flips: { type: I, description: "How many flips, 1 to 10000." },
        heads_probability: { type: N, description: "Chance of heads on one flip, 0 to 1. Default 0.5." },
      },
      required: ["flips"],
    },
  },
  {
    name: "monty_hall",
    description:
      "Play or simulate the Monty Hall game on the board. start sets up three doors; pick chooses a door and the host opens a goat door; switch or stay finishes the game; simulate plays many games with both strategies.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: S, enum: ["start", "pick", "switch", "stay", "simulate"] },
        door: { type: I, description: "Door number 1, 2 or 3, for pick." },
        games: { type: I, description: "Number of games for simulate, 10 to 10000." },
      },
      required: ["action"],
    },
  },
  {
    name: "show_distribution",
    description:
      "Draw a probability distribution on the board and optionally shade P(from <= X <= to). Returns the exact shaded probability, mean and variance.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        family: { type: S, enum: ["binomial", "poisson", "geometric", "normal", "uniform", "exponential"] },
        n: { type: I, description: "binomial: number of trials" },
        p: { type: N, description: "binomial or geometric: success probability" },
        lambda: { type: N, description: "poisson: mean rate" },
        mean: { type: N, description: "normal: mean" },
        sd: { type: N, description: "normal: standard deviation" },
        min: { type: N, description: "uniform: lower end" },
        max: { type: N, description: "uniform: upper end" },
        rate: { type: N, description: "exponential: rate" },
        from: { type: N, description: "lower end of the shaded range, leave out for no lower limit" },
        to: { type: N, description: "upper end of the shaded range, leave out for no upper limit" },
      },
      required: ["family"],
    },
  },
  {
    name: "calculate",
    description:
      "Compute an exact value. Supports + - * / ^ ! and parentheses, sqrt, ln, log, exp, sin, cos, tan, C(n,k), P(n,k), binompdf(n,p,k), binomcdf(n,p,k), poissonpdf(lambda,k), poissoncdf(lambda,k), geompdf(p,k), geomcdf(p,k), normalpdf(x,mean,sd), normalcdf(a,b,mean,sd), invnorm(p,mean,sd), pi, e. Returns the value and a fraction when one fits.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        expression: { type: S },
        show_on_board: { type: Type.BOOLEAN, description: "Also write the result on the board. Default true." },
      },
      required: ["expression"],
    },
  },
  {
    name: "look_at_notebook",
    description:
      "Ask the student to hold their notebook up to the webcam, take a photo after a short countdown, show it on the board and send it to you.",
  },
  {
    name: "mark_notebook",
    description: "Draw a box on the latest notebook photo to point at a step, for example a mistake.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        step_text: { type: S, description: "The step you are pointing at, copied from the photo as written." },
        box_2d: {
          type: Type.ARRAY,
          items: { type: I },
          description: "[ymin, xmin, ymax, xmax] normalised to 0-1000 on the photo.",
        },
        label: { type: S, description: "A short note shown next to the box." },
        verdict: { type: S, enum: ["mistake", "correct", "note"] },
      },
      required: ["step_text", "label"],
    },
  },
];

export interface LiveConfigOptions {
  voice?: string;
  resumeHandle?: string;
}

export function buildLiveConfig({ voice = DEFAULT_VOICE, resumeHandle }: LiveConfigOptions = {}): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: TOOLS }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 500 } },
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
  };
}

/** Sent as the first user turn so Mochi opens the lesson. */
export const OPENING_CUE =
  "(The student just opened the board and can hear you now. Greet them in friendly Hinglish in one short sentence and ask what they want to learn today.)";
