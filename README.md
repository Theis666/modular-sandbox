# Modular Sandbox

A pocket modular synthesizer for iPhone (PWA). Patch Eurorack-style modules with cables, play them, and tap **?** to learn what everything does.

- What it does and why: [SPEC.md](SPEC.md), [GLOSSARY.md](GLOSSARY.md), [docs/adr/](docs/adr/), [ROADMAP.md](ROADMAP.md)
- No build step: plain HTML/CSS/JS. Open `index.html` through any static web server.

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. On a desktop, the keys `A W S E D F T G Y H U J K` play notes.

To see the app at iPhone size in a desktop browser, open http://localhost:8765/tools/phone-frame.html (390 × 844, scaled to fit the window), or add `?landscape` for the turned phone (844 × 390). Chrome's own device mode (DevTools → Cmd+Shift+M) works too.

To check that old patches still sound the same, run `await (await import('/tools/render-tests.js')).check()` in the console (open the app with `?mute` to keep it quiet).

To test a Guided Build automatically, open the browser console and run `(await import('/tools/guide-walkthrough.js')).run(0)` (0–18 = the guide's position in `GUIDES` in js/guides.js; the Guide list shows them grouped and sorted by level). It taps wherever the guide points.

After changing `Idea/patches.json` or `tools/library-en.json`, regenerate the library:

```bash
python3 tools/convert-library.py
```

After editing any text, check that every abbreviation is explained:

```bash
node tools/scan-abbreviations.mjs
```

After editing a guide, check its steps without a browser (unknown jacks or controls, goals no knob can reach, goals already met before the step, cables that silently replace another cable, play steps without keys, old UI words):

```bash
node tools/check-guides.mjs
```

## Put it on your iPhone (GitHub Pages)

1. Create a new repository on github.com (on a free account GitHub Pages needs it to be public), then push this folder:
   `git add -A && git commit -m "Modular Sandbox" && git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main`
   (or upload all files in the browser, keeping the folder structure). `.gitignore` leaves out `.DS_Store` and the local `.claude/` folder.
2. In the repository: **Settings → Pages → Branch: main / root → Save**.
3. After a minute, open the shown `https://<name>.github.io/<repo>/` address in **Safari** on the iPhone.
4. Tap **Share → Add to Home Screen**. It now opens full screen and works offline.

Updates arrive automatically the next time the app is opened online; offline it uses the last cached version.

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | page and Eurorack look |
| `js/app.js` | rack UI, patching, scope, patches, keyboard |
| `js/modules.js` | the 24 modules: controls (with `expert` and `legacy` flags, ADR 0010), jacks, info texts, audio |
| `js/engine.js` | audio context, gates, envelopes, noise colours, AudioWorklet loading |
| `js/worklet.js` | AudioWorklet processors: VCO (PolyBLEP), ladder filter, Trigger, S&H, Slew, DX |
| `js/offline.js` | renders a patch offline (render tests, CPU guard) |
| `js/ear.js` | ear challenges |
| `js/patches.js` | example patches |
| `js/guides.js` | Guided Build content: steps, texts, goals |
| `js/guide.js` | Guided Build runner: panel, spotlight, goal checks; Tour through library patches |
| `js/voices.js` | Polyphony: hidden per-voice copies behind a Keyboard with Voices > 1 (ADR 0008) |
| `js/abbr.js` | every abbreviation and its meaning; legends and tap-to-explain |
| `js/intro.js` | first-start introduction (four hints with a spotlight) |
| `js/library.js` | Classic sounds library (**generated**, do not edit) |
| `tools/convert-library.py`, `tools/library-en.json` | build `js/library.js` from `Idea/patches.json` + English texts |
| `Idea/` | source material from outside the app; read only |
| `js/recorder.js` | WAV recording |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: offline + home screen |

## License

MIT License, © 2026 Theis666: free to use, change and share, as long as the copyright notice with the name Theis666 stays with the code. See `LICENSE`.
