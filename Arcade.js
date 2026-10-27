// Yie Ar Kung-Fu, the easter egg. Konami's 1985 arcade game sent Oolong (Lee
// on MSX and Famicom) through eleven fighters, each with a weapon or a trick.
// This tribute follows the arcade's rules: ten hit points a side, one per
// hit; sixteen attacks from eight directions and two buttons; high jumps
// towards the middle that can only attack as they leave the ground. The art,
// sound and code are original. Pure functions over a plain state object,
// like Model.js, so node can test them; Arcade.qml owns the keys, the clock,
// the sound and the drawing.

var worldWidth = 240
var worldHeight = 176
var floorY = 164
var stageLeft = 12
var stageRight = 228
var stageCenter = (stageLeft + stageRight) / 2
var bodyHalf = 7
var minGap = 18
var maxEnergy = 10
var gravity = 0.000632     // a jump lasts 900 ms and peaks 64 px up
var jumpSpeed = 0.2844
var jumpDrift = 0.133      // a diagonal jump carries half the stage
var walkSpeed = 0.075
var jumpAttackWindow = 150 // a button this soon after take-off makes a jump attack
var hitstunMs = 380
var sparkMs = 260
var startLives = 3
// The Konami Code's other famous gift was Contra's 30 lives.
var startCredits = 30

var konamiCode = ["up", "up", "down", "down", "left", "right", "left", "right", "b", "a"]

var timings = {
  intro: 1700,
  ko: 1600,
  clear: 2200,
  champion: 4200,
  down: 1600,
  continueSecs: 9,
  gameover: 3000,
  demoRestart: 1800,
  codeBanner: 1800
}

// The arcade's sixteen attacks, named here for what they do. dir is the
// joystick relative to the way the fighter faces: f forward, b back, u up,
// d down. stance is the body while the attack is out: a crouch ducks "high",
// a jump clears "low", and on the floor only "low" can reach you. "up"
// attacks rise to meet a jumper.
var moves = {
  highPunch: { name: "highPunch", dir: "b", button: "punch", level: "high", stance: "stand", reach: 18, startup: 60, active: 80, recovery: 110, points: 100 },
  lungePunch: { name: "lungePunch", dir: "f", button: "punch", level: "mid", stance: "stand", reach: 24, startup: 80, active: 80, recovery: 140, points: 100 },
  lowLunge: { name: "lowLunge", dir: "df", button: "punch", level: "low", stance: "crouch", reach: 26, startup: 90, active: 80, recovery: 160, points: 200 },
  crouchPunch: { name: "crouchPunch", dir: "d", button: "punch", level: "low", stance: "crouch", reach: 18, startup: 60, active: 80, recovery: 110, points: 100 },
  splitPunch: { name: "splitPunch", dir: "db", button: "punch", level: "low", stance: "floor", reach: 26, startup: 120, active: 100, recovery: 260, points: 300 },
  risingPunch: { name: "risingPunch", dir: "ub", button: "punch", level: "up", stance: "stand", reach: 18, startup: 70, active: 90, recovery: 150, points: 300 },
  jumpPunch: { name: "jumpPunch", dir: "u", button: "punch", level: "high", stance: "air", reach: 18, startup: 60, active: 3000, recovery: 0, points: 500, jump: "up" },
  divePunch: { name: "divePunch", dir: "uf", button: "punch", level: "mid", stance: "air", reach: 20, startup: 80, active: 3000, recovery: 0, points: 500, jump: "forward" },
  highKick: { name: "highKick", dir: "b", button: "kick", level: "high", stance: "stand", reach: 22, startup: 90, active: 90, recovery: 170, points: 200 },
  sideKick: { name: "sideKick", dir: "f", button: "kick", level: "mid", stance: "stand", reach: 28, startup: 100, active: 90, recovery: 170, points: 200 },
  sweep: { name: "sweep", dir: "df", button: "kick", level: "low", stance: "crouch", reach: 30, startup: 110, active: 90, recovery: 200, points: 300 },
  lowKick: { name: "lowKick", dir: "d", button: "kick", level: "low", stance: "crouch", reach: 24, startup: 80, active: 80, recovery: 150, points: 200 },
  groundKick: { name: "groundKick", dir: "db", button: "kick", level: "up", stance: "floor", reach: 16, startup: 120, active: 120, recovery: 260, points: 800 },
  risingKick: { name: "risingKick", dir: "ub", button: "kick", level: "up", stance: "crouch", reach: 24, startup: 100, active: 100, recovery: 200, points: 500 },
  flyingKick: { name: "flyingKick", dir: "u", button: "kick", level: "high", stance: "air", reach: 26, startup: 80, active: 3000, recovery: 0, points: 500, jump: "up" },
  jumpKick: { name: "jumpKick", dir: "uf", button: "kick", level: "high", stance: "air", reach: 24, startup: 80, active: 3000, recovery: 0, points: 500, jump: "forward" },
  // The opponents' own tricks.
  throw: { name: "throw", level: "none", stance: "stand", reach: 0, startup: 220, active: 0, recovery: 320, points: 0 },
  lunge: { name: "lunge", level: "mid", stance: "air", reach: 14, startup: 0, active: 3000, recovery: 0, points: 0 }
}

var levelHeight = { high: 31, mid: 20, low: 6, up: 36 }
var punches = ["highPunch", "lungePunch", "lowLunge", "crouchPunch", "splitPunch", "risingPunch", "jumpPunch", "divePunch"]
var kicks = ["highKick", "sideKick", "sweep", "lowKick", "groundKick", "risingKick", "flyingKick", "jumpKick"]
var allAttacks = punches.concat(kicks)

// Each stroke of the joystick, with a button, picks one attack.
var moveTable = {}
allAttacks.forEach(function(name) { moveTable[moves[name].button + ":" + moves[name].dir] = name })

function palette(top, pants, hair, skin, shoes) {
  return { top: top, pants: pants, hair: hair, skin: skin || "#e8b48a", shoes: shoes || "#1a1a1a" }
}

