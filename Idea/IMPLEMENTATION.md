# Patch-Daten für die Modular-Synth-Lern-App

Stand: 19.11.2026 · Datei: `patches.json` (Schema 1.0)

Dieses Dokument ist für die Claude-Code-Session geschrieben. Es erklärt die Datenstruktur, wie sie auf Web Audio abgebildet wird und in welcher Reihenfolge man sie am besten umsetzt.

## 1. Was drin ist

| id | Status | Schwierigkeit | Lernschwerpunkt | Synthese |
|---|---|---|---|---|
| `i-feel-love-bass` | partial | 2 | Sequencer, Pausen-Steps, Sync-Delay | subtraktiv, mono |
| `stranger-things-arp` | complete | 2 | Arpeggiator, Zufalls-LFO, Pluck-Hüllkurve | subtraktiv, mono + Unison |
| `oxygene-iv-lead` | complete | 3 | Detune, Vibrato, lange Release, FX-Kette | subtraktiv, mono |
| `blade-runner-brass` | complete | 3 | HP + LP in Reihe, 2 Hüllkurven auf Cutoff | subtraktiv, poly |
| `dx7-epiano-1` | complete | 4 | FM, Algorithmus, Operatoren | FM, poly |
| `thx-deep-note`, `thriller-frog-bass`, `on-the-run-sequence`, `tour-de-france`, `angel-cover` | reference_only | – | nur Infos + Link zu externem Patch | – |

Empfohlener Lernpfad (Reihenfolge in der App): I Feel Love → Stranger Things → Oxygene IV → Blade Runner → DX7.

- `complete`: Fast alle Kernparameter kommen aus einer Quelle.
- `partial`: Aufbau aus der Quelle, viele Werte ergänzt.
- `reference_only`: kein spielbarer Patch, nur Karte mit Fakten und externem Link.

## 2. Datenmodell

```
patch
├─ id, title, artist, year, status, difficulty (1–5), category[]
├─ learningGoals[]        → Lernziele, als Checkliste anzeigen
├─ originalGear[], history[]  → Info-Karte
├─ voiceMode              → "mono" | "poly"
├─ tempoBpm?              → Transport-Tempo
├─ modules[]              → { id, type, params{ name: Param } }
├─ connections[]          → { from: "modId.port", to: "modId.port", kind: audio|cv|gate }
├─ fm?                    → nur DX7 (statt modules/connections)
├─ postFx?                → nur DX7
├─ tutorialSteps[]        → { order, text, focus[modIds] }
├─ referencePatches[]?    → externe Patch-Dateien
└─ sources[]              → { title, url, usedFor }

Param = { value, provenance: "source"|"inferred", note?, raw?, rawNote? }
```

**Regeln für `provenance`:**
- `source`: Der Wert steht so in der verlinkten Quelle.
- `inferred`: Den Wert habe ich ergänzt, weil die Quelle keinen nennt. Er ist ein vernünftiger Startwert.
- `raw`: Originalwert aus einem fremden Plugin (Fathom CM, Voltage Modular, Ableton), dessen Einheit unklar ist. **Immer `value` verwenden.** `raw` ist nur zur Info, etwa als Tooltip „Original-Plugin: 24“.

UI-Vorschlag: Parameter mit `inferred` dezent markieren (z. B. ein „≈“). So lernt der Nutzer, dass dort Ausprobieren erwünscht ist.

## 3. Modultypen → Web Audio

`moduleTypes` in der JSON definiert Ports und Parameter. So bildest du sie ab:

| Typ | Web-Audio-Umsetzung | Hinweise |
|---|---|---|
| VCO | `OscillatorNode` | `octave` → `detune += octave*1200`, `fineCents` → `detune`. Pulse/PWM per `PeriodicWave` oder AudioWorklet. |
| SUB | zweiter `OscillatorNode`, `detune -1200` | folgt der Pitch des VCO |
| NOISE | `AudioBufferSourceNode` mit Loop | |
| LFO | `OscillatorNode` (niedrige Frequenz) → `GainNode` (depth) | `smoothRandom` / `sampleHold` als AudioWorklet oder per `setTargetAtTime` auf Zufallswerte. Auf Pitch: Tiefe in Cents skalieren, z. B. `depth * 100`. |
| MIXER | mehrere `GainNode` → Summe | |
| VCF | `BiquadFilterNode` | `lp12` = 1 Biquad, `lp24` = 2 Biquads in Reihe. `resonance` 0..1 → Q ca. 0.7..15. `envAmount` = Oktaven über Cutoff, z. B. `envAmount * 6`. `keyTrack` → Cutoff × 2^((note-60)/12 * keyTrack). |
| VCA | `GainNode`, gain startet bei 0 | |
| ENV | auf `AudioParam` per `setValueAtTime` / `linearRampToValueAtTime` / `setTargetAtTime` | ms → s. Bei Gate-off ab aktuellem Wert in Release gehen (`cancelAndHoldAtTime`). |
| SEQ | JS-Scheduler mit Lookahead (25-ms-Timer, 100 ms voraus planen) | `stepActive=false` → kein Gate (Pause). |
| ARP | wie SEQ, Noten aus gehaltenem Akkord | `downUp`: absteigend, dann aufsteigend, ohne Doppelnote an den Enden |
| KEYBOARD | Bildschirmtastatur + Web MIDI | `unison` → n Stimmen mit ±`unisonDetuneCents/2` |
| FM_OP | AudioWorklet (empfohlen) oder Oscillator → Gain → `frequency` des Carriers | siehe Abschnitt 4 |
| CHORUS | 2 `DelayNode` (10–25 ms), per LFO moduliert | |
| DELAY | `DelayNode` + Feedback-`GainNode` | `sync "1/16"` → `60/bpm/4` Sekunden |
| REVERB | `ConvolverNode` mit generierter Impulsantwort (Rauschen × Exponentialabfall) | spring: kurz, metallisch; hall: lang |
| OUTPUT | `StereoPannerNode` → `destination` | |

