#!/usr/bin/env node
// Synthesises the arcade easter egg's sound effects into sounds/*.wav:
// square, triangle and noise voices with simple envelopes, in the spirit of
// an 80s sound chip. Every sound and jingle here is original. Run it after
// changing a sound: node tools/sfx.js

const fs = require("node:fs")
const path = require("node:path")

const rate = 22050
const out = path.join(__dirname, "..", "sounds")

const note = name => {
  const m = /^([A-G])(#?)(\d)$/.exec(name)
  const semis = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12
  return 440 * Math.pow(2, semis / 12)
}

// A fixed-seed noise source, so the files come out the same every run.
let seed = 0x1985
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return (seed / 0x7fffffff) * 2 - 1
}

const square = (phase, duty = 0.5) => (phase % 1 < duty ? 1 : -1)
const triangle = phase => 1 - 4 * Math.abs((phase % 1) - 0.5)

// One voice: frequency (a number or a function of 0..1 progress), a wave, a
// length in seconds, a volume and how fast it decays.
function voice({ freq, wave = "square", duty = 0.5, secs, volume = 0.5, decay = 4, attack = 0.004, vibrato = 0 }) {
  const n = Math.round(secs * rate)
  const samples = new Float32Array(n)
  let phase = 0
  let held = 0
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const p = i / n
    let f = typeof freq === "function" ? freq(p) : freq
    if (vibrato) f *= 1 + vibrato * Math.sin(2 * Math.PI * 28 * t)
    phase += f / rate
    let v
    if (wave === "square") v = square(phase, duty)
    else if (wave === "triangle") v = triangle(phase)
    else {
      // Noise held for a period, so its "pitch" follows freq.
      if (Math.floor(phase) !== Math.floor(phase - f / rate)) held = noise()
      v = held
    }
    const env = Math.min(1, t / attack) * Math.exp(-decay * p)
    samples[i] = v * env * volume
  }
  return samples
}

function mix(...tracks) {
  const n = Math.max(...tracks.map(t => t.length))
  const outBuf = new Float32Array(n)
  for (const t of tracks) for (let i = 0; i < t.length; i++) outBuf[i] += t[i]
  return outBuf
}

function seq(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const outBuf = new Float32Array(n)
  let at = 0
  for (const p of parts) {
    outBuf.set(p, at)
    at += p.length
  }
  return outBuf
}

const tone = (name, secs, opts = {}) => voice({ freq: note(name), secs, decay: 2.5, duty: 0.25, volume: 0.32, ...opts })
const melody = (notes, opts) => seq(...notes.map(([n, s]) => tone(n, s, opts)))

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const sounds = {
  swing: voice({ wave: "noise", freq: p => 9000 - 6000 * p, secs: 0.07, volume: 0.22, decay: 5 }),
  hit: mix(
    voice({ wave: "noise", freq: 3500, secs: 0.11, volume: 0.45, decay: 6 }),
    voice({ freq: p => 220 - 140 * p, secs: 0.11, volume: 0.35, decay: 5 })
  ),
  block: mix(
    voice({ freq: 1400, duty: 0.25, secs: 0.09, volume: 0.25, decay: 7 }),
    voice({ freq: 2100, duty: 0.125, secs: 0.09, volume: 0.18, decay: 7 })
  ),
  jump: voice({ freq: p => 260 + 360 * p, secs: 0.14, volume: 0.22, decay: 3 }),
  throw: mix(
    voice({ wave: "triangle", freq: p => 1600 - 700 * p, secs: 0.16, volume: 0.35, decay: 2 }),
    voice({ wave: "noise", freq: 6000, secs: 0.16, volume: 0.06, decay: 2 })
  ),
  swat: seq(
    voice({ freq: 1800, duty: 0.25, secs: 0.05, volume: 0.28, decay: 2 }),
    voice({ freq: 2400, duty: 0.25, secs: 0.08, volume: 0.28, decay: 4 })
  ),
  ko: mix(
    voice({ freq: p => 520 * Math.pow(60 / 520, p), secs: 0.65, volume: 0.35, decay: 2.5, vibrato: 0.04 }),
    voice({ wave: "noise", freq: 1200, secs: 0.3, volume: 0.25, decay: 6 })
  ),
  warp: voice({ freq: p => 300 + 600 * Math.sin(Math.PI * p), secs: 0.26, volume: 0.22, decay: 2, vibrato: 0.12 }),
  coin: melody([["A5", 0.05], ["E6", 0.05], ["A6", 0.16]]),
  start: mix(
    melody([["D5", 0.08], ["E5", 0.08], ["G5", 0.08], ["A5", 0.08], ["D6", 0.32]]),
    voice({ wave: "triangle", freq: note("D3"), secs: 0.64, volume: 0.3, decay: 2 })
  ),
  stage: melody([["A4", 0.1], ["D5", 0.1], ["E5", 0.26]]),
  fight: mix(
    tone("D5", 0.18, { decay: 4 }),
    tone("A5", 0.18, { decay: 4, volume: 0.25 }),
    voice({ wave: "noise", freq: 2500, secs: 0.12, volume: 0.25, decay: 6 })
  ),
  bonus: melody([["C6", 0.05], ["E6", 0.05], ["G6", 0.05], ["C7", 0.14]]),
  perfect: melody([["C6", 0.05], ["E6", 0.05], ["G6", 0.05], ["C7", 0.05], ["E6", 0.05], ["G6", 0.05], ["C7", 0.05], ["E7", 0.22]]),
  gameover: mix(
    melody([["A4", 0.2], ["F4", 0.2], ["D4", 0.2], ["A3", 0.5]], { decay: 1.5 }),
    voice({ wave: "triangle", freq: note("D3"), secs: 1.1, volume: 0.25, decay: 1.5 })
  ),
  champion: mix(
    melody([["D5", 0.12], ["E5", 0.12], ["G5", 0.12], ["A5", 0.12], ["G5", 0.12], ["A5", 0.12], ["D6", 0.5]], { decay: 1.8 }),
    voice({ wave: "triangle", freq: note("D3"), secs: 1.22, volume: 0.3, decay: 1.2 })
  )
}

fs.mkdirSync(out, { recursive: true })
for (const [name, samples] of Object.entries(sounds)) {
  fs.writeFileSync(path.join(out, name + ".wav"), wav(samples))
}
console.log(`wrote ${Object.keys(sounds).length} sounds to ${path.relative(process.cwd(), out) || "."}`)

if (typeof module !== "undefined") module.exports = { names: Object.keys(sounds) }