var lee = {
  id: "lee", name: "LEE", weapon: "", special: "", hair: "short", build: 1, speed: 1, skill: 0.3,
  aggression: 0.7, cooldown: 650, range: 26, reach: 0, quick: 1, shield: false, attacks: allAttacks,
  palette: palette("#f2f2f2", "#26262c", "#151515", "#e8b48a", "#d62828"), sash: "#d62828"
}

// The arcade's order. Level 1 is fought by a waterfall in a cave, level 2
// in a palace courtyard.
var roster = [
  { id: "buchu", name: "BUCHU", weapon: "", special: "lunge", specialEvery: 2600, hair: "topknot", build: 1.3, speed: 0.75,
    skill: 0.12, aggression: 0.55, cooldown: 900, range: 26, reach: 0, quick: 1.1, attacks: ["lungePunch", "sideKick", "highPunch"],
    palette: palette("#e3a46f", "#f4f4f4", "#1d1d1d", "#e3a46f", "#e3a46f"), level: 1, note: "Flies at you mid-height: kick up to meet him" },
  { id: "star", name: "STAR", weapon: "shuriken", special: "throw", specialEvery: 1900, throwLevels: ["high", "mid", "low"], hair: "bun",
    build: 0.9, speed: 1.1, skill: 0.25, aggression: 0.45, cooldown: 900, range: 64, reach: 0, quick: 1, attacks: ["sideKick", "highKick", "lungePunch"],
    palette: palette("#ff6fb5", "#ff6fb5", "#3a1f0f"), level: 1, note: "Shuriken at every height: punch them down" },
  { id: "nuncha", name: "NUNCHA", weapon: "nunchaku", special: "", hair: "short", build: 1, speed: 1, skill: 0.3, aggression: 0.6,
    cooldown: 800, range: 30, reach: 12, quick: 1, attacks: ["highPunch", "lungePunch", "highKick"],
    palette: palette("#ffd23f", "#ffd23f", "#151515"), level: 1, note: "Nunchaku, high and middle: stay low" },
  { id: "pole", name: "POLE", weapon: "bo", special: "vault", specialEvery: 2800, hair: "short", build: 1, speed: 0.95, skill: 0.3,
    aggression: 0.55, cooldown: 1100, range: 40, reach: 20, quick: 1.15, attacks: ["lungePunch", "sideKick", "sweep", "lowLunge"],
    palette: palette("#8a5a2b", "#3b2a1a", "#151515"), level: 1, note: "Vaults in on his bo" },
  { id: "feedle", name: "FEEDLE", weapon: "", special: "swarm", specialEvery: 2400, hair: "bald", build: 0.85, speed: 1.35, skill: 0.3,
    aggression: 0.6, cooldown: 700, range: 22, reach: 0, quick: 0.85, attacks: ["lungePunch", "sideKick", "crouchPunch"],
    palette: palette("#5fbf4a", "#2e6b25", "#d8d8d8"), level: 1, note: "There's more of him, from both sides" },
  { id: "chain", name: "CHAIN", weapon: "chain", special: "", hair: "short", build: 1.1, speed: 0.85, skill: 0.35, aggression: 0.6,
    cooldown: 1000, range: 56, reach: 40, quick: 1.6, attacks: ["sideKick", "lungePunch"],
    palette: palette("#5a5a66", "#2a2a33", "#151515"), level: 2, note: "A hooked chain from long range" },
  { id: "club", name: "CLUB", weapon: "club", special: "", shield: true, hair: "short", build: 1.2, speed: 0.8, skill: 0.35,
    aggression: 0.6, cooldown: 1100, range: 26, reach: 6, quick: 1.2, attacks: ["highPunch", "lungePunch", "sideKick"],
    palette: palette("#7d4e9e", "#3c2350", "#151515"), level: 2, note: "Shield up: strike high or low" },
  { id: "fan", name: "FAN", weapon: "fan", special: "throw", specialEvery: 2100, throwLevels: ["high"], hair: "long", build: 0.9,
    speed: 1.15, skill: 0.4, aggression: 0.55, cooldown: 800, range: 50, reach: 8, quick: 1, attacks: ["highPunch", "lungePunch"],
    palette: palette("#d64545", "#7a1f1f", "#151515"), level: 2, note: "Steel fans, thrown high: duck" },
  { id: "sword", name: "SWORD", weapon: "sword", special: "warp", specialEvery: 2600, hair: "mask", build: 1, speed: 1.1, skill: 0.45,
    aggression: 0.65, cooldown: 800, range: 30, reach: 14, quick: 1, attacks: ["highPunch", "lungePunch", "sideKick", "lowLunge"],
    palette: palette("#26262e", "#1a1a20", "#26262e"), level: 2, note: "Warps across the screen" },
  { id: "tonfun", name: "TONFUN", weapon: "tonfa", special: "", hair: "short", build: 1, speed: 1.6, skill: 0.45, aggression: 0.75,
    cooldown: 520, range: 22, reach: 6, quick: 0.65, attacks: ["highPunch", "lungePunch", "crouchPunch", "lowKick", "sideKick", "sweep"],
    palette: palette("#e07b39", "#7a3d14", "#151515"), level: 2, note: "Two tonfa, very fast" },
  { id: "blues", name: "BLUES", weapon: "", special: "mirror", hair: "long", build: 1, speed: 1.25, skill: 0.6, aggression: 0.7,
    cooldown: 600, range: 26, reach: 0, quick: 0.8, attacks: allAttacks,
    palette: palette("#3d7bd9", "#1e3f73", "#151515"), level: 2, note: "Everything you can do, faster" }
]

// Checked against Wikipedia and StrategyWiki.
var trivia = [
  "Konami's arcade original reached Japan in October 1984 and the world in 1985.",
  "It swapped Karate Champ's points for health meters, a fighting-game first.",
  "The arcade hero is Oolong. On MSX and Famicom he's called Lee.",
  "Eleven opponents, Buchu to Blues. Beat Blues and the tournament starts again.",
  "Thrown shuriken and fans can be punched or kicked for extra points.",
  "Oolong fights for the title of Grand Master, his late father's wish.",
  "Sixteen moves: eight joystick directions, each with punch or kick.",
  "Each fighter has ten hit points, and every clean strike takes one.",
  "Jumps only go towards the middle of the screen, and only attack at take-off.",
  "Music by Miki Higashino.",
  "The best-selling home video game of 1986 in the UK.",
  "The Game Boy Advance version hides two fighters behind the Konami Code."
]

