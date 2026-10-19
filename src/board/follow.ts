// Which board line is Mochi talking about? Her speech arrives as a live
// transcript ("six times six, yaani thirty-six"), the board holds LaTeX
// ("6 \times 6 = 36"), so both are boiled down to numbers and content words
// and the line that shares the most with her last few words wins. This needs
// no tool call, so it costs her no pause.

const UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Words too common in her Hinglish or in maths talk to say which line she means. */
const STOPWORDS = new Set(
  (
    "the and that this with from have will what when then than there their they them your into about which " +
    "hain hota hote hoti toh yaani aur kya kyun kaise yeh woh agar lekin bhi mein main hum tum aap apna " +
    "karte karo karna karenge dekho dekhte chalo board likh likhti likhta deti hoon bata batao matlab " +
    "hamare tumhare abhi pehle phir baad wala wali wale isko usko inko unko sabse bahut"
  ).split(" "),
);

/** Spoken English numbers ("thirty-six", "one hundred and five") to digits; other words pass through. */
export function wordsToNumbers(words: string[]): string[] {
  const out: string[] = [];
  let value: number | null = null;
  let current = 0;
  const flush = () => {
    if (value !== null) out.push(String(value + current));
    value = null;
    current = 0;
  };
  for (const w of words) {
    const unit = UNITS.indexOf(w);
    const ten = TENS.indexOf(w);
    if (unit >= 0 || ten >= 2) {
      // "six six" is two numbers; "thirty six" is one.
      if (value !== null && (unit >= 0 ? current % 10 !== 0 || current === 0 : current !== 0)) flush();
      value ??= 0;
      current += unit >= 0 ? unit : ten * 10;
    } else if (w === "hundred" && value !== null) {
      current = (current || 1) * 100;
    } else if (w === "thousand" && value !== null) {
      value += (current || 1) * 1000;
      current = 0;
    } else if (w === "and" && value !== null) {
      // "one hundred and five" keeps going.
    } else {
      flush();
      out.push(w);
    }
  }
  flush();
  return out;
}

/** A board line as plain words and numbers: LaTeX commands, braces and symbols dropped. */
export function plainText(content: string): string {
  return (
    content
      .replace(/\\(frac|dfrac|tfrac)\s*\{([^}]*)\}\s*\{([^}]*)\}/g, " $2 by $3 ")
      // "6 x 6" is a product, not the letter x, and 6/36 is said "6 by 36".
      .replace(/(\d)\s*[x×]\s*(?=\d)/g, "$1 ")
      .replace(/(\d)\s*\/\s*(?=\d)/g, "$1 by ")
      .replace(/\\[a-zA-Z]+/g, " ")
      .replace(/[{}^_$\\()[\]=+\-*/×÷·,.:;!?'"|<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}

export interface Tokens {
  numbers: Set<string>;
  words: Set<string>;
}

export function tokens(text: string): Tokens {
  // Keep the dot in 0.5, drop it at the end of "thirty-six." (commas never join: "(1,6)" is a pair).
  const raw = text
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
  const numbers = new Set<string>();
  const words = new Set<string>();
  for (const n of wordsToNumbers(raw)) {
    if (/^\d+(\.\d+)?$/.test(n)) numbers.add(n);
    else if (n.length >= 4 && !STOPWORDS.has(n)) words.add(n);
  }
  return { numbers, words };
}

/** How many of her latest words decide which line she's on. */
const WINDOW_WORDS = 7;

export interface FollowLine {
  id: number;
  content: string;
}

/** Score every line against some spoken words. */
export function scoreLines(lines: FollowLine[], spoken: string): Map<number, number> {
  const scores = new Map<number, number>();
  const said = tokens(spoken);
  if (!said.numbers.size && !said.words.size) return scores;
  const lineTokens = lines.map((l) => ({ id: l.id, t: tokens(plainText(l.content)) }));
  // A word on every line says nothing about which one she means.
  const df = new Map<string, number>();
  for (const { t } of lineTokens) for (const k of [...t.numbers, ...t.words]) df.set(k, (df.get(k) ?? 0) + 1);
  for (const { id, t } of lineTokens) {
    let score = 0;
    for (const n of said.numbers) if (t.numbers.has(n)) score += 2 / (df.get(n) ?? 1);
    for (const w of said.words) if (t.words.has(w)) score += 1.2 / (df.get(w) ?? 1);
    // A line full of numbers she didn't say is a worse match than a short one she said all of.
    if (score > 0) for (const n of t.numbers) if (!said.numbers.has(n)) score -= 0.15;
    if (score > 0) scores.set(id, score);
  }
  return scores;
}

/** The line that best matches some spoken words; later lines win ties, since she usually means what she just wrote. */
export function bestLine(lines: FollowLine[], spoken: string): { id: number; score: number } | null {
  let best: { id: number; score: number } | null = null;
  for (const [id, score] of scoreLines(lines, spoken)) if (!best || score >= best.score) best = { id, score };
  return best;
}

/** Find the line a tool call means by a snippet of its text, preferring the newest match. */
export function findLine(lines: FollowLine[], query: string): FollowLine | null {
  const q = plainText(query);
  if (!q) return lines.at(-1) ?? null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (` ${plainText(lines[i].content)} `.includes(` ${q} `)) return lines[i];
  }
  const hit = bestLine(lines, query);
  if (!hit) return null;
  const qt = tokens(q);
  const need = Math.max(1, Math.ceil((qt.numbers.size + qt.words.size) * 0.5));
  return hit.score >= need * 0.9 ? (lines.find((l) => l.id === hit.id) ?? null) : null;
}

/**
 * Follows Mochi's live transcript and says which line she's on. Switches only
 * when another line clearly matches better, and lets go a while after she stops
 * mentioning anything on the board.
 */
export class SpeechFollower {
  private recent: string[] = [];
  private current: { id: number; score: number; at: number } | null = null;

  constructor(
    private readonly getLines: () => FollowLine[],
    private readonly onFocus: (id: number | null) => void,
    private readonly holdMs = 1400,
    private readonly releaseMs = 4500,
  ) {}

  push(chunk: string, now = performance.now()): void {
    this.recent.push(...chunk.split(/\s+/).filter(Boolean));
    if (this.recent.length > WINDOW_WORDS) this.recent = this.recent.slice(-WINDOW_WORDS);
    const scores = scoreLines(this.getLines(), this.recent.join(" "));
    let hit: { id: number; score: number } | null = null;
    for (const [id, score] of scores) if (!hit || score >= hit.score) hit = { id, score };
    if (!hit || hit.score < 1.6) {
      this.tick(now);
      return;
    }
    if (this.current?.id === hit.id) {
      this.current = { ...hit, at: now };
      return;
    }
    // Hold the current line briefly while she is still saying things from it, so the pointer doesn't flicker.
    const still = this.current ? (scores.get(this.current.id) ?? 0) : 0;
    const held = this.current && still > 0 && now - this.current.at < this.holdMs;
    if (held && hit.score < still + 1) return;
    this.current = { ...hit, at: now };
    this.onFocus(hit.id);
  }

  /** Drop the highlight once she has moved on. */
  tick(now = performance.now()): void {
    if (this.current && now - this.current.at > this.releaseMs) {
      this.current = null;
      this.onFocus(null);
    }
  }

  reset(): void {
    this.recent = [];
    if (this.current) this.onFocus(null);
    this.current = null;
  }
}
