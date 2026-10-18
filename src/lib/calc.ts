// A small, safe expression evaluator. Mochi calls it through the `calculate`
// tool so the numbers it says out loud are computed, not guessed, and the board
// uses it to draw function graphs. No eval, only the functions listed below.

import {
  binomialCdf,
  binomialPmf,
  combinations,
  factorial,
  geometricCdf,
  geometricPmf,
  inverseNormal,
  normalCdf,
  normalPdf,
  permutations,
  poissonCdf,
  poissonPmf,
} from "./stats";

export type Node =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "neg"; arg: Node }
  | { type: "fact"; arg: Node }
  | { type: "bin"; op: "+" | "-" | "*" | "/" | "^" | "%"; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] };

type Token =
  | { kind: "num"; value: number }
  | { kind: "id"; name: string }
  | { kind: "op"; op: string }
  | { kind: "(" | ")" | "," };

export class CalcError extends Error {}

const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: 2 * Math.PI };

type Fn = { arity: [number, number]; fn: (...a: number[]) => number };

const FUNCTIONS: Record<string, Fn> = {
  sqrt: { arity: [1, 1], fn: Math.sqrt },
  cbrt: { arity: [1, 1], fn: Math.cbrt },
  abs: { arity: [1, 1], fn: Math.abs },
  exp: { arity: [1, 1], fn: Math.exp },
  ln: { arity: [1, 1], fn: Math.log },
  log: { arity: [1, 2], fn: (x, b = 10) => Math.log(x) / Math.log(b) },
  log2: { arity: [1, 1], fn: Math.log2 },
  sin: { arity: [1, 1], fn: Math.sin },
  cos: { arity: [1, 1], fn: Math.cos },
  tan: { arity: [1, 1], fn: Math.tan },
  asin: { arity: [1, 1], fn: Math.asin },
  acos: { arity: [1, 1], fn: Math.acos },
  atan: { arity: [1, 1], fn: Math.atan },
  floor: { arity: [1, 1], fn: Math.floor },
  ceil: { arity: [1, 1], fn: Math.ceil },
  round: { arity: [1, 1], fn: Math.round },
  min: { arity: [1, 50], fn: Math.min },
  max: { arity: [1, 50], fn: Math.max },
  factorial: { arity: [1, 1], fn: factorial },
  ncr: { arity: [2, 2], fn: combinations },
  npr: { arity: [2, 2], fn: permutations },
  binompdf: { arity: [3, 3], fn: binomialPmf },
  binomcdf: { arity: [3, 3], fn: binomialCdf },
  poissonpdf: { arity: [2, 2], fn: poissonPmf },
  poissoncdf: { arity: [2, 2], fn: poissonCdf },
  geompdf: { arity: [2, 2], fn: geometricPmf },
  geomcdf: { arity: [2, 2], fn: geometricCdf },
  normalpdf: { arity: [1, 3], fn: (x, m = 0, s = 1) => normalPdf(x, m, s) },
  normalcdf: { arity: [2, 4], fn: (a, b, m = 0, s = 1) => normalCdf(b, m, s) - normalCdf(a, m, s) },
  invnorm: { arity: [1, 3], fn: (p, m = 0, s = 1) => inverseNormal(p, m, s) },
  mean: { arity: [1, 200], fn: (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length },
};

const ALIASES: Record<string, string> = {
  c: "ncr",
  comb: "ncr",
  choose: "ncr",
  p: "npr",
  perm: "npr",
  fact: "factorial",
};

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const s = src.replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\*\*/g, "^");
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (!m) throw new CalcError(`Can't read a number at "${s.slice(i, i + 8)}"`);
      out.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-zA-Zπ_]/.test(ch)) {
      const m = /^[a-zA-Zπ_][a-zA-Z0-9_]*/.exec(s.slice(i));
      if (!m) throw new CalcError("Can't read a name");
      out.push({ kind: "id", name: m[0] });
      i += m[0].length;
    } else if ("+-*/^!%".includes(ch)) {
      out.push({ kind: "op", op: ch });
      i++;
    } else if (ch === "(" || ch === ")" || ch === ",") {
      out.push({ kind: ch });
      i++;
    } else {
      throw new CalcError(`Unexpected "${ch}"`);
    }
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private readonly t: Token[]) {}

  parse(): Node {
    if (this.t.length === 0) throw new CalcError("The expression is empty");
    const node = this.additive();
    if (this.i < this.t.length) throw new CalcError("Unexpected input after the end of the expression");
    return node;
  }

  private peek(): Token | undefined {
    return this.t[this.i];
  }

  private isOp(op: string): boolean {
    const t = this.peek();
    return t?.kind === "op" && t.op === op;
  }

  private additive(): Node {
    let left = this.multiplicative();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.t[this.i++] as { op: "+" | "-" }).op;
      left = { type: "bin", op, left, right: this.multiplicative() };
    }
    return left;
  }

  private startsImplicitFactor(): boolean {
    const t = this.peek();
    return t?.kind === "(" || t?.kind === "id" || t?.kind === "num";
  }

  private multiplicative(): Node {
    let left = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
        const op = (this.t[this.i++] as { op: "*" | "/" | "%" }).op;
        left = { type: "bin", op, left, right: this.unary() };
      } else if (this.startsImplicitFactor()) {
        left = { type: "bin", op: "*", left, right: this.power() };
      } else {
        return left;
      }
    }
  }

  private unary(): Node {
    if (this.isOp("-")) {
      this.i++;
      return { type: "neg", arg: this.unary() };
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Node {
    const base = this.postfix();
    if (this.isOp("^")) {
      this.i++;
      return { type: "bin", op: "^", left: base, right: this.unary() };
    }
    return base;
  }

  private postfix(): Node {
    let node = this.primary();
    while (this.isOp("!")) {
      this.i++;
      node = { type: "fact", arg: node };
    }
    return node;
  }

  private primary(): Node {
    const t = this.t[this.i++];
    if (!t) throw new CalcError("The expression ends too early");
    if (t.kind === "num") return { type: "num", value: t.value };
    if (t.kind === "(") {
      const inner = this.additive();
      if (this.t[this.i++]?.kind !== ")") throw new CalcError("Missing a closing bracket");
      return inner;
    }
    if (t.kind === "id") {
      if (this.peek()?.kind === "(") {
        this.i++;
        const args: Node[] = [];
        if (this.peek()?.kind !== ")") {
          args.push(this.additive());
          while (this.peek()?.kind === ",") {
            this.i++;
            args.push(this.additive());
          }
        }
        if (this.t[this.i++]?.kind !== ")") throw new CalcError(`Missing ")" after ${t.name}(`);
        return { type: "call", name: t.name, args };
      }
      return { type: "var", name: t.name };
    }
    throw new CalcError(t.kind === "op" ? `Unexpected "${t.op}"` : `Unexpected "${t.kind}"`);
  }
}

export function parse(src: string): Node {
  if (src.length > 500) throw new CalcError("The expression is too long");
  return new Parser(tokenize(src)).parse();
}

const own = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

function resolveFunction(name: string): Fn | undefined {
  const lower = name.toLowerCase();
  return own(FUNCTIONS, lower) ?? own(FUNCTIONS, own(ALIASES, lower) ?? "");
}

export function evaluate(node: Node, vars: Record<string, number> = {}): number {
  switch (node.type) {
    case "num":
      return node.value;
    case "var": {
      const v = own(vars, node.name);
      if (v !== undefined) return v;
      const c = own(CONSTANTS, node.name) ?? own(CONSTANTS, node.name.toLowerCase());
      if (c === undefined) throw new CalcError(`Unknown name "${node.name}"`);
      return c;
    }
    case "neg":
      return -evaluate(node.arg, vars);
    case "fact":
      return factorial(evaluate(node.arg, vars));
    case "bin": {
      const a = evaluate(node.left, vars);
      const b = evaluate(node.right, vars);
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "%":
          return a % b;
        case "^":
          return a ** b;
      }
      break;
    }
    case "call": {
      const f = resolveFunction(node.name);
      if (!f) throw new CalcError(`Unknown function "${node.name}"`);
      const [lo, hi] = f.arity;
      if (node.args.length < lo || node.args.length > hi) {
        throw new CalcError(`${node.name} takes ${lo === hi ? lo : `${lo} to ${hi}`} arguments`);
      }
      return f.fn(...node.args.map((a) => evaluate(a, vars)));
    }
  }
  throw new CalcError("Unsupported expression");
}

