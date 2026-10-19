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
    expect(seen).toEqual(["excited/cheer", "excited/hop"]);
  });

  test("cute cues: giggles tease, hmph pouts, thanks is shy", () => {
    expect(moodFromText("Ehehe, pakda gaya!")).toEqual({ emotion: "teasing", gesture: "giggle" });
    expect(moodFromText("Hmph, phir se try karo")?.emotion).toBe("pout");
    expect(moodFromText("Aww, thank you!")).toEqual({ emotion: "shy", gesture: "cheeks" });
    expect(moodFromText("Yayyy, ho gaya!")).toEqual({ emotion: "excited", gesture: "hop" });
  });

  test("a mood split across chunks is still caught", () => {
    const seen: string[] = [];
    const t = new MoodTracker((e) => seen.push(e), 0);
    t.push("Koi baat", 0);
    t.push(" nahi, try again", 5);
    expect(seen).toEqual(["oops"]);
  });
});