// ---------- the code ----------

// Keeps the last ten keys and matches when they spell the code, so a stray
// extra "up" at the start still counts.
function konamiStep(buffer, token) {
  var next = (buffer || []).concat([String(token || "")]).slice(-konamiCode.length)
  return { buffer: next, matched: next.join(" ") === konamiCode.join(" ") }
}

// ---------- state ----------

function random(state) {
  state.seed = (state.seed + 0x6D2B79F5) | 0
  var t = state.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

// Later laps of the tournament run faster and smarter.
function scaled(profile, loop) {
  var p = {}
  for (var k in profile) p[k] = profile[k]
  p.speed = profile.speed * (1 + 0.12 * loop)
  p.skill = Math.min(0.8, profile.skill + 0.08 * loop)
  p.aggression = Math.min(0.95, profile.aggression + 0.05 * loop)
  p.cooldown = Math.max(300, profile.cooldown * (1 - 0.1 * loop))
  return p
}

function newFighter(profile, x, facing, isPlayer) {
  return {
    profile: profile, x: x, y: 0, vx: 0, vy: 0, kb: 0, facing: facing,
    crouch: false, action: null, airUsed: false, airT: 0, hitstun: 0,
    energy: maxEnergy, ko: false, won: false, isPlayer: isPlayer, clone: false,
    walkT: 0, cooldown: 700, specialT: profile.specialEvery || 0, duckFor: 0,
    retreatFor: 0, seen: null, flash: 0
  }
}

function newGame(seed, hiScore) {
  var state = {
    mode: "title", modeT: 0, clock: 0, seed: (seed | 0) || 1,
    score: 0, hiScore: hiScore || 0, lives: startLives, credits: startCredits,
    stage: 0, loop: 0, player: null, enemy: null, clones: [], projectiles: [],
    sparks: [], events: [], bonus: 0, perfect: false, demo: true, demoStage: 0
  }
  setupFight(state, 0, true)
  return state
}

function emit(state, name) {
  if (!state.demo) state.events.push(name)
}

// Each mode change has its cue, unless the caller plays its own instead.
function setMode(state, mode, quiet) {
  state.mode = mode
  state.modeT = 0
  var sound = { intro: "stage", fight: "fight", champion: "champion", gameover: "gameover" }[mode]
  if (sound && !quiet) emit(state, sound)
}

function setupFight(state, stage, demo) {
  state.stage = stage
  state.demo = !!demo
  state.player = newFighter(lee, 70, 1, true)
  state.enemy = newFighter(scaled(roster[stage], state.loop), 170, -1, false)
  state.clones = []
  state.swarmT = 1500
  state.projectiles = []
  state.sparks = []
}

function opponent(state) {
  return roster[state.stage]
}

function startGame(state) {
  state.score = 0
  state.lives = startLives
  state.loop = 0
  setupFight(state, 0, false)
  emit(state, "start")
  setMode(state, "intro", true)
}

function addScore(state, points) {
  state.score += points
  if (state.score > state.hiScore) state.hiScore = state.score
}

function spark(state, x, height, kind) {
  state.sparks.push({ x: x, y: floorY - height, kind: kind, at: state.clock })
}

// ---------- fighters ----------

function stance(f) {
  if (f.y > 6) return "air"
  if (f.action && f.action.move.stance !== "air") return f.action.move.stance
  if (f.crouch) return "crouch"
  return "stand"
}

function levelHits(level, st) {
  if (level === "high") return st === "stand" || st === "air"
  if (level === "mid") return st === "stand" || st === "crouch" || st === "air"
  if (level === "low") return st === "stand" || st === "crouch" || st === "floor"
  if (level === "up") return st === "stand" || st === "air"
  return false
}

// The joystick as the fighter sees it: "uf" is up and towards the way he
// faces. Empty when it's centred.
function relativeDir(input, facing) {
  var h = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * facing
  var v = (input.up ? 1 : 0) - (input.down ? 1 : 0)
  var side = h > 0 ? "f" : (h < 0 ? "b" : "")
  if (v > 0) return "u" + side
  if (v < 0) return "d" + side
  return side
}

function moveFor(button, dir) {
  return moveTable[button + ":" + dir] || ""
}

function startupOf(f, m) {
  return m.startup * (f.profile.quick || 1)
}

function recoveryOf(f, m) {
  return m.recovery * (f.profile.quick || 1)
}

function reachOf(f, m) {
  return m.reach + (m.level === "none" ? 0 : f.profile.reach || 0)
}

function isActive(f) {
  var a = f.action
  if (!a || a.move.level === "none") return false
  var start = startupOf(f, a.move)
  return a.t >= start && a.t < start + a.move.active
}

// Jumps only go towards the middle of the stage, as in the arcade.
function startJump(state, f, dir, drift) {
  var towardsMiddle = (stageCenter - f.x) * dir > 0
  f.vy = jumpSpeed
  f.vx = towardsMiddle ? dir * (drift || jumpDrift * f.profile.speed) : 0
  f.y = 0.01
  f.airT = 0
  f.airUsed = false
  f.crouch = false
  emit(state, "jump")
}

function startAction(state, f, name, vault) {
  var m = moves[name]
  f.action = { move: m, t: 0, hit: false, thrown: false }
  f.crouch = false
  if (m.jump) {
    startJump(state, f, m.jump === "forward" ? f.facing : 0, vault ? 0.17 : 0)
    f.airUsed = true
  } else if (name === "lunge") {
    f.vy = 0.16
    f.vx = 0.22 * f.facing
    f.y = 0.01
    f.airT = 0
    f.airUsed = true
  }
  if (m.level !== "none") emit(state, "swing")
}

// A button just after take-off turns the jump into a jump attack: straight
// up gives the jump punch or flying kick, a jump towards the foe the dive
// punch or jumping kick.
function airMove(f, button) {
  var forward = f.vx * f.facing > 0
  if (button === "punch") return forward ? "divePunch" : "jumpPunch"
  return forward ? "jumpKick" : "flyingKick"
}

function knockOut(state, f, dir) {
  f.ko = true
  f.action = null
  f.crouch = false
  f.hitstun = 0
  f.vy = 0.15
  f.y = Math.max(f.y, 0.01)
  f.kb = 0.1 * dir
  emit(state, "ko")
}

function hit(state, att, def, points, level, dir) {
  def.energy = Math.max(0, def.energy - 1)
  def.hitstun = hitstunMs
  def.action = null
  def.crouch = false
  def.kb = (att.profile.id === "club" ? 0.18 : 0.12) * dir
  def.flash = 200
  if (att.isPlayer && !state.demo) addScore(state, points)
  spark(state, def.x - dir * 4, levelHeight[level] + def.y, "hit")
  emit(state, "hit")
  if (def.clone) {
    // A Feedle double vanishes and takes one hit point off the real one.
    def.gone = true
    spark(state, def.x, 20, "warp")
    var main = state.enemy
    if (!main.ko) {
      main.energy = Math.max(0, main.energy - 1)
      if (main.energy === 0) knockOut(state, main, dir)
    }
  } else if (def.energy === 0) knockOut(state, def, dir)
}

// Club's shield turns middle attacks aimed at his front.
function blocks(def, att, m) {
  return def.profile.shield === true && m.level === "mid" && !def.action
    && def.hitstun === 0 && stance(def) === "stand" && def.facing === -att.facing
}

function resolveHit(state, att, def) {
  if (att.ko || def.ko || def.gone || !isActive(att) || att.action.hit) return
  var m = att.action.move
  var dx = (def.x - att.x) * att.facing
  if (dx < -bodyHalf || dx > reachOf(att, m) + bodyHalf) return
  if (!levelHits(m.level, stance(def))) return
  att.action.hit = true
  if (blocks(def, att, m)) {
    spark(state, def.x - att.facing * 6, levelHeight.mid, "block")
    emit(state, "block")
    return
  }
  hit(state, att, def, m.points, m.level, att.facing)
}

function advanceAction(state, f) {
  var a = f.action
  var m = a.move
  if (m.name === "throw" && !a.thrown && a.t >= startupOf(f, m)) {
    a.thrown = true
    spawnProjectile(state, f)
  }
  if (m.stance !== "air" && a.t >= startupOf(f, m) + m.active + recoveryOf(f, m)) f.action = null
}

function physics(f, dt) {
  f.x += (f.vx + f.kb) * dt
  if (f.kb !== 0) {
    var d = 0.0006 * dt
    f.kb = Math.abs(f.kb) <= d ? 0 : f.kb - (f.kb > 0 ? d : -d)
  }
  if (f.y > 0 || f.vy > 0) {
    f.airT += dt
    f.y += f.vy * dt
    f.vy -= gravity * dt
    if (f.y <= 0) {
      f.y = 0
      f.vy = 0
      f.vx = 0
      f.airUsed = false
      if (f.action && f.action.move.stance === "air") f.action = null
    }
  }
  f.x = clamp(f.x, stageLeft, stageRight)
}

function updateFighter(state, f, intent, dt, foe) {
  f.flash = Math.max(0, f.flash - dt)
  if (!f.ko && f.hitstun > 0) f.hitstun = Math.max(0, f.hitstun - dt)
  if (!f.ko && f.hitstun === 0) {
    if (f.action) {
      f.action.t += dt
      advanceAction(state, f)
    }
    var grounded = f.y <= 0 && f.vy <= 0
    if (!f.action && grounded) {
      f.facing = foe.x >= f.x ? 1 : -1
      f.crouch = !!intent.crouch && !intent.jump && !intent.attack
      f.vx = 0
      if (intent.attack) startAction(state, f, intent.attack, intent.vault)
      else if (intent.special) startAction(state, f, intent.special)
      else if (intent.jump) startJump(state, f, intent.jumpDir || 0)
      else if (!f.crouch && intent.move) {
        f.vx = intent.move * walkSpeed * f.profile.speed
        f.walkT += dt
      }
    } else if (!f.action && !grounded && !f.airUsed && f.airT <= jumpAttackWindow && intent.button) {
      startAirAttack(state, f, airMove(f, intent.button))
    }
  }
  physics(f, dt)
}

// Turns a jump already in the air into its attack, keeping its arc.
function startAirAttack(state, f, name) {
  f.action = { move: moves[name], t: 0, hit: false, thrown: false }
  f.airUsed = true
  emit(state, "swing")
}

// Grounded fighters can't stand inside each other; one in the air can pass
// over, and both turn to face on landing.
function separate(a, b) {
  if (a.ko || b.ko || a.y > 8 || b.y > 8) return
  var gap = Math.abs(a.x - b.x)
  if (gap >= minGap) return
  var dir = a.x < b.x ? -1 : (a.x > b.x ? 1 : -a.facing)
  var push = (minGap - gap) / 2
  a.x = clamp(a.x + dir * push, stageLeft, stageRight)
  b.x = clamp(b.x - dir * push, stageLeft, stageRight)
  if (Math.abs(a.x - b.x) < minGap) {
    if (a.x === stageLeft || a.x === stageRight) b.x = clamp(a.x - dir * minGap, stageLeft, stageRight)
    else a.x = clamp(b.x + dir * minGap, stageLeft, stageRight)
  }
}

// Sword reappears on the far side of you.
function teleport(state, f, foe) {
  var side = f.x <= foe.x ? 1 : -1
  var x = clamp(foe.x + side * 34, stageLeft, stageRight)
  if ((x - foe.x) * side < minGap) return false
  spark(state, f.x, 20, "warp")
  f.x = x
  f.facing = -side
  spark(state, f.x, 20, "warp")
  emit(state, "warp")
  return true
}

// The doubles are slower to strike than Feedle himself.
function cloneProfile(profile) {
  var p = {}
  for (var k in profile) p[k] = profile[k]
  p.special = ""
  p.aggression = profile.aggression * 0.5
  p.cooldown = profile.cooldown * 1.8
  p.skill = profile.skill * 0.5
  return p
}

// Feedle's doubles walk in from the side he isn't on, two at most, and only
// while he has hit points to spare for them.
function updateSwarm(state, dt) {
  var e = state.enemy
  var p = state.player
  if (e.profile.special !== "swarm" || e.ko) return
  state.swarmT -= dt
  if (state.swarmT > 0 || state.clones.length >= 2 || e.energy <= state.clones.length + 1) return
  state.swarmT = e.profile.specialEvery * (0.7 + random(state) * 0.6)
  var fromLeft = e.x > p.x
  var c = newFighter(cloneProfile(e.profile), fromLeft ? stageLeft : stageRight, fromLeft ? 1 : -1, false)
  c.clone = true
  c.energy = 1
  c.cooldown = 900
  state.clones.push(c)
  spark(state, c.x, 20, "warp")
  emit(state, "warp")
}

// ---------- projectiles ----------

function spawnProjectile(state, f) {
  var levels = f.profile.throwLevels || ["mid"]
  var level = levels[Math.floor(random(state) * levels.length)]
  state.projectiles.push({
    x: f.x + f.facing * 10, level: level, vx: 0.15 * f.facing,
    kind: f.profile.weapon || "shuriken", fromPlayer: f.isPlayer, spin: 0
  })
  emit(state, "throw")
}

// An active attack swats a throw out of the air if it's at the right height.
function swats(f, pr) {
  if (!isActive(f)) return false
  var m = f.action.move
  var dx = (pr.x - f.x) * f.facing
  return dx >= 0 && dx <= reachOf(f, m) + 4 && (m.level === pr.level || m.level === "mid")
}

function updateProjectiles(state, dt) {
  var kept = []
  for (var i = 0; i < state.projectiles.length; i++) {
    var pr = state.projectiles[i]
    pr.x += pr.vx * dt
    pr.spin += dt
    var target = pr.fromPlayer ? state.enemy : state.player
    var thrower = pr.fromPlayer ? state.player : state.enemy
    if (pr.x < stageLeft - 10 || pr.x > stageRight + 10) continue
    if (!target.ko && swats(target, pr)) {
      if (target.isPlayer && !state.demo) addScore(state, 500)
      spark(state, pr.x, levelHeight[pr.level], "block")
      emit(state, "swat")
      continue
    }
    if (!target.ko && Math.abs(target.x - pr.x) < bodyHalf && levelHits(pr.level, stance(target))) {
      hit(state, thrower, target, 0, pr.level, pr.vx > 0 ? 1 : -1)
      continue
    }
    kept.push(pr)
  }
  state.projectiles = kept
}

// ---------- the opponent ----------

function idleIntent() {
  return { move: 0, jump: false, jumpDir: 0, crouch: false, attack: "", button: "", special: "", vault: false }
}

function fits(f, name, dist) {
  var m = moves[name]
  if (m.jump === "forward") return dist > 40 && dist < 120
  if (m.jump === "up") return dist < 36
  return dist <= reachOf(f, m) + bodyHalf
}

function useSpecial(state, f, foe, dist, intent) {
  var kind = f.profile.special
  if (kind === "lunge" && dist > 40 && dist < 150) intent.special = "lunge"
  else if (kind === "throw" && dist > 36) intent.special = "throw"
  else if (kind === "vault" && dist > 50 && dist < 130) {
    intent.attack = "jumpKick"
    intent.vault = true
  } else if (kind === "warp") return teleport(state, f, foe)
  else return false
  return true
}

function aiIntent(state, f, foe, dt) {
  var intent = idleIntent()
  var p = f.profile
  f.cooldown -= dt
  f.specialT -= dt
  if (f.ko || foe.ko || f.hitstun > 0 || f.action || f.y > 0) return intent

  var dist = Math.abs(foe.x - f.x)
  var toward = foe.x >= f.x ? 1 : -1

  // Read the foe's wind-up: duck a high one, jump a low one, back off the
  // rest. Blues may answer with the same move instead.
  if (foe.action && foe.action !== f.seen && foe.action.move.level !== "none") {
    f.seen = foe.action
    var name = foe.action.move.name
    if (p.special === "mirror" && moves[name].button && random(state) < 0.5 && fits(f, name, dist)) {
      intent.attack = name
      return intent
    }
    if (dist < 70 && random(state) < p.skill) {
      var level = foe.action.move.level
      if (level === "high") f.duckFor = 320
      else if (level === "low") {
        intent.jump = true
        return intent
      } else f.retreatFor = 260
    }
  }
  // A jumper coming in gets a kick that rises to meet him.
  if (foe.y > 10 && dist < 40 && p.attacks.indexOf("risingKick") >= 0 && f.cooldown <= 0 && random(state) < p.skill) {
    intent.attack = "risingKick"
    f.cooldown = p.cooldown
    return intent
  }
  if (f.duckFor > 0) {
    f.duckFor -= dt
    intent.crouch = true
    if (f.cooldown <= 0 && dist <= reachOf(f, moves.sweep) + bodyHalf) {
      intent.attack = "sweep"
      f.cooldown = p.cooldown
    }
    return intent
  }
  if (f.retreatFor > 0) {
    f.retreatFor -= dt
    intent.move = -toward
    return intent
  }

  if (p.special && p.special !== "swarm" && p.special !== "mirror" && f.specialT <= 0) {
    f.specialT = p.specialEvery * (0.7 + random(state) * 0.6)
    if (useSpecial(state, f, foe, dist, intent)) return intent
  }

  if (dist > p.range + 6) intent.move = toward
  else if (dist < p.range - 12) intent.move = -toward

  if (f.cooldown <= 0) {
    var choice = p.attacks[Math.floor(random(state) * p.attacks.length)]
    if (fits(f, choice, dist)) {
      f.cooldown = p.cooldown * (0.6 + random(state) * 0.8)
      if (random(state) < p.aggression) {
        intent.move = 0
        intent.attack = choice
      }
    }
  }
  return intent
}

// Arcade controls: the joystick walks, jumps (up) and crouches (down). A
// button with a direction is one of sixteen attacks, by pressing the button
// while holding the direction or the direction while holding the button.
// On a keyboard a button alone gives the forward attack; in the arcade it
// did nothing.
function playerIntent(input, facing) {
  var intent = idleIntent()
  if (!input) return intent
  var button = input.punch ? "punch" : (input.kick ? "kick" : "")
  if (!button && input.dirPressed) button = input.punchHeld ? "punch" : (input.kickHeld ? "kick" : "")
  if (button) {
    intent.button = button
    intent.attack = moveFor(button, relativeDir(input, facing) || "f")
    return intent
  }
  if (input.punchHeld || input.kickHeld) return intent
  intent.move = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  intent.jump = !!input.up
  intent.jumpDir = intent.move
  intent.crouch = !!input.down
  return intent
}

// ---------- the loop ----------

function nearestFoe(state) {
  var p = state.player
  var best = state.enemy
  state.clones.forEach(function(c) {
    if (!c.gone && (best.ko || Math.abs(c.x - p.x) < Math.abs(best.x - p.x))) best = c
  })
  return best
}

function fightStep(state, input, dt, controlled) {
  var p = state.player
  var e = state.enemy
  var target = nearestFoe(state)
  var pi = state.demo ? aiIntent(state, p, target, dt) : (controlled ? playerIntent(input, p.facing) : idleIntent())
  var ei = controlled || state.demo ? aiIntent(state, e, p, dt) : idleIntent()
  updateFighter(state, p, pi, dt, target)
  updateFighter(state, e, ei, dt, p)
  state.clones.forEach(function(c) {
    updateFighter(state, c, controlled || state.demo ? aiIntent(state, c, p, dt) : idleIntent(), dt, p)
  })
  separate(p, e)
  state.clones.forEach(function(c) { separate(p, c) })
  updateProjectiles(state, dt)
  resolveHit(state, p, e)
  resolveHit(state, e, p)
  state.clones.forEach(function(c) {
    resolveHit(state, p, c)
    resolveHit(state, c, p)
  })
  state.clones = e.ko ? [] : state.clones.filter(function(c) { return !c.gone })
  if (controlled || state.demo) updateSwarm(state, dt)
}

function nextStage(state) {
  if (state.stage + 1 >= roster.length) {
    setMode(state, "champion")
    return
  }
  setupFight(state, state.stage + 1, false)
  setMode(state, "intro")
}

function step(state, input, dt) {
  dt = clamp(dt || 0, 0, 50)
  input = input || {}
  state.clock += dt
  state.modeT += dt
  var kept = []
  for (var i = 0; i < state.sparks.length; i++) {
    if (state.clock - state.sparks[i].at < sparkMs) kept.push(state.sparks[i])
  }
  state.sparks = kept

  var mode = state.mode
  if (mode === "title") {
    fightStep(state, null, dt, true)
    if (state.player.ko || state.enemy.ko) {
      if (state.player.ko) state.enemy.won = true
      else state.player.won = true
      state.demoT = (state.demoT || 0) + dt
      if (state.demoT > timings.demoRestart) {
        state.demoT = 0
        state.demoStage = (state.demoStage + 1) % roster.length
        setupFight(state, state.demoStage, true)
      }
    }
    if (input.start) startGame(state)
  } else if (mode === "intro") {
    fightStep(state, null, dt, false)
    if (state.modeT >= timings.intro) setMode(state, "fight")
  } else if (mode === "fight") {
    if (input.pause) {
      setMode(state, "pause")
      return state
    }
    fightStep(state, input, dt, true)
    if (state.enemy.ko) {
      state.player.won = true
      setMode(state, "ko")
    } else if (state.player.ko) {
      state.enemy.won = true
      setMode(state, "down")
    }
  } else if (mode === "pause") {
    if (input.pause || input.start) setMode(state, "fight")
  } else if (mode === "ko") {
    fightStep(state, null, dt, false)
    if (state.modeT >= timings.ko) {
      state.perfect = state.player.energy === maxEnergy
      state.bonus = state.player.energy * 1000 + (state.perfect ? 5000 : 0)
      addScore(state, state.bonus)
      emit(state, state.perfect ? "perfect" : "bonus")
      setMode(state, "clear")
    }
  } else if (mode === "clear") {
    if (state.modeT >= timings.clear) nextStage(state)
  } else if (mode === "champion") {
    if (state.modeT >= timings.champion) {
      state.loop++
      setupFight(state, 0, false)
      setMode(state, "intro")
    }
  } else if (mode === "down") {
    fightStep(state, null, dt, false)
    if (state.modeT >= timings.down) {
      state.lives--
      if (state.lives > 0) {
        setupFight(state, state.stage, false)
        setMode(state, "intro")
      } else setMode(state, "continue")
    }
  } else if (mode === "continue") {
    if (input.start && state.credits > 0) {
      state.credits--
      state.lives = startLives
      state.score = 0
      setupFight(state, state.stage, false)
      emit(state, "start")
      setMode(state, "intro", true)
    } else if (continueCount(state) < 0) setMode(state, "gameover")
  } else if (mode === "gameover") {
    if (state.modeT >= timings.gameover) {
      state.loop = 0
      state.demoStage = 0
      setupFight(state, 0, true)
      setMode(state, "title")
    }
  }
  return state
}

// Hands the frame's sound cues to the caller and clears them.
function takeEvents(state) {
  var out = state.events
  state.events = []
  return out
}

function continueCount(state) {
  return timings.continueSecs - Math.floor(state.modeT / 1000)
}

// What the screen should say over the fight, if anything.
function banner(state) {
  var m = state.mode
  if (m === "title") return ""
  if (m === "intro") return state.modeT < timings.intro - 500 ? "STAGE " + (state.stage + 1) : "FIGHT!"
  if (m === "pause") return "PAUSE"
  if (m === "ko" || m === "down") return "K.O."
  if (m === "clear") return state.perfect ? "PERFECT!" : "BONUS " + state.bonus
  if (m === "champion") return "GRAND MASTER"
  if (m === "continue") return "CONTINUE? " + Math.max(0, continueCount(state))
  if (m === "gameover") return "GAME OVER"
  return ""
}

function stageLevel(state) {
  return roster[state.stage].level
}

function pad(n, width) {
  var s = String(Math.max(0, Math.floor(n)))
  while (s.length < width) s = "0" + s
  return s
}

// ---------- the figures ----------

// Angles in degrees from straight down, positive towards the way the fighter
// faces. Columns: front thigh, front shin, back thigh, back shin, torso lean,
// front upper arm, front forearm, back upper arm, back forearm.
var poses = {
  stand: [18, 2, -18, -4, 0, 45, 125, 20, 110],
  walk1: [30, 10, -24, -14, 2, 45, 125, 20, 110],
  walk2: [-6, -12, 12, 2, 2, 45, 125, 20, 110],
  crouch: [80, -20, 35, -95, 15, 60, 135, 30, 120],
  jump: [85, -30, 40, -70, 5, 75, 150, 45, 140],
  highPunch: [14, 2, -14, -4, -4, 150, 150, 20, 100],
  lungePunch: [50, 5, -45, -10, 15, 92, 92, 10, 60],
  lowLunge: [70, 0, -70, -20, 25, 75, 75, 20, 80],
  crouchPunch: [80, -20, 35, -95, 20, 85, 85, 30, 120],
  splitPunch: [92, 92, -92, -92, 30, 95, 95, 140, 160],
  risingPunch: [45, 5, -60, -15, 10, 140, 145, 10, 60],
  jumpPunch: [85, -30, 40, -70, 10, 100, 98, 45, 140],
  divePunch: [-30, -40, -60, -70, 45, 70, 60, 150, 170],
  highKick: [170, 175, -5, -5, -20, 60, 140, 150, 170],
  sideKick: [92, 92, -12, -6, -22, 60, 140, 150, 170],
  sweep: [96, 96, 12, -95, 30, 130, 120, 10, 60],
  lowKick: [65, 70, 30, -95, 15, 60, 135, 30, 120],
  groundKick: [175, 178, 60, -30, -95, -40, -60, -100, -80],
  risingKick: [135, 140, 30, -95, -10, 60, 135, 30, 120],
  flyingKick: [88, 90, 20, -80, -25, 40, 90, 150, 170],
  jumpKick: [130, 135, 30, -70, -15, 60, 140, 150, 170],
  throw: [22, 2, -24, -6, 8, 140, 110, 20, 100],
  lunge: [-60, -70, -40, -80, 80, 100, 95, 95, 90],
  hit: [10, 0, -26, -10, -28, 150, 200, -40, -20],
  down: [92, 92, 86, 88, -90, -60, -80, -100, -90],
  win: [18, 2, -18, -4, -5, 170, 175, 30, 100]
}

var floorPoses = { down: true, splitPunch: true, groundKick: true }
var proportions = { thigh: 11, shin: 11, torso: 15, upper: 8, fore: 8, head: 4.5, foot: 4 }

function poseOf(f) {
  if (f.ko) return f.y > 0 ? "hit" : "down"
  if (f.hitstun > 0) return "hit"
  if (f.action) return f.action.move.name
  if (f.y > 0) return "jump"
  if (f.crouch) return "crouch"
  if (f.won) return "win"
  if (f.vx !== 0) return Math.floor(f.walkT / 140) % 2 === 0 ? "walk1" : "walk2"
  return "stand"
}

function along(x, y, angle, length, facing) {
  var r = angle * Math.PI / 180
  return { x: x + Math.sin(r) * length * facing, y: y + Math.cos(r) * length }
}

function legDrop(thigh, shin, k) {
  var r1 = thigh * Math.PI / 180
  var r2 = shin * Math.PI / 180
  return Math.max(Math.cos(r1) * proportions.thigh * k + Math.cos(r2) * proportions.shin * k, 2)
}

// The skeleton for one frame, in world pixels: thick limbs drawn back to
// front with a dark outline under them, fists and feet, a head with its hair
// style, and the weapon.
function figure(f, attackOn) {
  var name = poseOf(f)
  var a = poses[name]
  var k = f.profile.build || 1
  var c = f.profile.palette
  var dir = f.facing
  var air = f.y > 0 && !f.ko
  var hipH = floorPoses[name] ? 3 : (air ? 24 * k : Math.max(legDrop(a[0], a[1], k), legDrop(a[2], a[3], k)))
  var hip = { x: f.x, y: floorY - f.y - hipH }

  var fKnee = along(hip.x, hip.y, a[0], proportions.thigh * k, dir)
  var fAnkle = along(fKnee.x, fKnee.y, a[1], proportions.shin * k, dir)
  var bKnee = along(hip.x, hip.y, a[2], proportions.thigh * k, dir)
  var bAnkle = along(bKnee.x, bKnee.y, a[3], proportions.shin * k, dir)
  var neck = along(hip.x, hip.y, 180 - a[4], proportions.torso * k, dir)
  var chest = along(hip.x, hip.y, 180 - a[4], proportions.torso * k * 0.55, dir)
  var shoulder = along(hip.x, hip.y, 180 - a[4], proportions.torso * k * 0.88, dir)
  var head = along(hip.x, hip.y, 180 - a[4], (proportions.torso + proportions.head + 1) * k, dir)
  var fElbow = along(shoulder.x, shoulder.y, a[5], proportions.upper * k, dir)
  var fHand = along(fElbow.x, fElbow.y, a[6], proportions.fore * k, dir)
  var bElbow = along(shoulder.x, shoulder.y, a[7], proportions.upper * k, dir)
  var bHand = along(bElbow.x, bElbow.y, a[8], proportions.fore * k, dir)
  var fToe = along(fAnkle.x, fAnkle.y, a[1] + 90, proportions.foot * k, dir)
  var bToe = along(bAnkle.x, bAnkle.y, a[3] + 90, proportions.foot * k, dir)

  var limb = Math.round(3 * k)
  var leg = limb + 1
  var parts = [
    { from: shoulder, to: bElbow, w: limb, color: c.top },
    { from: bElbow, to: bHand, w: limb, color: c.skin },
    { from: bHand, to: bHand, w: limb + 1, color: c.skin },
    { from: hip, to: bKnee, w: leg, color: c.pants },
    { from: bKnee, to: bAnkle, w: leg, color: c.pants },
    { from: bAnkle, to: bToe, w: limb, color: c.shoes },
    { from: hip, to: chest, w: Math.round(6 * k), color: c.top },
    { from: chest, to: neck, w: Math.round(7 * k), color: c.top },
    { from: hip, to: fKnee, w: leg, color: c.pants },
    { from: fKnee, to: fAnkle, w: leg, color: c.pants },
    { from: fAnkle, to: fToe, w: limb, color: c.shoes },
    { from: shoulder, to: fElbow, w: limb, color: c.top },
    { from: fElbow, to: fHand, w: limb, color: c.skin },
    { from: fHand, to: fHand, w: limb + 1, color: c.skin }
  ]
  var sash = f.profile.sash || ""
  if (sash && !floorPoses[name]) {
    parts.push({ from: { x: hip.x - dir * 3 * k, y: hip.y }, to: { x: hip.x + dir * 3 * k, y: hip.y }, w: 2, color: sash })
    parts.push({ from: { x: hip.x - dir * 3 * k, y: hip.y }, to: { x: hip.x - dir * 6 * k, y: hip.y + 5 * k }, w: 1, color: sash })
  }
  return {
    pose: name,
    parts: parts,
    head: { x: head.x, y: head.y, r: proportions.head * k, skin: c.skin, hair: c.hair, style: f.profile.hair || "short" },
    weapon: weaponParts(f, fHand, bHand, a[6], attackOn, k)
  }
}

function weaponParts(f, hand, backHand, foreAngle, attackOn, k) {
  var dir = f.facing
  var w = f.profile.weapon
  var out = []
  if (w === "bo") {
    out.push({ from: along(hand.x, hand.y, foreAngle + 180, 8, dir), to: along(hand.x, hand.y, foreAngle, attackOn ? 30 : 22, dir), w: 2, color: "#b07a42" })
  } else if (w === "nunchaku") {
    var stick = along(hand.x, hand.y, foreAngle, 6, dir)
    var swing = attackOn ? foreAngle : foreAngle + 140
    var link = along(stick.x, stick.y, swing, 3, dir)
    out.push({ from: hand, to: stick, w: 2, color: "#c8892e" })
    out.push({ from: stick, to: link, w: 1, color: "#9aa0a6" })
    out.push({ from: link, to: along(link.x, link.y, swing, attackOn ? 12 : 6, dir), w: 2, color: "#c8892e" })
  } else if (w === "chain") {
    var tip = attackOn ? { x: f.x + dir * (moves.sideKick.reach + f.profile.reach), y: hand.y } : along(hand.x, hand.y, foreAngle + 160, 6, dir)
    out.push({ from: hand, to: tip, w: 1, color: "#b8bec6" })
    out.push({ from: tip, to: { x: tip.x + dir * 2, y: tip.y + 2 }, w: 2, color: "#e2e6ea" })
  } else if (w === "club") {
    var end = along(hand.x, hand.y, foreAngle, 11 * k, dir)
    out.push({ from: hand, to: end, w: 4, color: "#6b4423" })
    out.push({ from: { x: end.x - 2, y: end.y - 2 }, to: { x: end.x + 2, y: end.y + 2 }, w: 1, color: "#d9dde3" })
    out.push({ from: { x: backHand.x, y: backHand.y - 6 * k }, to: { x: backHand.x, y: backHand.y + 6 * k }, w: Math.round(7 * k), color: "#8d99ae" })
    out.push({ from: { x: backHand.x, y: backHand.y - 1 }, to: { x: backHand.x, y: backHand.y + 1 }, w: 2, color: "#c9a227" })
  } else if (w === "sword") {
    out.push({ from: hand, to: along(hand.x, hand.y, foreAngle, attackOn ? 18 : 13, dir), w: 2, color: "#d9dde3" })
    out.push({ from: along(hand.x, hand.y, foreAngle - 90, 2, dir), to: along(hand.x, hand.y, foreAngle + 90, 2, dir), w: 1, color: "#c9a227" })
  } else if (w === "fan") {
    out.push({ from: hand, to: along(hand.x, hand.y, foreAngle - 25, 7, dir), w: 2, color: "#f2c14e" })
    out.push({ from: hand, to: along(hand.x, hand.y, foreAngle + 25, 7, dir), w: 2, color: "#f2c14e" })
    out.push({ from: hand, to: along(hand.x, hand.y, foreAngle, 7, dir), w: 2, color: "#e0a92e" })
  } else if (w === "tonfa") {
    out.push({ from: along(hand.x, hand.y, foreAngle + 180, 4, dir), to: along(hand.x, hand.y, foreAngle, attackOn ? 9 : 5, dir), w: 2, color: "#5c3b1e" })
    out.push({ from: along(backHand.x, backHand.y, foreAngle + 180, 4, dir), to: along(backHand.x, backHand.y, foreAngle, 5, dir), w: 2, color: "#5c3b1e" })
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    worldWidth: worldWidth,
    worldHeight: worldHeight,
    floorY: floorY,
    stageLeft: stageLeft,
    stageRight: stageRight,
    stageCenter: stageCenter,
    maxEnergy: maxEnergy,
    startLives: startLives,
    startCredits: startCredits,
    jumpAttackWindow: jumpAttackWindow,
    konamiCode: konamiCode,
    timings: timings,
    moves: moves,
    punches: punches,
    kicks: kicks,
    levelHeight: levelHeight,
    roster: roster,
    lee: lee,
    trivia: trivia,
    poses: poses,
    konamiStep: konamiStep,
    random: random,
    scaled: scaled,
    newFighter: newFighter,
    newGame: newGame,
    setupFight: setupFight,
    opponent: opponent,
    startGame: startGame,
    stance: stance,
    levelHits: levelHits,
    relativeDir: relativeDir,
    moveFor: moveFor,
    reachOf: reachOf,
    isActive: isActive,
    startAction: startAction,
    resolveHit: resolveHit,
    updateFighter: updateFighter,
    separate: separate,
    teleport: teleport,
    updateSwarm: updateSwarm,
    spawnProjectile: spawnProjectile,
    updateProjectiles: updateProjectiles,
    aiIntent: aiIntent,
    playerIntent: playerIntent,
    nearestFoe: nearestFoe,
    step: step,
    takeEvents: takeEvents,
    continueCount: continueCount,
    banner: banner,
    stageLevel: stageLevel,
    pad: pad,
    poseOf: poseOf,
    figure: figure
  }
}
