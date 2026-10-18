import type { Emotion, Gesture } from "../shared/protocol";

// Mochi's face and body follow what she says, so the model never has to spend
// a tool call (about a second of silence) on "react". Matches are checked on
// the start of each new sentence of her transcript.

interface Cue {
  pattern: RegExp;
  emotion: Emotion;
  gesture: Gesture;
}

const CUES: Cue[] = [
  {
    pattern:
      /\b(shabaash|shabash|well done|bilkul sahi|ekdum sahi|perfect|excellent|bahut badhiya|brilliant|great job|awesome|you got it|sahi jawab)\b/i,
    emotion: "excited",
    gesture: "cheer",
  },
  { pattern: /\b(correct|right|sahi|good|accha|achha|nice|badhiya)\b/i, emotion: "happy", gesture: "nod" },
  { pattern: /\b(oops|galti|koi baat nahi|no worries|almost|not quite|thoda sa)\b/i, emotion: "oops", gesture: "none" },
  { pattern: /\b(wow|whoa|arre|are wah|interesting|surprise)\b/i, emotion: "surprised", gesture: "none" },
  { pattern: /\b(hello|hi|namaste|hey there)\b/i, emotion: "happy", gesture: "wave" },
  { pattern: /\b(socho|think|guess|kya lagta|what do you think|imagine)\b/i, emotion: "thinking", gesture: "think" },
];

export function moodFromText(sentence: string): { emotion: Emotion; gesture: Gesture } | null {
  for (const cue of CUES) {
    if (cue.pattern.test(sentence)) return { emotion: cue.emotion, gesture: cue.gesture };
  }
  return null;
}

/** Feeds transcript chunks and calls back at most once per sentence. */
export class MoodTracker {
  private sentence = "";
  private fired = false;
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly onMood: (emotion: Emotion, gesture: Gesture) => void,
    private readonly minGapMs = 2500,
  ) {}

  push(chunk: string, now = performance.now()): void {
    this.sentence += chunk;
    if (!this.fired) {
      const mood = moodFromText(this.sentence);
      if (mood && now - this.lastAt > this.minGapMs) {
        this.fired = true;
        this.lastAt = now;
        this.onMood(mood.emotion, mood.gesture);
      }
    }
    const end = Math.max(chunk.lastIndexOf("."), chunk.lastIndexOf("!"), chunk.lastIndexOf("?"));
    if (end >= 0) {
      this.sentence = chunk.slice(end + 1);
      this.fired = false;
    }
  }

  reset(): void {
    this.sentence = "";
    this.fired = false;
  }
}
