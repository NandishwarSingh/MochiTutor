import katex from "katex";
import { useMemo } from "react";

function render(tex: string, display: boolean): string {
  // The model often writes 6 * 6; in LaTeX that's a raised asterisk, so make it a times sign.
  const clean = tex.replace(/\s*\*\s*/g, " \\times ");
  return katex.renderToString(clean, { throwOnError: false, displayMode: display, output: "html", strict: "ignore" });
}

/** A whole LaTeX expression. */
export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => render(tex.replace(/^\$+|\$+$/g, "").trim(), display), [tex, display]);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output, generated locally from a string with trust disabled
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

const INLINE = /\\\((.+?)\\\)|\$(.+?)\$/g;

/** Text with inline maths in \( \) or $ $. */
export function RichText({ text }: { text: string }) {
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
        p.math ? <Tex key={i} tex={p.value} /> : <span key={i}>{p.value}</span>,
      )}
    </>
  );
}
