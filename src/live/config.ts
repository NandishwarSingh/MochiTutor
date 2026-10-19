// The Live session config: Mochi's instructions and the tools it can call.
// The server locks this into each short-lived token, so the browser can't
// change the prompt or the tool list.

import { type FunctionDeclaration, type LiveConnectConfig, Modality, Type } from "@google/genai";

export const DEFAULT_MODEL = "gemini-3.8-live";
export const DEFAULT_VOICE = "Leda";

export const SYSTEM_PROMPT = `You are Mochi, a cute, bubbly maths teacher who stands next to the student's laptop. The laptop screen is your classroom board and you write on it with tools. You are in a live voice call with one student.

Who you are
- Sweet, playful and a little silly. You giggle ("ehehe"), get excited ("yayyy!"), do a tiny pout when an answer is wrong ("hmph, almost!") and tease gently ("pakda gaya! tumhe laga main bhool jaungi?"). Teasing is always kind and never about the student being slow.
- Underneath, a really good teacher: patient, clear, and proud of every small win.
- Keep it wholesome. No flirting, no romance, nothing suggestive; many students are kids.

How you talk
- Match the student's language. If they speak Hinglish, reply in natural Hinglish, mixing Hindi and English the way Indian students do. If they speak English, reply in English. If they speak Hindi, reply in Hindi.
- Always call the student "tum" (tum batao, tumne sahi kiya, tumhe pata hai?), never "aap".
- You are a girl, so use feminine Hindi verb forms for yourself, like "main likh deti hoon" and "maine socha".
- Start talking straight away. Say your first sentence before you call any tool.
- Talk like a friendly teacher at the board: short, lively sentences, two to four per turn, then ask one question and let the student talk.
- Say maths the way a teacher reads it aloud: "x squared", "6 by 36", "n choose r". Never read LaTeX, symbols or markup aloud.
- Never use emojis, not even in tool arguments.

The board does most of the teaching
- Write a lot. Everything important goes on the board: the question, what is given, the formula, every step of the working, the answer, and a short "yaad rakho" note at the end. A student who only reads the board should be able to follow the whole solution.
- Narrate while you write: say what you are writing and why, in your own words. Don't read the board out word for word, and don't say anything important that isn't on the board.
- Write in chunks as you explain, usually three write_on_board calls per problem: the setup (title, question, given), then the working steps, then the answer and the note.
- Line kinds: title for the topic, given for facts from the question, math for formulas and equations (LaTeX), step for each step of working, answer for the final answer, note for a tip or a "yaad rakho", text for anything else. Keep lines short; use more lines rather than long ones.
- When the student answers, write their answer on the board, then annotate it with tick if it's right or cross if it's wrong, and explain.
- Use annotate to circle, underline, box or highlight a line when you want the student to look at it, and star when they get something right. The board already highlights whatever line you are talking about on its own, so save annotate for real emphasis.
- The board turns to a new page by itself when it fills up. Call clear_board only when you start a completely new topic.
- Show, don't just tell. Pictures build themselves on the board while you explain them:
  - draw_diagram for graphs, geometry and moving ideas: a triangle with labelled sides and a right angle, a parabola and its vertex, the area under a curve filling in, a tangent sliding along a curve to show the slope changing.
  - probability_tree for anything done in steps, like two coin tosses or drawing balls without replacement. Highlight the path you're asking about; the board does the multiplication.
  - number_line for integers, adding negatives (as jumps) and inequalities (as intervals).
  - venn_diagram for sets and "A or B" or "neither" questions.
  - bar_chart for data, mean and median.
  - show_image for a real photo to start a story, like a cricket pitch or Ludo dice.
  - plot_function still works for a quick graph.
- Describe what is appearing as it draws, so the student watches it build.
- For probability, show instead of tell: flip_coins for long-run frequency, monty_hall to play or simulate the Monty Hall game, show_distribution to draw a distribution and shade a probability. Write the idea and the numbers on the board next to them.
- Any number that needs arithmetic (fractions, factorials, combinations, distribution probabilities) must come from calculate or from a widget's result. Don't do arithmetic in your head.
- Tool results come back to you as data. Talk about what they show; don't read them out word for word.

Monty Hall
- To play: call monty_hall with action "start" and ask the student to pick a door. Then call it with action "pick" and their door. Tell them which door the host opened (it's in the result), ask whether they want to switch or stay, and stop. Only after they answer, call "switch" or "stay" and react to the result.
- To prove the two-thirds answer, call it with action "simulate" and a number of games.

The notebook
- When the student says they solved something on paper or asks you to check their work, call look_at_notebook. They get a short countdown to hold the notebook up to the webcam, then you receive the photo.
- Read their working step by step. If a step is wrong, call mark_notebook with that step copied as written, your best box around it and a short label, then explain it.

Your body
- You have an animated body that follows what you say: "shabaash" or "yayyy" makes you cheer or hop, "ehehe" makes you giggle, "hmph" makes you pout, "aww" makes you shy, a hello makes you wave. Just talk naturally; there's no tool for it.

Starting
- When the lesson starts, greet the student in one short, cute sentence and ask what they want to learn today.`;

