// Tool handlers for the animated board pictures: diagrams, probability trees,
// number lines, Venn diagrams, bar charts and pictures from Wikimedia. Each
// one checks what the model sent, fills in sensible ranges, and tells the
// model what was actually drawn so it can talk about it.

import { CalcError, calculate, compileFunction } from "../lib/calc";
import { stripEmoji } from "../shared/text";
import type { BarSpec, ChalkColor, DiagramShape, DiagramSpec, NumberLineSpec, TreeBranch, VennSpec, XY } from "./store";
import type { ToolContext } from "./tools";

type Args = Record<string, unknown>;
type Result = { response: Record<string, unknown> };

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string => (typeof v === "string" ? stripEmoji(v).trim() : "");
const round = (x: number, digits = 6) => Number(x.toPrecision(digits));
const COLORS: readonly ChalkColor[] = ["yellow", "blue", "pink", "green", "chalk"];
const color = (v: unknown, i: number): ChalkColor =>
  COLORS.includes(v as ChalkColor) ? (v as ChalkColor) : COLORS[i % 4];

function xy(v: unknown): XY | null {
  const o = v as { x?: unknown; y?: unknown } | null;
  const x = num(o?.x);
  const y = num(o?.y);
  return x === undefined || y === undefined ? null : { x, y };
}

function points(v: unknown, min: number, max: number): XY[] {
  const list = Array.isArray(v) ? v.map(xy).filter((p): p is XY => p !== null) : [];
  if (list.length < min) throw new Error(`needs at least ${min} points as {x, y}`);
  return list.slice(0, max);
}

/** A round step that splits a span into about `count` parts. */
export function niceStep(span: number, count = 10): number {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
}

const FN_TYPES = new Set(["function", "area", "tangent", "moving_point"]);

function parseShape(raw: unknown, i: number): DiagramShape {
  const r = (raw ?? {}) as Args;
  const type = str(r.type);
  const c = color(r.color, i);
  const label = str(r.label).slice(0, 60) || undefined;
  if (FN_TYPES.has(type)) {
    const expression = str(r.expression);
    if (!expression) throw new Error(`${type} needs an expression in x`);
    compileFunction(expression);
    if (type === "function") return { type, expression, color: c, dashed: r.dashed === true, label };
    const at = num(r.x);
    // A tangent "at x = 1" without a range still slides a little either side, then rests there.
    const from = num(r.from) ?? (type === "tangent" && at !== undefined ? at - 1.5 : undefined);
    const to = num(r.to) ?? (type === "tangent" && at !== undefined ? at + 1.5 : undefined);
    if (from === undefined || to === undefined || from === to) throw new Error(`${type} needs from and to`);
    const [a, b] = from < to ? [from, to] : [to, from];
    if (type === "area") return { type, expression, from: a, to: b, color: c, label };
    if (type === "tangent") {
      const settle = at !== undefined && at >= a && at <= b ? at : undefined;
      return { type, expression, from: a, to: b, color: c, ...(settle !== undefined ? { settle } : {}) };
    }
    return { type: "moving_point", expression, from: a, to: b, color: c, label };
  }
  const at = xy(r);
  switch (type) {
    case "point":
      if (!at) throw new Error("point needs x and y");
      return { type, at, color: c, label };
    case "label": {
      const text = str(r.text) || label;
      if (!at || !text) throw new Error("label needs x, y and text");
      return { type, at, text: text.slice(0, 60), color: c };
    }
    case "circle": {
      const radius = num(r.radius);
      if (!at || !radius || radius <= 0) throw new Error("circle needs x, y and a radius");
      return { type, at, radius, color: c, label };
    }
    case "segment":
    case "arrow": {
      const [from, to] = points(r.points, 2, 2);
      return { type, from, to, color: c, dashed: r.dashed === true, label };
    }
    case "polygon": {
      const ps = points(r.points, 3, 12);
      const vertexLabels = Array.isArray(r.vertex_labels) ? r.vertex_labels.map((v) => str(v).slice(0, 12)) : undefined;
      return { type, points: ps, color: c, fill: r.fill === true, vertexLabels, label };
    }
    case "angle": {
      if (!at) throw new Error("angle needs the vertex as x and y");
      const [from, to] = points(r.points, 2, 2);
      return { type, at, from, to, color: c, label };
    }
    default:
      throw new Error(`unknown type "${type}"`);
  }
}