/** Best rational approximation with a small denominator, or undefined. */
export function toFraction(x: number, maxDen = 10000): string | undefined {
  if (!Number.isFinite(x) || Number.isInteger(x)) return undefined;
  const sign = x < 0 ? "-" : "";
  let v = Math.abs(x);
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(v);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > maxDen) return undefined;
    if (Math.abs(h1 / k1 - Math.abs(x)) < 1e-12 * Math.max(1, Math.abs(x))) {
      return `${sign}${h1}/${k1}`;
    }
    const frac = v - a;
    if (frac < 1e-15) break;
    v = 1 / frac;
  }
  return undefined;
}

export function formatNumber(x: number): string {
  if (Number.isNaN(x)) return "undefined";
  if (!Number.isFinite(x)) return x > 0 ? "infinity" : "-infinity";
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const s = x.toPrecision(10);
  return s.includes("e") ? s : s.replace(/\.?0+$/, "");
}

export interface CalcResult {
  value: number;
  text: string;
  fraction?: string;
}

export function calculate(src: string): CalcResult {
  const value = evaluate(parse(src));
  return { value, text: formatNumber(value), fraction: toFraction(value) };
}

/** Compile an expression in x for plotting. Throws CalcError on bad input. */
export function compileFunction(src: string): (x: number) => number {
  const ast = parse(src.replace(/^\s*y\s*=\s*/i, ""));
  evaluate(ast, { x: 1 });
  return (x: number) => evaluate(ast, { x });
}
