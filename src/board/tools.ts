import type { FunctionCall, FunctionResponse } from "@google/genai";
import { CalcError, calculate, compileFunction } from "../lib/calc";
import { mulberry32, randomSeed } from "../lib/rng";
import { type Door, decide, flipCoins, newMontyGame, pickDoor, simulateMonty } from "../lib/simulations";
import { type DistributionFamily, type DistributionParams, makeDistribution, probabilityBetween } from "../lib/stats";
import type { Emotion, Gesture } from "../shared/protocol";
import { stripEmoji } from "../shared/text";
import { findLine } from "./follow";
import { type BoardStore, LINE_KINDS, type LineKind, MARK_STYLES, type MarkStyle, type NotebookMark } from "./store";
import { barChart, drawDiagram, numberLine, probabilityTree, showImage, vennDiagram } from "./visual-tools";

export interface Photo {
  dataUrl: string;
  base64: string;
}

export interface ToolContext {
  board: BoardStore;
  /** Runs the countdown and returns a webcam photo, or null if there's no camera. */
  takeNotebookPhoto(signal: AbortSignal): Promise<Photo | null>;
  react(emotion: Emotion, gesture: Gesture): void;
  /** Precise box for a piece of writing on a photo, or null. */
  locate?(imageBase64: string, target: string): Promise<[number, number, number, number] | null>;
  /** Called for every board change so Mochi can glance and point at it. */
  onBoardChange(): void;
  /** A free picture for a search, or null. */
  findImage?(query: string, signal: AbortSignal): Promise<{ id: string; title: string; credit: string } | null>;
  /** Clock in ms, injectable for tests. */
  now?(): number;
}

type Args = Record<string, unknown>;
type Result = { response: Record<string, unknown>; parts?: FunctionResponse["parts"] };

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string => (typeof v === "string" ? stripEmoji(v).trim() : "");
const round = (x: number, digits = 6) => Number(x.toPrecision(digits));
const clampInt = (v: unknown, lo: number, hi: number, fallback: number) =>
  Math.min(hi, Math.max(lo, Math.round(num(v) ?? fallback)));

let rng = mulberry32(randomSeed());
let nextMarkId = 1;
let montyPickedAt = 0;
/** The student needs a moment to answer "stay or switch" before the game can finish. */
const MONTY_DECIDE_MS = 3000;