function coords(s: DiagramShape): XY[] {
  switch (s.type) {
    case "point":
    case "label":
      return [s.at];
    case "circle":
      return [
        { x: s.at.x - s.radius, y: s.at.y - s.radius },
        { x: s.at.x + s.radius, y: s.at.y + s.radius },
      ];
    case "segment":
    case "arrow":
      return [s.from, s.to];
    case "polygon":
      return s.points;
    case "angle":
      return [s.at, s.from, s.to];
    case "area":
    case "tangent":
    case "moving_point":
      return [
        { x: s.from, y: 0 },
        { x: s.to, y: 0 },
      ];
    default:
      return [];
  }
}

function padRange(lo: number, hi: number, share = 0.12, minSpan = 2): [number, number] {
  let span = hi - lo;
  if (span < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
    span = minSpan;
  }
  return [round(lo - span * share, 4), round(hi + span * share, 4)];
}

export function drawDiagram(args: Args, { board, onBoardChange }: ToolContext): Result {
  const raw = Array.isArray(args.items) ? args.items.slice(0, 30) : [];
  const shapes: DiagramShape[] = [];
  const skipped: string[] = [];
  raw.forEach((r, i) => {
    try {
      shapes.push(parseShape(r, i));
    } catch (err) {
      skipped.push(`item ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  if (!shapes.length) throw new Error(skipped[0] ?? "Give items to draw.");

  const pts = shapes.flatMap(coords);
  const hasFn = shapes.some((s) => FN_TYPES.has(s.type));
  let xRange: [number, number];
  const xMin = num(args.x_min);
  const xMax = num(args.x_max);
  if (xMin !== undefined && xMax !== undefined && xMax > xMin) xRange = [xMin, xMax];
  else if (pts.length) xRange = padRange(Math.min(0, ...pts.map((p) => p.x)), Math.max(0, ...pts.map((p) => p.x)));
  else xRange = [-5, 5];

  let yRange: [number, number];
  const yMin = num(args.y_min);
  const yMax = num(args.y_max);
  if (yMin !== undefined && yMax !== undefined && yMax > yMin) yRange = [yMin, yMax];
  else {
    const ys = pts.map((p) => p.y);
    for (const s of shapes) {
      if (!("expression" in s)) continue;
      const f = compileFunction(s.expression);
      for (let k = 0; k <= 200; k++) {
        try {
          const y = f(xRange[0] + ((xRange[1] - xRange[0]) * k) / 200);
          if (Number.isFinite(y)) ys.push(y);
        } catch {
          // a gap in the curve
        }
      }
    }
    ys.sort((a, b) => a - b);
    // Ignore the wildest 2% so one asymptote doesn't flatten the whole graph.
    const lo = ys[Math.floor(ys.length * 0.02)] ?? -5;
    const hi = ys[Math.max(0, Math.ceil(ys.length * 0.98) - 1)] ?? 5;
    yRange = padRange(Math.min(0, lo), Math.max(0, hi));
  }
  const equal = typeof args.equal_axes === "boolean" ? args.equal_axes : !hasFn;
  if (equal) {
    // Grow the narrower range so one unit is the same length both ways.
    const sx = xRange[1] - xRange[0];
    const sy = yRange[1] - yRange[0];
    const ratio = Math.min(1.25, Math.max(0.5, sy / sx));
    const wantSy = sx * ratio;
    if (sy < wantSy) {
      const mid = (yRange[0] + yRange[1]) / 2;
      yRange = [round(mid - wantSy / 2, 4), round(mid + wantSy / 2, 4)];
    } else {
      const wantSx = sy / ratio;
      const mid = (xRange[0] + xRange[1]) / 2;
      xRange = [round(mid - wantSx / 2, 4), round(mid + wantSx / 2, 4)];
    }
  }
  const spec: DiagramSpec = {
    title: str(args.title).slice(0, 80) || undefined,
    xRange,
    yRange,
    axes: args.axes !== false,
    grid: args.grid === true,
    equal,
    shapes,
  };
  board.add({ kind: "diagram", spec });
  onBoardChange();
  return {
    response: { drawn: shapes.length, x_range: xRange, y_range: yRange, ...(skipped.length ? { skipped } : {}) },
  };
}

export function probabilityTree(args: Args, { board, onBoardChange }: ToolContext): Result {
  const raw = Array.isArray(args.branches) ? args.branches.slice(0, 30) : [];
  const branches: TreeBranch[] = [];
  const known = new Set<string>([""]);
  for (const r of raw) {
    const b = (r ?? {}) as Args;
    const path = str(b.from)
      .split(">")
      .map((s) => s.trim())
      .filter(Boolean);
    const label = str(b.label).slice(0, 24);
    const probability = str(b.probability).slice(0, 16);
    if (!label || !probability || path.length > 3) continue;
    if (!known.has(path.join(" > "))) continue;
    known.add([...path, label].join(" > "));
    branches.push({ path, label, probability });
  }
  if (!branches.length) throw new Error('Give branches like {from: "", label: "Red", probability: "3/5"}.');
  const highlight = str(args.highlight)
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
  let product: { expression: string; value: string } | undefined;
  if (highlight.length) {
    if (!known.has(highlight.join(" > ")))
      throw new Error(`highlight "${highlight.join(" > ")}" isn't a path on the tree.`);
    const probs = highlight.map((_, i) => {
      const b = branches.find(
        (x) => x.path.join(" > ") === highlight.slice(0, i).join(" > ") && x.label === highlight[i],
      );
      return b?.probability ?? "1";
    });
    const expression = probs.join(" × ");
    try {
      const r = calculate(probs.map((p) => `(${p})`).join("*"));
      product = { expression, value: r.fraction ?? r.text };
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
    }
  }
  board.add({
    kind: "tree",
    spec: {
      title: str(args.title).slice(0, 80) || undefined,
      branches,
      highlight: highlight.length ? highlight : undefined,
      product,
    },
  });
  onBoardChange();
  return { response: { branches: branches.length, ...(product ? { highlighted_probability: product.value } : {}) } };
}

export function numberLine(args: Args, { board, onBoardChange }: ToolContext): Result {
  let from = num(args.from) ?? -10;
  let to = num(args.to) ?? 10;
  if (to <= from) [from, to] = [Math.min(from, to), Math.max(from, to) + (from === to ? 10 : 0)];
  const stepArg = num(args.step);
  const step = stepArg && stepArg > 0 && (to - from) / stepArg <= 40 ? stepArg : niceStep(to - from);
  const listOf = (v: unknown) => (Array.isArray(v) ? v.slice(0, 12) : []) as Args[];
  const spec: NumberLineSpec = {
    from,
    to,
    step,
    points: listOf(args.points).flatMap((p, i) => {
      const value = num(p.value);
      return value === undefined
        ? []
        : [{ value, label: str(p.label).slice(0, 24) || undefined, open: p.open === true, color: color(p.color, i) }];
    }),
    intervals: listOf(args.intervals).map((iv, i) => ({
      from: num(iv.from) ?? null,
      to: num(iv.to) ?? null,
      fromOpen: iv.from_open === true,
      toOpen: iv.to_open === true,
      color: color(iv.color, i + 1),
      label: str(iv.label).slice(0, 30) || undefined,
    })),
    jumps: listOf(args.jumps).flatMap((j) => {
      const a = num(j.from);
      const b = num(j.to);
      return a === undefined || b === undefined
        ? []
        : [{ from: a, to: b, label: str(j.label).slice(0, 16) || undefined }];
    }),
  };
  board.add({ kind: "numberline", spec });
  onBoardChange();
  return {
    response: {
      from,
      to,
      step,
      points: spec.points.length,
      intervals: spec.intervals.length,
      jumps: spec.jumps.length,
    },
  };
}

/** Every membership mask for n sets, like "10" and "01". */
const masks = (n: number) => Array.from({ length: 2 ** n }, (_, k) => k.toString(2).padStart(n, "0"));

/**
 * The regions a description like "A or B", "only B", "A and not C", "neither"
 * or "A ∩ B" covers, as membership masks. Sets can be named by letter or by name.
 */
export function vennRegions(expr: string, sets: string[]): string[] {
  const names = sets.map((s) => s.toLowerCase());
  const tokens = expr
    .toLowerCase()
    .replace(/∪/g, " or ")
    .replace(/∩/g, " and ")
    .replace(/([a-c])'/g, " not $1 ")
    .replace(/[()]/g, (m) => ` ${m} `)
    .split(/\s+/)
    .filter((t) => t && t !== "set" && t !== "the" && t !== "in");
  let i = 0;
  const setIndex = (t: string) => {
    const letter = ["a", "b", "c"].indexOf(t);
    if (letter >= 0 && letter < sets.length) return letter;
    const named = names.indexOf(t);
    return named;
  };
  // "A and B only" or "only A and C": in exactly the sets named, and no others.
  if ((tokens.at(-1) === "only" || tokens[0] === "only") && !tokens.includes("or") && !tokens.includes("not")) {
    const named = new Set(tokens.map(setIndex).filter((k) => k >= 0));
    if (named.size) return masks(sets.length).filter((m) => [...m].every((b, j) => (b === "1") === named.has(j)));
  }
  type Pred = (m: string) => boolean;
  const parseExpr = (): Pred => {
    let left = parseTerm();
    while (tokens[i] === "or") {
      i++;
      const right = parseTerm();
      const l = left;
      left = (m) => l(m) || right(m);
    }
    return left;
  };
  const parseTerm = (): Pred => {
    let left = parseFactor();
    while (tokens[i] === "and" || tokens[i] === "but") {
      i++;
      const right = parseFactor();
      const l = left;
      left = (m) => l(m) && right(m);
    }
    return left;
  };
  const parseFactor = (): Pred => {
    const t = tokens[i++];
    if (t === "not") {
      const inner = parseFactor();
      return (m) => !inner(m);
    }
    if (t === "neither" || t === "none" || t === "outside") return (m) => !m.includes("1");
    if (t === "(") {
      const inner = parseExpr();
      if (tokens[i] === ")") i++;
      return inner;
    }
    if (t === "only") {
      const k = setIndex(tokens[i++] ?? "");
      if (k < 0) throw new Error(`"${expr}" names a set that isn't on the diagram`);
      return (m) => [...m].every((b, j) => (j === k ? b === "1" : b === "0"));
    }
    const k = setIndex(t ?? "");
    if (k < 0) throw new Error(`"${expr}" names a set that isn't on the diagram`);
    if (tokens[i] === "only") {
      i++;
      return (m) => [...m].every((b, j) => (j === k ? b === "1" : b === "0"));
    }
    return (m) => m[k] === "1";
  };
  return masks(sets.length).filter(parseExpr());
}

export function vennDiagram(args: Args, { board, onBoardChange }: ToolContext): Result {
  const sets = (Array.isArray(args.sets) ? args.sets : [])
    .map((s) => str(s).slice(0, 24))
    .filter(Boolean)
    .slice(0, 3);
  if (sets.length < 2) throw new Error("Give two or three set names.");
  const values: Record<string, string> = {};
  const problems: string[] = [];
  for (const r of (Array.isArray(args.values) ? args.values.slice(0, 8) : []) as Args[]) {
    const region = str(r.region);
    const value = str(r.value).slice(0, 12);
    if (!region || !value) continue;
    try {
      const hit = vennRegions(region, sets);
      if (hit.length !== 1)
        problems.push(`"${region}" covers ${hit.length} parts; say it with "only", like "A and B only"`);
      else values[hit[0]] = value;
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  const shadeText = str(args.shade);
  const shaded = shadeText ? vennRegions(shadeText, sets) : [];
  const spec: VennSpec = {
    title: str(args.title).slice(0, 80) || undefined,
    sets,
    values,
    shaded,
    caption: shadeText || undefined,
  };
  board.add({ kind: "venn", spec });
  onBoardChange();
  return {
    response: {
      sets,
      shaded_parts: shaded.length,
      values: Object.keys(values).length,
      ...(problems.length ? { skipped: problems } : {}),
    },
  };
}

export function barChart(args: Args, { board, onBoardChange }: ToolContext): Result {
  const bars = (Array.isArray(args.bars) ? args.bars.slice(0, 16) : []).flatMap((r) => {
    const b = (r ?? {}) as Args;
    const value = num(b.value);
    const label = str(b.label).slice(0, 14);
    return value === undefined || !label ? [] : [{ label, value, highlight: b.highlight === true }];
  });
  if (!bars.length) throw new Error("Give bars as {label, value}.");
  const values = bars.map((b) => b.value);
  const total = values.reduce((a, b) => a + b, 0);
  const mean = total / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const spec: BarSpec = {
    title: str(args.title).slice(0, 80) || undefined,
    bars,
    mean: args.show_mean === true ? mean : undefined,
    yLabel: str(args.y_label).slice(0, 60) || undefined,
  };
  board.add({ kind: "bars", spec });
  onBoardChange();
  return { response: { bars: bars.length, total: round(total), mean: round(mean), median: round(median) } };
}

export async function showImage(args: Args, ctx: ToolContext, signal: AbortSignal): Promise<Result> {
  const query = str(args.query).slice(0, 80);
  if (!query) throw new Error("Give a short search like 'cricket pitch'.");
  if (!ctx.findImage) throw new Error("Pictures aren't available here. Draw it instead.");
  const hit = await ctx.findImage(query, signal);
  if (!hit) throw new Error(`No free picture of "${query}" turned up. Describe it, or draw it with draw_diagram.`);
  ctx.board.add({
    kind: "image",
    src: `/api/images/${hit.id}`,
    title: hit.title,
    credit: hit.credit,
    caption: str(args.caption).slice(0, 80) || undefined,
  });
  ctx.onBoardChange();
  return { response: { showing: hit.title, credit: hit.credit } };
}
