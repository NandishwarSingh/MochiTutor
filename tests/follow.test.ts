import { describe, expect, test } from "bun:test";
import { bestLine, findLine, plainText, SpeechFollower, tokens, wordsToNumbers } from "../src/board/follow";

describe("wordsToNumbers", () => {
  test("joins spoken numbers and keeps other words", () => {
    expect(wordsToNumbers("six times six yaani thirty six".split(" "))).toEqual(["6", "times", "6", "yaani", "36"]);
    expect(wordsToNumbers(["one", "hundred", "and", "five"])).toEqual(["105"]);
    expect(wordsToNumbers(["six", "six"])).toEqual(["6", "6"]);
    expect(wordsToNumbers(["twenty", "thirty"])).toEqual(["20", "30"]);
    expect(wordsToNumbers(["two", "thousand", "twenty", "six"])).toEqual(["2026"]);
  });
});

describe("plainText and tokens", () => {
  test("LaTeX boils down to numbers and words", () => {
    expect(plainText("P(\\text{sum}=7) = \\frac{6}{36}")).toBe("p sum 7 6 by 36");
    expect(plainText("6/36")).toBe("6 by 36");
    expect(plainText("6 x 6 = 36")).toBe("6 6 36");
    const t = tokens("Total possible outcomes are thirty-six");
    expect([...t.numbers]).toEqual(["36"]);
    expect([...t.words].sort()).toEqual(["outcomes", "possible", "total"]);
  });
});

const lines = [
  { id: 1, content: "Two dice: P(sum = 7)" },
  { id: 2, content: "Total outcomes:" },
  { id: 3, content: "6 \\times 6 = 36" },
  { id: 4, content: "P(\\text{sum}=7) = \\frac{6}{36} = \\frac{1}{6}" },
];

describe("bestLine", () => {
  test("what she says picks the line she's on", () => {
    expect(bestLine(lines, "toh total outcomes hote hain")?.id).toBe(2);
    expect(bestLine(lines, "six times six yaani thirty-six")?.id).toBe(3);
    expect(bestLine(lines, "isliye probability one by six")?.id).toBe(4);
    expect(bestLine(lines, "accha chalo")).toBeNull();
  });
});

describe("findLine", () => {
  test("a snippet finds its line, newest first", () => {
    expect(findLine(lines, "6/36")?.id).toBe(4);
    expect(findLine(lines, "6 x 6 = 36")?.id).toBe(3);
    expect(findLine(lines, "total outcomes")?.id).toBe(2);
    expect(findLine(lines, "binomial theorem")).toBeNull();
    expect(findLine(lines, "")?.id).toBe(4);
  });
});

describe("SpeechFollower", () => {
  test("follows her through the board and lets go when she moves on", () => {
    const seen: Array<number | null> = [];
    const f = new SpeechFollower(
      () => lines,
      (id) => seen.push(id),
      1000,
      3000,
    );
    f.push("Dekho, total outcomes", 0);
    f.push("hote hain six times six,", 1500);
    f.push("yaani thirty-six.", 1700);
    f.tick(3000);
    f.tick(5000);
    expect(seen).toEqual([2, 3, null]);
  });

  test("doesn't flicker to a weaker match while holding a line", () => {
    const seen: Array<number | null> = [];
    const f = new SpeechFollower(
      () => lines,
      (id) => seen.push(id),
      1500,
      4000,
    );
    f.push("six times six thirty-six", 0);
    f.push("total", 200);
    expect(seen).toEqual([3]);
  });
});

describe("wrapBareLatex", () => {
  test("bare LaTeX commands become inline maths, delimited text is left alone", async () => {
    const { wrapBareLatex } = await import("../src/board/Tex");
    expect(wrapBareLatex("Probability = \\frac{1}{6}")).toBe("Probability = \\(\\frac{1}{6}\\)");
    expect(wrapBareLatex("Total = 6 \\times 6")).toBe("Total = 6 \\(\\times\\) 6");
    expect(wrapBareLatex("Area = \\pi r^2")).toBe("Area = \\(\\pi\\) r^2");
    expect(wrapBareLatex("Already \\(x^2\\) here")).toBe("Already \\(x^2\\) here");
    expect(wrapBareLatex("plain words")).toBe("plain words");
  });
});

describe("textifyWords", () => {
  test("plain words in formulas become text, maths stays maths", async () => {
    const { textifyWords } = await import("../src/board/Tex");
    expect(textifyWords("Total outcomes = 6 times 6 = 36")).toBe("\\text{Total outcomes}\\ = 6 \\times 6 = 36");
    expect(textifyWords("P(\\text{sum}=7) = \\frac{6}{36}")).toBe("P(\\text{sum}=7) = \\frac{6}{36}");
    expect(textifyWords("x^2 + 2x + 1")).toBe("x^2 + 2x + 1");
    expect(textifyWords("sin x + log y")).toBe("\\sin x + \\log y");
    expect(textifyWords("Number of favorable outcomes = 6")).toBe("\\text{Number of favorable outcomes}\\ = 6");
    expect(textifyWords("a^2 + b^2 = c^2")).toBe("a^2 + b^2 = c^2");
  });
});
