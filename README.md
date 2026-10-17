# MochiTutor

A cute 3D tutor that teaches you in Hindi, Hinglish or English. Your laptop screen is the board, and you see Mochi standing next to it through your phone's camera.

Nothing is built yet. This is the plan, and I'll tick things off as they land.

## How it works

The laptop runs the board app. It has the mic, the webcam and the speakers, and it holds the live voice session with Gemini Live, so Mochi hears you, talks back and can look at you or your notebook when it needs to. It draws on the board through tool calls: text, equations, graphs and small interactive widgets.

The phone runs the viewer app in the browser. Point it at the laptop and it finds a marker in the corner of the board, then puts Mochi next to the screen. The laptop streams mouth shapes, expressions and gestures to the phone over the local network, so the lips stay in sync with the voice coming from the laptop.

A small Bun server on the laptop serves both apps, keeps the API key and hands the browser short-lived tokens.

## Plan

- [ ] Spike: marker tracking on a laptop screen from a phone browser, VRM performance on the phone, Gemini Live reply latency
- [ ] Voice tutor in the browser (Hinglish, interruptible)
- [ ] Board with maths and stats widgets (coin flips, Monty Hall, distributions) and an exact calculator
- [ ] VRoid avatar with lip sync, expressions and gestures
- [ ] Phone viewer with marker AR
- [ ] Notebook check and attention signals from the webcam
- [ ] Memory between sessions and lesson plans
- [ ] Tests, latency numbers and a demo video

## Stack

React, three.js with three-vrm, MindAR, Gemini Live, Bun and SQLite.

## License

MIT