const handlers: Record<string, (args: Args, ctx: ToolContext, signal: AbortSignal) => Promise<Result> | Result> = {
  write_on_board(args, { board, onBoardChange }) {
    const lines = Array.isArray(args.lines) ? args.lines : [];
    if (args.clear_first === true) board.clear();
    let written = 0;
    for (const raw of lines.slice(0, 16)) {
      const line = raw as { kind?: unknown; content?: unknown };
      const kind = LINE_KINDS.includes(line.kind as LineKind) ? (line.kind as LineKind) : "text";
      const content = str(line.content);
      if (content) {
        board.add({ kind: "line", line: kind, content: content.slice(0, 400) });
        written++;
      }
    }
    onBoardChange();
    return { response: { written } };
  },

  annotate(args, { board, onBoardChange }) {
    const style = str(args.style) as MarkStyle;
    if (!MARK_STYLES.includes(style)) throw new Error(`style must be one of ${MARK_STYLES.join(", ")}`);
    const lines = board
      .snapshot()
      .filter((it) => it.kind === "line")
      .map((it) => ({ id: it.id, content: it.content }));
    if (!lines.length) throw new Error("The board has no lines to mark yet.");
    const target = findLine(lines, str(args.line));
    if (!target) {
      const recent = lines.slice(-8).map((l) => l.content);
      throw new Error(`No line matches "${str(args.line)}". Lines on the board: ${JSON.stringify(recent)}`);
    }
    board.mark(target.id, style, str(args.label).slice(0, 40) || undefined);
    board.focus(target.id);
    onBoardChange();
    return { response: { marked: target.content, style } };
  },

  draw_diagram: drawDiagram,
  probability_tree: probabilityTree,
  number_line: numberLine,
  venn_diagram: vennDiagram,
  bar_chart: barChart,
  show_image: showImage,

  clear_board(_args, { board }) {
    board.clear();
    return { response: { cleared: true } };
  },

  plot_function(args, { board, onBoardChange }) {
    const expression = str(args.expression);
    let xMin = num(args.x_min) ?? -5;
    let xMax = num(args.x_max) ?? 5;
    if (xMax <= xMin) [xMin, xMax] = [xMax, xMin === xMax ? xMin + 10 : xMin];
    compileFunction(expression);
    board.add({ kind: "plot", expression, xMin, xMax, label: str(args.label) || undefined });
    onBoardChange();
    return { response: { plotted: expression, x_min: xMin, x_max: xMax } };
  },

  flip_coins(args, { board, onBoardChange }) {
    const flips = clampInt(args.flips, 1, 10000, 100);
    const p = Math.min(1, Math.max(0, num(args.heads_probability) ?? 0.5));
    const run = flipCoins(flips, p, rng);
    board.add({ kind: "coins", run });
    onBoardChange();
    return {
      response: {
        flips,
        heads: run.heads,
        tails: run.tails,
        share_of_heads: round(run.heads / flips, 4),
        true_probability: p,
      },
    };
  },

  monty_hall(args, ctx) {
    const { board, onBoardChange } = ctx;
    const action = str(args.action);
    const current = board.latest("monty");
    if (action === "simulate") {
      const games = clampInt(args.games, 10, 10000, 1000);
      const sim = simulateMonty(games, rng);
      if (current) board.update(current.id, "monty", { sim });
      else board.add({ kind: "monty", game: null, sim });
      onBoardChange();
      return {
        response: {
          games,
          switch_wins: sim.switchWins,
          stay_wins: sim.stayWins,
          switch_win_rate: round(sim.switchWins / games, 4),
          stay_win_rate: round(sim.stayWins / games, 4),
        },
      };
    }
    if (action === "start" || !current?.game) {
      if (action !== "start") throw new Error('No game running. Call monty_hall with action "start" first.');
      if (current?.game?.phase === "choose") {
        return { response: { doors: 3, next: "A game is already waiting. Ask the student to pick door 1, 2 or 3." } };
      }
      const game = newMontyGame(rng);
      if (current) board.update(current.id, "monty", { game, sim: null });
      else board.add({ kind: "monty", game, sim: null });
      onBoardChange();
      return { response: { doors: 3, next: "Ask the student to pick door 1, 2 or 3." } };
    }
    if (action === "pick") {
      const door = clampInt(args.door, 1, 3, 1) as Door;
      const game = pickDoor(current.game, door, rng);
      board.update(current.id, "monty", { game });
      montyPickedAt = (ctx.now ?? Date.now)();
      if (game.phase !== "decide") throw new Error("unexpected state");
      return {
        response: {
          picked: door,
          host_opened: game.opened,
          behind_opened_door: "goat",
          next: `Stop here. Ask whether they want to stay with door ${door} or switch to door ${6 - door - game.opened}, and wait for their answer before calling switch or stay.`,
        },
      };
    }
    if (action === "switch" || action === "stay") {
      if (current.game.phase === "done") {
        const g = current.game;
        throw new Error(
          `This game is over: the student ${g.switched ? "switched" : "stayed"} and ${g.won ? "won the car" : "got a goat"}. Call start for a new game.`,
        );
      }
      if ((ctx.now ?? Date.now)() - montyPickedAt < MONTY_DECIDE_MS) {
        throw new Error("Wait for the student to say stay or switch before finishing the game.");
      }
      const game = decide(current.game, action === "switch");
      board.update(current.id, "monty", { game });
      if (game.phase !== "done") throw new Error("unexpected state");
      ctx.react(game.won ? "excited" : "oops", game.won ? "cheer" : "shrug");
      return {
        response: { final_door: game.final, car_was_behind: game.car, switched: game.switched, won_the_car: game.won },
      };
    }
    throw new Error(`Unknown action "${action}"`);
  },

  show_distribution(args, { board, onBoardChange }) {
    const family = str(args.family) as DistributionFamily;
    const params: DistributionParams = {
      n: num(args.n),
      p: num(args.p),
      lambda: num(args.lambda),
      mean: num(args.mean),
      sd: num(args.sd),
      min: num(args.min),
      max: num(args.max),
      rate: num(args.rate),
    };
    const dist = makeDistribution(family, params);
    const from = num(args.from);
    const to = num(args.to);
    board.add({ kind: "distribution", family, params, from, to });
    onBoardChange();
    const response: Record<string, unknown> = {
      distribution: dist.label,
      mean: round(dist.mean),
      variance: round(dist.variance),
    };
    if (from !== undefined || to !== undefined) {
      response.shaded = `P(${from ?? "-inf"} <= X <= ${to ?? "inf"})`;
      response.probability = round(probabilityBetween(dist, from, to), 8);
    }
    return { response };
  },

  calculate(args, { board, onBoardChange }) {
    const expression = str(args.expression);
    const result = calculate(expression);
    if (args.show_on_board !== false) {
      board.add({ kind: "calc", expression, text: result.text, fraction: result.fraction });
      onBoardChange();
    }
    return { response: { expression, result: result.text, ...(result.fraction ? { fraction: result.fraction } : {}) } };
  },

  async look_at_notebook(_args, { board, takeNotebookPhoto, onBoardChange }, signal) {
    const photo = await takeNotebookPhoto(signal);
    if (!photo)
      return { response: { error: "No camera is available, so ask the student to read their working out loud." } };
    board.add({ kind: "notebook", image: photo.dataUrl, marks: [] });
    onBoardChange();
    return {
      response: { photo: "attached", note: "Read the working step by step before you answer." },
      parts: [{ inlineData: { data: photo.base64, mimeType: "image/jpeg" } }],
    };
  },

  mark_notebook(args, { board, locate }) {
    const page = board.latest("notebook");
    if (!page) throw new Error("There's no notebook photo yet. Call look_at_notebook first.");
    const stepText = str(args.step_text);
    const raw = Array.isArray(args.box_2d) ? args.box_2d.map((v) => Math.min(1000, Math.max(0, num(v) ?? 0))) : [];
    const rough = raw.length === 4 && raw[2] > raw[0] && raw[3] > raw[1] ? (raw as NotebookMark["box"]) : null;
    if (!rough && !stepText) throw new Error("Give step_text, the step copied from the photo, so I can find it.");
    const verdict = (["mistake", "correct", "note"] as const).includes(args.verdict as NotebookMark["verdict"])
      ? (args.verdict as NotebookMark["verdict"])
      : "note";
    const mark: NotebookMark = {
      id: nextMarkId++,
      box: rough ?? [0, 0, 0, 0],
      label: str(args.label).slice(0, 80),
      verdict,
      refined: false,
      hidden: !rough,
    };
    board.update(page.id, "notebook", { marks: [...page.marks, mark] });
    // The Live model's boxes are rough; ask for a precise one and move the box when it arrives.
    if (stepText && locate) {
      const image = page.image.slice(page.image.indexOf(",") + 1);
      void locate(image, stepText)
        .then((box) => {
          const current = board.find(page.id, "notebook");
          if (!current || !box) return;
          board.update(page.id, "notebook", {
            marks: current.marks.map((m) => (m.id === mark.id ? { ...m, box, refined: true, hidden: false } : m)),
          });
        })
        .catch(() => {});
    }
    return { response: { marked: true } };
  },
};

/** Run one tool call and build the response for Gemini. Errors go back to the model as data. */
export async function runTool(call: FunctionCall, ctx: ToolContext, signal: AbortSignal): Promise<FunctionResponse> {
  const name = call.name ?? "";
  const handler = handlers[name];
  try {
    if (!handler) throw new Error(`There is no tool called ${name}`);
    const { response, parts } = await handler(call.args ?? {}, ctx, signal);
    return { id: call.id, name, response, ...(parts ? { parts } : {}) };
  } catch (err) {
    const message = err instanceof CalcError || err instanceof Error ? err.message : String(err);
    return { id: call.id, name, response: { error: message } };
  }
}

/** For tests: make simulations reproducible. */
export function seedTools(seed: number): void {
  rng = mulberry32(seed);
}
