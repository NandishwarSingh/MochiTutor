import { describe, expect, test } from "bun:test";
import { MoodTracker, moodFromText } from "../src/board/mood";

describe("moodFromText", () => {
  test("praise cheers, mistakes look sorry, questions look thoughtful", () => {
    expect(moodFromText("Shabaash! Bilkul sahi jawab.")).toEqual({ emotion: "excited", gesture: "cheer" });
    expect(moodFromText("Koi baat nahi, ek galti hui hai")).toEqual({ emotion: "oops", gesture: "none" });
    expect(moodFromText("Socho, agar do dice hon toh?")?.emotion).toBe("thinking");
    expect(moodFromText("Total outcomes are thirty six")).toBeNull();
  });

  test("whole words only", () => {
    expect(moodFromText("The rightmost column")).toBeNull();
  });
});

describe("MoodTracker", () => {
  test("fires once per sentence and respects the gap", () => {
    const seen: string[] = [];
    const t = new MoodTracker((e, g) => seen.push(`${e}/${g}`), 1000);
    t.push("Shabaash! Bahut ", 0);
    t.push("badhiya kiya.", 10);
    t.push(" Perfect answer.", 2000);
    expect(seen).toEqual(["excited/cheer", "excited/cheer"]);
  });

  test("a mood split across chunks is still caught", () => {
    const seen: string[] = [];
    const t = new MoodTracker((e) => seen.push(e), 0);
    t.push("Koi baat", 0);
    t.push(" nahi, try again", 5);
    expect(seen).toEqual(["oops"]);
  });
});
