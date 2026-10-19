import katex from "katex";
import { useMemo } from "react";

/** Words maths mode should keep as operator names rather than turn into text. */
const FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "log",
  "ln",
  "exp",
  "lim",
  "max",
  "min",
  "det",
  "gcd",
  "mod",
  "arg",
]);

/**
 * Plain words inside a formula ("Total outcomes = 6 times 6") come out of
 * maths mode squashed and in italics, so runs of real words become \text{...}
 * with their spaces, and the word "times" becomes a times sign. LaTeX commands,
 * existing \text{...} and single-letter variables are left alone.
 */
export function textifyWords(tex: string): string {
  const kept: string[] = [];
  // \uE000 marks something held back untouched, \uE001 a run of words now set as text.
  const hold = (m: string, mark = "\uE000") => `${mark}${kept.push(m) - 1}${mark}`;
  const guarded = tex
    .replace(/\\(?:text|mathrm|textbf|operatorname)\s*\{[^{}]*\}/g, (m) => hold(m))
    .replace(/\\[a-zA-Z]+/g, (m) => hold(m))
    .replace(/(?<![a-zA-Z])times(?![a-zA-Z])/g, () => hold("\\times"));
  const words = guarded.replace(/[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*/g, (run) =>
    FUNCTIONS.has(run.toLowerCase()) ? hold(`\\${run.toLowerCase()}`) : hold(`\\text{${run}}`, "\uE001"),
  );
  // Maths mode drops spaces, so keep the ones around text explicitly.
  const spaced = words.replace(/\s+(?=\uE001)|(?<=\uE001\d+\uE001)\s+/g, "\\ ");
  return spaced.replace(/[\uE000\uE001](\d+)[\uE000\uE001]/g, (_, i: string) => kept[Number(i)]);
}

function render(tex: string, display: boolean): string {
  // The model often writes 6 * 6; in LaTeX that's a raised asterisk, so make it a times sign.
  const clean = textifyWords(tex.replace(/\s*\*\s*/g, " \\times "));
  return katex.renderToString(clean, { throwOnError: false, displayMode: display, output: "html", strict: "ignore" });
}

/** A whole LaTeX expression. */
export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => render(tex.replace(/^\$+|\$+$/g, "").trim(), display), [tex, display]);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output, generated locally from a string with trust disabled
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
  n: "ⁿ",
};

/** Arrows, products and powers typed as ASCII, drawn the way they'd be written in chalk. */
export function plainMaths(text: string): string {
  return text
    .replace(/->/g, "→")
    .replace(/=>/g, "⇒")
    .replace(/([\d)])\s*\*\s*(?=[\d(])/g, "$1 × ")
    .replace(/\^\{?(-?[0-9n]{1,3})\}?/g, (_, p: string) => [...p].map((c) => SUPERSCRIPT[c] ?? c).join(""));
}

const INLINE = /\\\((.+?)\\\)|\$(.+?)\$/g;

/**
 * LaTeX commands written without \\( \\) around them, like "Probability = \\frac{1}{6}", would show up as
 * raw backslashes, so each command and its braces become a little inline formula.
 */
export function wrapBareLatex(text: string): string {
  if (/\\\(|\$/.test(text) || !/\\[a-zA-Z]/.test(text)) return text;
  return text.replace(/\\[a-zA-Z]+(?:\s*\{[^{}]*\}){0,2}(?:\s*[\^_]\s*(?:\{[^{}]*\}|\w))?/g, (m) => `\\(${m}\\)`);
}

/** Text with inline maths in \( \) or $ $. */
export function RichText({ text: raw }: { text: string }) {
  const text = wrapBareLatex(raw);
  const parts = useMemo(() => {
    const out: Array<{ math: boolean; value: string }> = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      if (m.index > last) out.push({ math: false, value: text.slice(last, m.index) });
      out.push({ math: true, value: m[1] ?? m[2] ?? "" });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ math: false, value: text.slice(last) });
    return out;
  }, [text]);
  return (
    <>
      {parts.map((p, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are derived from a fixed string
        p.math ? <Tex key={i} tex={p.value} /> : <span key={i}>{plainMaths(p.value)}</span>,
      )}
    </>
  );
}