**Polyphonie:** Bei `voiceMode: "poly"` wird pro Note eine Stimme instanziert: alle Module außer KEYBOARD und den FX. Die FX (CHORUS, DELAY, REVERB) laufen einmal global am Ende.

**Pitch-CV:** Intern als MIDI-Notennummer oder Hz weiterreichen, nicht als Volt. Die Verbindungen `*.pitch` bestimmen nur, welche Oszillatoren der Note folgen.

## 4. DX7-Hinweise (`dx7-epiano-1`)

- `algorithmGraph.pairs = [[2,1],[4,3],[6,5]]` heißt: Op 2 moduliert Op 1 usw. Die Carrier 1, 3, 5 werden summiert. Op 6 moduliert sich zusätzlich selbst (Feedback 6).
- Frequenz eines Operators = Notenfrequenz × `ratio`. `detune` (–7..+7) ≈ ±1 Cent pro Schritt bei mittleren Lagen. Das ist eine Näherung.
- **Output-Level 0..99 → Modulationsindex:** näherungsweise `amp = 2^((level-99)/8)`. Für Modulatoren dann Modulationstiefe in Hz = `amp * modFreq * ~4`, nach Gehör nachjustieren.
- **EG-Rates 0..99 sind keine Zeiten.** Grobe Näherung: Zeit für eine volle Pegelstrecke in Sekunden = `38 * 2^(-rate/7.5)`. Rate 99 ist dann ca. 4 ms, Rate 20 ca. 6 s. Levels 0..99 genauso wie Output-Level umrechnen. Wer exakte Werte will, kann die Mathematik aus dem Dexed-Quellcode übernehmen (Open Source, GPL; Lizenz beachten).
- `velocitySens` 0..7: Output-Level wird um bis zu `(7 - velocity*7/127) * velocitySens`-Stufen abgesenkt. Ergebnis: Hohe Werte auf den Modulatoren machen leise Anschläge weicher.
- Pitch-EG mit Level 50 ist neutral und kann in v1 ignoriert werden. Das LFO hat Pitch-Depth 0 und kann ebenfalls entfallen.
- Für die Lern-App reicht eine vereinfachte Engine. Ziel ist, dass das Ein- und Ausschalten der Paare (Tutorial-Schritte 1–3) hörbar den Klang aufbaut.

## 5. Empfohlene Implementierungsreihenfolge

1. **Loader und Validierung:** `patches.json` laden, Typen in TypeScript erzeugen, beim Start prüfen, dass jede Verbindung auf existierende Module und Ports zeigt.
2. **Subtraktive Engine:** VCO, SUB, MIXER, VCF, VCA, ENV, LFO, KEYBOARD, OUTPUT. Damit ist `oxygene-iv-lead` mit Tastatur spielbar.
3. **Transport:** SEQ und ARP mit Lookahead-Scheduler. Damit laufen `i-feel-love-bass` und `stranger-things-arp`.
4. **FX:** DELAY (inklusive Sync), CHORUS, REVERB. Danach klingen alle vier subtraktiven Patches vollständig.
5. **Polyphonie:** für `blade-runner-brass`.
6. **FM-Engine:** für `dx7-epiano-1`.
7. **Lern-UI:** Patch-Graph als Kabelansicht. `tutorialSteps` Schritt für Schritt, dabei `focus`-Module hervorheben. Nicht fokussierte Module optional gemutet, damit man den Klang wachsen hört.
8. **Info-Karten:** `history`, `originalGear`, `sources`, `referencePatches`. Die `reference_only`-Einträge erscheinen nur als Karten.

## 6. Akzeptanzkriterien

- Jeder Patch mit Status `complete` oder `partial` lädt ohne Fehler und erzeugt bei Tastendruck oder Play einen Ton.
- Ändert man einen Parameter in der UI, hört man das sofort, ohne Klicks oder Knackser (Parameter-Rampen von ca. 10 ms).
- `i-feel-love-bass`: Bei 125 BPM spielen nur die Steps 1, 3, 5 und 7. Das Delay (1/16) füllt hörbar die Lücken.
- `stranger-things-arp`: Ein gehaltener Cmaj7 mit Hold läuft DownUp und beginnt auf G.
- `dx7-epiano-1`: Wird Op 2 abgeschaltet, verschwindet der metallische Anschlag.
- Parameter mit `inferred` sind in der UI als ergänzt erkennbar.

## 7. Rechtliches / Inhalt

- Die JSON enthält **keine Melodien oder Notenfolgen der Songs.** Ausnahmen sind ein Akkord (Cmaj7) und ein Tonvorrat aus einem Interview. Spielbare Übungsmuster sollten neutral sein oder vom Nutzer kommen.
- Songtitel und Künstler sind nur Referenz. Keine Cover, Fotos oder Audio der Originale in die App einbauen.
- Die externen Patch-Links (`referencePatches`) nur verlinken, nicht mitliefern. Lizenzen der Fremd-Patches sind unterschiedlich.

## 8. Prompt für die Claude-Code-Session

> Lies `IMPLEMENTATION.md` und `patches.json`. Setze die App in der Reihenfolge aus Abschnitt 5 um und prüfe nach jedem Schritt die Akzeptanzkriterien aus Abschnitt 6. Halte dich an das Datenmodell aus Abschnitt 2. Ändere `patches.json` nicht strukturell. Wenn ein Wert unplausibel klingt, passe ihn an und setze `provenance` auf `inferred`. Starte mit Schritt 1 und 2, zeig mir dann `oxygene-iv-lead` spielbar im Browser.
