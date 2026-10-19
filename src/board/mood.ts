import type { Emotion, Gesture } from "../shared/protocol";

// Mochi's face and body follow what she says, so the model never has to spend
// a tool call (about a second of silence) on "react". Matches are checked on
// the start of each new sentence of her transcript.

interface Cue {
  pattern: RegExp;
  emotion: Emotion;
  /** Gestures to rotate through so the same cue doesn't always look the same. */
  gestures: Gesture[];
}

const CUES: Cue[] = [
  {
    pattern:
      /\b(shabaash|shabash|well done|bilkul sahi|ekdum sahi|perfect|excellent|bahut badhiya|brilliant|great job|awesome|you got it|sahi jawab)\b/i,
    emotion: "excited",
    gestures: ["cheer", "hop", "clap"],
  },
  { pattern: /\b(ya+y+|woo+hoo+|wo+hoo+)\b/i, emotion: "excited", gestures: ["hop", "cheer"] },
  { pattern: /\b(e?he+he+|hihi+|teehee)\b/i, emotion: "teasing", gestures: ["giggle"] },
  {
    pattern: /\b(pakda|pakad liya|chalaak|tumhe laga|socha tha na|itna easy|bas itna|nahi bataungi|guess karo)\b/i,
    emotion: "teasing",
    gestures: ["tilt", "peace"],
  },
  { pattern: /\b(hmph|humph|hmmph|uff+|offo)\b/i, emotion: "pout", gestures: ["tilt"] },
  { pattern: /\b(correct|right|sahi|good|accha|achha|nice|badhiya)\b/i, emotion: "happy", gestures: ["nod"] },
  {
    pattern: /\b(oops|galti|galat|koi baat nahi|no worries|almost|not quite|thoda sa)\b/i,
    emotion: "oops",
    gestures: ["none", "tilt"],
  },
  { pattern: /\b(thank you|thanks|shukriya|aww+|so sweet|cute)\b/i, emotion: "shy", gestures: ["cheeks"] },
  { pattern: /\b(wow|whoa|arre|are wah|interesting|surprise)\b/i, emotion: "surprised", gestures: ["none", "cheeks"] },
  { pattern: /\b(hello|hi|namaste|hey there)\b/i, emotion: "happy", gestures: ["wave", "peace"] },
  {
    pattern: /\b(socho|think|guess|kya lagta|what do you think|imagine)\b/i,
    emotion: "thinking",
    gestures: ["think"],
  },
];

function findCue(sentence: string): Cue | undefined {
  return CUES.find((cue) => cue.pattern.test(sentence));
}

/** The feeling a sentence shows and its usual gesture, or null. */
export function moodFromText(sentence: string): { emotion: Emotion; gesture: Gesture } | null {
  const cue = findCue(sentence);
  return cue ? { emotion: cue.emotion, gesture: cue.gestures[0] } : null;
}

/** Feeds transcript chunks and calls back at most once per sentence. */
export class MoodTracker {
  private sentence = "";
  private fired = false;
  private lastAt = Number.NEGATIVE_INFINITY;
  private readonly turns = new Map<Cue, number>();

  constructor(
    private readonly onMood: (emotion: Emotion, gesture: Gesture) => void,
    private readonly minGapMs = 2500,
  ) {}

  push(chunk: string, now = performance.now()): void {
    this.sentence += chunk;
    if (!this.fired) {
      const cue = findCue(this.sentence);
      if (cue && now - this.lastAt > this.minGapMs) {
        this.fired = true;
        this.lastAt = now;
        const turn = this.turns.get(cue) ?? 0;
        this.turns.set(cue, turn + 1);
        this.onMood(cue.emotion, cue.gestures[turn % cue.gestures.length]);
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
