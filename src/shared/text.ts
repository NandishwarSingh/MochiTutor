// The model is told not to use emojis, but captions and the board strip them
// anyway so one never slips onto the screen.
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}|\u{20E3}/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI, "").replace(/ {2,}/g, " ");
}

/** The live transcript now and then carries stray markup like "</em>"; captions show plain words. */
export function stripMarkup(text: string): string {
  return text.replace(/<\/?[a-z][a-z0-9]*[^>]*>/gi, "");
}