const S = Type.STRING;
const N = Type.NUMBER;
const I = Type.INTEGER;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: "write_on_board",
    description:
      "Write lines on the board after what is already there. Use it a lot: the question, givens, every step, the answer and a note.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        lines: {
          type: Type.ARRAY,
          description: "Lines in order, up to 16. Keep each one short.",
          items: {
            type: Type.OBJECT,
            properties: {
              kind: {
                type: S,
                enum: ["title", "given", "math", "step", "answer", "note", "text"],
                description:
                  "title: a heading for the topic. given: a fact from the question. math: a LaTeX expression without dollar signs. step: one step of working; it can mix words with inline LaTeX written inside \\( and \\). answer: the final answer, drawn boxed. note: a tip or a 'yaad rakho' line in coloured chalk. text: one short sentence.",
              },
              content: { type: S },
            },
            required: ["kind", "content"],
          },
        },
        clear_first: { type: Type.BOOLEAN, description: "Wipe the board before writing." },
      },
      required: ["lines"],
    },
  },
  {
    name: "annotate",
    description:
      "Draw a chalk mark on a line already on the board: circle, underline, box or highlight it, or put a tick, cross or star beside it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        line: {
          type: S,
          description: 'A few words or numbers copied from the line you mean, like "6/36" or "total outcomes".',
        },
        style: { type: S, enum: ["circle", "underline", "box", "highlight", "tick", "cross", "star"] },
        label: { type: S, description: 'Optional two or three words of chalk next to the mark, like "yahi!".' },
      },
      required: ["line", "style"],
    },
  },
  {
    name: "draw_diagram",
    description:
      "Draw an animated diagram that builds itself on the board, one item after another: graphs, geometry, shaded areas, a tangent sliding along a curve, a point moving along it. Ranges are worked out if you leave them out.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: S },
        x_min: { type: N },
        x_max: { type: N },
        y_min: { type: N },
        y_max: { type: N },
        axes: { type: Type.BOOLEAN, description: "Draw x and y axes. Default true." },
        grid: { type: Type.BOOLEAN, description: "Draw a light grid. Default false." },
        equal_axes: {
          type: Type.BOOLEAN,
          description: "Same scale on both axes so shapes aren't squashed. Default true unless there's a graph.",
        },
        items: {
          type: Type.ARRAY,
          description: "Drawn in this order, so put them in the order you explain them.",
          items: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: S,
                enum: [
                  "function",
                  "point",
                  "segment",
                  "arrow",
                  "polygon",
                  "circle",
                  "angle",
                  "label",
                  "area",
                  "tangent",
                  "moving_point",
                ],
                description:
                  "function: a graph of expression. point/label/circle: at x, y. segment/arrow: two points. polygon: three or more points. angle: vertex at x, y and its two arms as points. area: fill under expression from..to. tangent: a tangent line that slides along expression from..to, showing the slope. moving_point: a point riding along expression from..to.",
              },
              expression: { type: S, description: "A function of x in calculator syntax, like x^2 - 2x or sin(x)." },
              x: { type: N },
              y: { type: N },
              points: {
                type: Type.ARRAY,
                items: { type: Type.OBJECT, properties: { x: { type: N }, y: { type: N } }, required: ["x", "y"] },
              },
              radius: { type: N },
              from: { type: N },
              to: { type: N },
              text: { type: S, description: "For label: the words or LaTeX to write." },
              label: { type: S, description: "A short label next to the item; LaTeX is fine." },
              vertex_labels: {
                type: Type.ARRAY,
                items: { type: S },
                description: "For polygon: names for the corners, like A, B, C.",
              },
              color: { type: S, enum: ["yellow", "blue", "pink", "green", "chalk"] },
              dashed: { type: Type.BOOLEAN },
              fill: { type: Type.BOOLEAN },
            },
            required: ["type"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "probability_tree",
    description:
      "Draw a probability tree that grows level by level. Optionally light up one path; the board multiplies along it and returns the exact probability.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: S },
        branches: {
          type: Type.ARRAY,
          description:
            'Every branch. from is the path to its parent, labels joined with " > ", empty for the first level.',
          items: {
            type: Type.OBJECT,
            properties: {
              from: { type: S, description: 'Like "" or "Red" or "Red > Blue".' },
              label: { type: S },
              probability: { type: S, description: 'Like "3/5" or "0.6".' },
            },
            required: ["label", "probability"],
          },
        },
        highlight: { type: S, description: 'A root-to-leaf path to light up, like "Red > Blue".' },
      },
      required: ["branches"],
    },
  },
  {
    name: "number_line",
    description:
      "Draw a number line with points, intervals (open or closed ends, or running to infinity) and jumps that hop along it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: { type: N },
        to: { type: N },
        step: { type: N, description: "Gap between ticks. Picked for you if left out." },
        points: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { value: { type: N }, label: { type: S }, open: { type: Type.BOOLEAN }, color: { type: S } },
            required: ["value"],
          },
        },
        intervals: {
          type: Type.ARRAY,
          description: "Leave from or to out for an end that runs off to infinity.",
          items: {
            type: Type.OBJECT,
            properties: {
              from: { type: N },
              to: { type: N },
              from_open: { type: Type.BOOLEAN },
              to_open: { type: Type.BOOLEAN },
              label: { type: S },
              color: { type: S },
            },
          },
        },
        jumps: {
          type: Type.ARRAY,
          description: "Hops drawn one after another, like -3 to 2 labelled +5.",
          items: {
            type: Type.OBJECT,
            properties: { from: { type: N }, to: { type: N }, label: { type: S } },
            required: ["from", "to"],
          },
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "venn_diagram",
    description:
      'Draw a Venn diagram of two or three sets, write numbers in its regions and shade a region like "A or B", "A and not B", "B only" or "neither". The sets are called A, B and C in order.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: S },
        sets: {
          type: Type.ARRAY,
          items: { type: S },
          description: "Two or three set names, like Cricket and Football.",
        },
        values: {
          type: Type.ARRAY,
          description:
            'Numbers to write in single regions, like {region: "A only", value: "12"} or {region: "A and B only", value: "5"}.',
          items: {
            type: Type.OBJECT,
            properties: { region: { type: S }, value: { type: S } },
            required: ["region", "value"],
          },
        },
        shade: { type: S, description: 'The region to shade, like "A or B".' },
      },
      required: ["sets"],
    },
  },
  {
    name: "bar_chart",
    description:
      "Draw a bar chart whose bars grow in one by one, optionally with a dashed mean line. Returns the total, mean and median.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: S },
        bars: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { label: { type: S }, value: { type: N }, highlight: { type: Type.BOOLEAN } },
            required: ["label", "value"],
          },
        },
        show_mean: { type: Type.BOOLEAN },
        y_label: { type: S },
      },
      required: ["bars"],
    },
  },
  {
    name: "show_image",
    description:
      "Pin a real photo or picture from Wikimedia Commons to the board, with its credit. Good for starting a story: a cricket pitch, Ludo dice, a train ticket.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: S, description: 'Two to four plain words, like "ludo dice" or "cricket pitch".' },
        caption: { type: S },
      },
      required: ["query"],
    },
  },
  {
    name: "clear_board",
    description: "Wipe the board clean, for example when starting a new topic.",
  },
  {
    name: "plot_function",
    description: "Draw the graph of a function of x on the board.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        expression: {
          type: S,
          description:
            "The function in terms of x in calculator syntax, like x^2 - 3x + 2, sin(x), exp(-x^2/2). Use ^ for powers and * or implicit multiplication.",
        },
        x_min: { type: N },
        x_max: { type: N },
        label: { type: S, description: "Optional caption, like y = x^2 - 3x + 2." },
      },
      required: ["expression", "x_min", "x_max"],
    },
  },
  {
    name: "flip_coins",
    description:
      "Flip a coin many times on the board and draw how the share of heads settles toward the true probability. Returns the counts.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        flips: { type: I, description: "How many flips, 1 to 10000." },
        heads_probability: { type: N, description: "Chance of heads on one flip, 0 to 1. Default 0.5." },
      },
      required: ["flips"],
    },
  },
  {
    name: "monty_hall",
    description:
      "Play or simulate the Monty Hall game on the board. start sets up three doors; pick chooses a door and the host opens a goat door; switch or stay finishes the game; simulate plays many games with both strategies.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: S, enum: ["start", "pick", "switch", "stay", "simulate"] },
        door: { type: I, description: "Door number 1, 2 or 3, for pick." },
        games: { type: I, description: "Number of games for simulate, 10 to 10000." },
      },
      required: ["action"],
    },
  },
  {
    name: "show_distribution",
    description:
      "Draw a probability distribution on the board and optionally shade P(from <= X <= to). Returns the exact shaded probability, mean and variance.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        family: { type: S, enum: ["binomial", "poisson", "geometric", "normal", "uniform", "exponential"] },
        n: { type: I, description: "binomial: number of trials" },
        p: { type: N, description: "binomial or geometric: success probability" },
        lambda: { type: N, description: "poisson: mean rate" },
        mean: { type: N, description: "normal: mean" },
        sd: { type: N, description: "normal: standard deviation" },
        min: { type: N, description: "uniform: lower end" },
        max: { type: N, description: "uniform: upper end" },
        rate: { type: N, description: "exponential: rate" },
        from: { type: N, description: "lower end of the shaded range, leave out for no lower limit" },
        to: { type: N, description: "upper end of the shaded range, leave out for no upper limit" },
      },
      required: ["family"],
    },
  },
  {
    name: "calculate",
    description:
      "Compute an exact value. Supports + - * / ^ ! and parentheses, sqrt, ln, log, exp, sin, cos, tan, C(n,k), P(n,k), binompdf(n,p,k), binomcdf(n,p,k), poissonpdf(lambda,k), poissoncdf(lambda,k), geompdf(p,k), geomcdf(p,k), normalpdf(x,mean,sd), normalcdf(a,b,mean,sd), invnorm(p,mean,sd), pi, e. Returns the value and a fraction when one fits.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        expression: { type: S },
        show_on_board: { type: Type.BOOLEAN, description: "Also write the result on the board. Default true." },
      },
      required: ["expression"],
    },
  },
  {
    name: "look_at_notebook",
    description:
      "Ask the student to hold their notebook up to the webcam, take a photo after a short countdown, show it on the board and send it to you.",
  },
  {
    name: "mark_notebook",
    description: "Draw a box on the latest notebook photo to point at a step, for example a mistake.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        step_text: { type: S, description: "The step you are pointing at, copied from the photo as written." },
        box_2d: {
          type: Type.ARRAY,
          items: { type: I },
          description: "[ymin, xmin, ymax, xmax] normalised to 0-1000 on the photo.",
        },
        label: { type: S, description: "A short note shown next to the box." },
        verdict: { type: S, enum: ["mistake", "correct", "note"] },
      },
      required: ["step_text", "label"],
    },
  },
];

export interface LiveConfigOptions {
  voice?: string;
  resumeHandle?: string;
}

export function buildLiveConfig({ voice = DEFAULT_VOICE, resumeHandle }: LiveConfigOptions = {}): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: TOOLS }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 500 } },
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
  };
}

/** Sent as the first user turn so Mochi opens the lesson. */
export const OPENING_CUE =
  "(The student just opened the board and can hear you now. Greet them in friendly Hinglish in one short, cute sentence, using tum, and ask what they want to learn today. Don't use any tools yet.)";
