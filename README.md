# MochiTutor

A cute 3D tutor that teaches you out loud in Hindi, Hinglish or English. Your laptop screen is the board, and if you point your phone at the laptop you see Mochi standing on the desk next to it, or the whole board drawn big in AR with her beside it.

Try it at **[mochitutor.nandishwarsingh.com](https://mochitutor.nandishwarsingh.com)** (Chrome or Safari on a laptop, with a mic).

It's built for maths, probability and stats first. Mochi does most of her teaching on the board, explaining out loud as she writes, runs little simulations, does exact arithmetic instead of guessing, and can look at your notebook through the webcam and circle the step you got wrong.

![Mochi explaining two dice on the board](docs/board-dice.jpg)

## What it does

- Live voice in any mix of Hindi and English, and you can interrupt her mid-sentence
- Teaches on a chalkboard: the question, what's given, every step, a boxed answer and a "yaad rakho" note, in two columns that turn to a new page when they fill up (you can flip back). KaTeX for the maths
- Points at what she's talking about. Her live captions are matched to the line she means and a chalk pointer slides to it, with no tool call and so no pause. She can also circle, underline, box or highlight a line, and tick, cross or star your answers
- Pictures that draw themselves in while she explains, in the spirit of 3Blue1Brown but live in the browser (manim itself renders videos offline, so it can't keep up with a conversation): graphs with a tangent sliding along the curve and its slope changing, areas filling in under a curve, triangles with their right angles and labels, probability trees that light up a path and multiply along it, number lines with hops and open or closed intervals, two and three set Venn diagrams that shade "A or B" or "neither", and bar charts with a mean line
- Real photos pinned to the board when a story needs one (a cricket pitch, a Ludo board), freely licensed from Wikimedia Commons, credited under the picture and proxied through the server
- Widgets she drives by voice: coin flips that settle toward the true probability, a Monty Hall game you play by saying door numbers (plus a 1,000-game simulation), a distribution explorer that shades P(a ≤ X ≤ b), and function graphs
- Every number comes from a calculator tool with nCr, factorials, binomial, Poisson, normal and inverse normal, so 6/36 shows up as 1/6, not a guess
- "Check my notebook": a 3 second countdown, a webcam photo on the board, then a box around the wrong step
- A VRoid avatar on a little wooden stage, with lip sync from the audio itself (so it works for Hindi too), blinking, cute faces (wink, pout, smug grin, shy) and gestures (wave, hop, peace sign, clap, giggle, hands on cheeks), all picked from what she says
- She stays alive between gestures: breathing, shifting her weight, hands that move while she explains, an open palm now and then, eyes that glance around, and a lean and a small nod while you talk. When she writes a line or talks about one, she points her arm at that exact line, on the laptop and in the phone's AR view
- Phone AR in any phone browser, iPhone included, two ways. Mochi next to the laptop's board: the phone finds four markers in the board's corners and stands her beside the screen. Board and Mochi on the phone: the laptop turns into a full-screen grid of 15 markers, and the phone draws the whole board, twice the screen's width, as a chalkboard in AR with a bigger Mochi standing beside it and pointing at the lines she's talking about. Captions show on the phone too
- Between marker fixes the phone turns the view with its gyroscope, and each fix only corrects the drift, so the board and Mochi stay put instead of trailing behind the video
- A headset mode for a Cardboard-style viewer with a hole for the camera: side-by-side stereo, the camera picture in each eye slid toward the nose so the real laptop and the drawn board sit at the same depth, the board and Mochi drawn from each eye, captions in both, and the gyro holding the room steady when the markers drift out of view. Her voice stays on the laptop, so everything is hands-free. On an iPhone, add the viewer to the home screen first so it can fill the screen

| Notebook check | Monty Hall | Coin flips |
| --- | --- | --- |
| ![](docs/board-notebook.jpg) | ![](docs/board-monty.jpg) | ![](docs/board-coins.jpg) |

![Phone view with Mochi next to the laptop](docs/phone-ar.jpg)

*The phone screenshot is the viewer running on a rendered camera view of the real board, not a photo from a phone yet.*

## How it works

The laptop does everything that involves sound. It holds the Gemini Live session (`gemini-3.8-live`), streams the mic as 16 kHz PCM, plays Mochi's 24 kHz voice, runs the tools and draws the board. Keeping audio on one device means the browser's echo cancellation works and Mochi doesn't hear herself.

The browser never sees the API key. A small Bun server mints a single-use Gemini token with the prompt and tool list locked in, and the browser connects to Google directly with it. The same server relays a tiny room protocol between the laptop and the phone over WebSocket.

The phone is only a viewer. It tracks the screen's markers (a 16-code 4x4 ArUco dictionary, every pair at least 5 cells apart in every rotation, detected in a Web Worker at 1280 px), works out its own focal length from the screen's shape, and renders Mochi with three.js and three-vrm on top of the camera feed. The laptop streams mouth shapes, feelings and gestures to it about 30 times a second, and delays its own speakers by roughly one network hop so the lips line up with the voice.

In phone mode the laptop also streams the board itself, as snapshots of its items (notebook photos shrunk and sent once). The phone renders the very same React board, KaTeX and widgets included, as DOM at a laptop board's size, and lays it onto the AR board with a CSS `matrix3d` recomputed from the camera after every frame. The text stays sharp at any distance and costs the GPU almost nothing. Between marker fixes, `deviceorientation` readings turn the camera, carried from the moment the frame was grabbed to the moment it's on screen, and each fix pulls the rotation back toward the markers.

Mochi's own boxes on notebook photos are rough, so when she marks a step the board also asks `gemini-3.5-flash-lite` to find that exact line, and the box slides to the precise spot about two seconds later.

## Run it

You need [Bun](https://bun.sh) 1.3+, Chrome or Safari, and a free Gemini API key from [AI Studio](https://aistudio.google.com/apikey).

```sh
bun install
bun run setup        # .env, a local HTTPS certificate and the sample avatar
# put your key in .env as GEMINI_API_KEY=...
bun run dev
```

Open https://localhost:5173 on the laptop, accept the self-signed certificate once and press Start lesson. Full screen (the corner button) makes the AR line up best.

For the phone: same Wi-Fi, press the phone button in the dock, scan the QR code, tap through the certificate warning (phones only allow the camera on https) and point the phone at the screen so all four corner squares are visible. "Adjust" on the phone tweaks her size, distance and the screen tilt.

To use your own VRoid character, export it as VRM (0.x or 1.0 both work) and save it as `public/avatars/mochi.vrm`.

## Hosting it

The live demo is this repo as-is, running behind Caddy on a small VPS.

```sh
SITE_URL=https://your.domain bun run build   # dist/ plus link previews, robots.txt, a sitemap and brotli copies
bun run build:server                          # the server as one binary in build/ (add --target=bun-linux-x64 to cross-compile)
```

Run the binary with `NODE_ENV=production`, `STATIC_DIR` pointing at `dist/` and `GEMINI_API_KEY` set, behind a proxy that does TLS (phones only open the camera on https) and passes WebSockets through. Settings worth knowing:

- `TRUSTED_PROXIES`: addresses or IPv4 CIDRs allowed to set X-Forwarded-For, so the per-visitor limits see real IPs. Loopback by default.
- `SESSION_LIMIT` and `SESSION_WINDOW_MS`: Live sessions per visitor, 12 per 10 minutes by default.
- `DAILY_SESSION_LIMIT`, `DAILY_LOCATE_LIMIT` and `DAILY_IMAGE_LIMIT`: caps across everyone per UTC day, so a public link can't use up your free quota or hammer Wikimedia. Off by default; the demo allows 100 lessons and 300 picture searches a day.

## Numbers

Latency, measured with `bun run bench`. The script streams recorded Hinglish and English questions in real time through the same token path the browser uses, with the app's real config and tool handlers, and times from the end of speech to Mochi's first audio. That includes Gemini's own wait to decide you've finished talking.

- At first Mochi often called a tool (a "react" for her face, or the board) before saying anything, and every tool call before speech costs about 1.4 s while Gemini picks back up. Median 2.95 s, p90 3.40 s over 9 runs, 7 of them with a tool call first.
- So the face now follows her words and the prompt tells her to talk first and draw while explaining. Over 21 runs in two sessions: median 2.09 s, 9 of 21 under 2 s, fastest 1.21 s.
- The tail is long on the free tier: p90 7.5 s and a worst case of 9.5 s, including runs with no tool call at all, so that wait is on Google's side.
- When a question literally asks her to write on the board first, she still draws first: the board fills at about 1.5 s and her voice follows at about 3 s.

Board-first teaching, from the recorded lessons in the end-to-end checks (one run each before and after, so read these as examples, not a benchmark):

- Two dice, sum of 7: the board went from 4 items and 107 characters to 12 items and 369 characters, and from one board call to four plus a calculation.
- Coin flips: from just the coin widget to six items. Monty Hall: from just the game to the game plus the strategy, the 2/3 and 1/3 chances and a note, in one of two runs.
- Time to her first word after the question stayed between 1.3 s and 2.9 s in those runs.

She sometimes went quiet for good, and the cause turned out to be Gemini leaving a turn open after a board tool call in the middle of a sentence: no more speech and no end of turn. The board now notices when she has been silent for 4 s after a tool result, or 1.5 s after you stop talking, and nudges the session. In the runs where it happened she was talking again about a second after her sentence ended. Normal turns, where she asks you something and waits, aren't touched.

Raw results are in `bench/results/` (a Mac on home Wi-Fi in India, October 2026).

Phone tracking, from `tests/pose.test.ts`: on a rendered 1280x720 view of the board from about 50 cm, turned 26° and tilted 17°, all four markers are found, the estimated focal length is within 6%, the rotation within 2° and the distance within 5% of the truth. It hasn't been measured on a real phone yet.

## Checks

```sh
bun test             # 110 tests: maths, simulations, tools, pictures, moods, following her speech, server, rooms, lip sync, pose
bun run typecheck
bun run lint
bun run build
```

## Plan

- [x] Spike: marker tracking, VRM in a browser, Gemini Live latency
- [x] Voice tutor in the browser (Hinglish, interruptible)
- [x] Board with maths and stats widgets and an exact calculator
- [x] VRoid avatar with lip sync, expressions and gestures
- [x] Phone viewer with marker AR
- [x] Notebook check
- [x] Board-first teaching, live pointing and chalk marks, animated pictures, a livelier Mochi
- [x] Phone mode (the board in AR) and a headset mode
- [ ] Test the AR, phone mode and headset on real phones (iPhone and Android) and tune the defaults
- [ ] Attention signals from the webcam
- [ ] Memory between sessions and lesson plans
- [ ] Demo video

## Limits

- The Live models are previews on Google's free tier. Limits can change, and the free tier may use what you send (voice, camera frames) to improve Google's products. Fine for a personal demo, not for other people's kids.
- The phone AR, phone mode and the headset have only been tested against rendered camera images so far, and the gyroscope smoothing has unit tests but hasn't been on a real phone yet.
- The headset view has no lens distortion correction, so straight lines bend a little near the edges in cheap viewers. Eye spacing, picture size and the laptop's screen width can be adjusted instead.
- Lip sync is worked out from the audio spectrum, so it's convincing at a glance, not perfect.
- Running it yourself, the self-signed certificate means a browser warning on first open. The hosted demo has a real one.
- The hosted demo stops starting lessons after 100 a day, and Mochi is a 3.3 MB download.

## Credits

On the hosted demo Mochi is [【Free model】Ao, dress style](https://hub.vroid.com/en/characters/1245908975744054638/models/4502686513672574798) by 白い白米 from VRoid Hub (free to use, edit and redistribute). I shrank her textures to 1024 px and dropped the face shapes nothing uses (keeping the ones her pout, wink and grin are built from), which took her from 22.7 MB to 8.1 MB, or 3.3 MB with brotli. The sample avatar `bun run setup` downloads is pixiv's VRM 1.0 sample model (VRM Public License 1.0, redistribution allowed). Marker detection is a lightly modified copy of [js-aruco2](https://github.com/damianofalcioni/js-aruco2) (MIT), using the first four codes of OpenCV's DICT_4X4_1000 (BSD-3-Clause).

## License

MIT
