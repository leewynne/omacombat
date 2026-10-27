const test = require("node:test")
const assert = require("node:assert/strict")

const Game = require("../Arcade.js")

const frame = 16

function run(state, ms, input) {
  for (let t = 0; t < ms; t += frame) Game.step(state, typeof input === "function" ? input(state, t) : input, frame)
  return state
}

// A fight at a given stage, already past the intro.
function fight(stage = 0, seed = 7) {
  const state = Game.newGame(seed, 0)
  Game.startGame(state)
  Game.setupFight(state, stage, false)
  state.mode = "fight"
  return state
}

// Two fighters facing each other at a set gap, for the hit rules.
function duel(gap, enemyStage = 0) {
  const p = Game.newFighter(Game.lee, 100, 1, true)
  const e = Game.newFighter(Game.roster[enemyStage], 100 + gap, -1, false)
  const state = { clock: 0, sparks: [], projectiles: [], score: 0, hiScore: 0, demo: false, seed: 1, player: p, enemy: e }
  return { state, p, e }
}

// An opponent that stands still, for tests about the player's side.
function passive(state) {
  state.enemy.profile = { ...state.enemy.profile, skill: 0, aggression: 0, special: "" }
  return state
}

function activate(f, name) {
  Game.startAction(f, name)
  f.action.t = f.action.move.startup * (f.profile.quick || 1)
}

test("konamiStep matches the code, even after a false start", () => {
  let buf = []
  let matched = false
  for (const key of ["up", ...Game.konamiCode]) ({ buffer: buf, matched } = Game.konamiStep(buf, key))
  assert.equal(matched, true)
  assert.equal(Game.konamiStep([], "up").matched, false)
  assert.equal(Game.konamiStep(Game.konamiCode.slice(0, 9), "b").matched, false)
  assert.equal(Game.konamiStep(undefined, undefined).buffer.length, 1)
})

test("a new game opens on the title with a demo bout and 30 credits", () => {
  const s = Game.newGame(3, 1200)
  assert.equal(s.mode, "title")
  assert.equal(s.demo, true)
  assert.equal(s.credits, 30)
  assert.equal(s.hiScore, 1200)
  assert.equal(Game.banner(s), "")
  assert.equal(Game.newGame(0).seed, 1)
})

test("the demo plays itself without scoring, then Enter starts stage 1", () => {
  const s = run(Game.newGame(42, 0), 40000, {})
  assert.equal(s.score, 0)
  assert.ok(s.demoStage > 0, "the demo moved on to another opponent")
  Game.step(s, { start: true }, frame)
  assert.equal(s.mode, "intro")
  assert.equal(s.stage, 0)
  assert.equal(s.demo, false)
  assert.equal(Game.banner(s), "STAGE 1")
  run(s, Game.timings.intro - 400, {})
  assert.equal(Game.banner(s), "FIGHT!")
  run(s, 400, {})
  assert.equal(s.mode, "fight")
})

test("attack levels: crouch ducks high, a jump clears low, mid hits all", () => {
  assert.equal(Game.levelHits("high", "stand"), true)
  assert.equal(Game.levelHits("high", "crouch"), false)
  assert.equal(Game.levelHits("high", "air"), true)
  assert.equal(Game.levelHits("low", "crouch"), true)
  assert.equal(Game.levelHits("low", "air"), false)
  assert.equal(Game.levelHits("mid", "air"), true)
  assert.equal(Game.levelHits("none", "stand"), false)
})

test("a punch in reach lands, scores and staggers", () => {
  const { state, p, e } = duel(24)
  activate(p, "punch")
  Game.resolveHit(state, p, e)
  assert.equal(e.energy, Game.maxEnergy - 1)
  assert.equal(e.hitstun > 0, true)
  assert.equal(state.score, 100)
  assert.equal(state.hiScore, 100)
  assert.equal(state.sparks.length, 1)
  Game.resolveHit(state, p, e)
  assert.equal(e.energy, Game.maxEnergy - 1, "one hit per attack")
})

test("misses: out of reach, ducked under, jumped over", () => {
  let d = duel(40)
  activate(d.p, "punch")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, Game.maxEnergy)

  d = duel(20)
  d.e.crouch = true
  activate(d.p, "punch")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, Game.maxEnergy)

  d = duel(20)
  d.e.y = 20
  activate(d.p, "sweep")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, Game.maxEnergy)

  d = duel(20)
  Game.startAction(d.p, "kick")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, Game.maxEnergy, "still winding up")
})

test("weapons add reach: Pole hits from where Lee can't", () => {
  const d = duel(40, 3)
  d.e.facing = -1
  activate(d.e, "kick")
  Game.resolveHit(d.state, d.e, d.p)
  assert.equal(d.p.energy, Game.maxEnergy - 1)
  assert.equal(d.state.score, 0, "the opponent doesn't score for you")
})

test("Club's shield turns a middle kick from the front, not a high punch", () => {
  const d = duel(20, 6)
  activate(d.p, "kick")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, Game.maxEnergy)
  assert.equal(d.state.sparks[0].kind, "block")
  activate(d.p, "punch")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, Game.maxEnergy - 1)
})

test("Club hits for two", () => {
  const d = duel(20, 6)
  activate(d.e, "punch")
  Game.resolveHit(d.state, d.e, d.p)
  assert.equal(d.p.energy, Game.maxEnergy - 2)
})

test("the last hit knocks out and the body falls", () => {
  const { state, p, e } = duel(20)
  e.energy = 1
  activate(p, "flyKick")
  Game.resolveHit(state, p, e)
  assert.equal(e.ko, true)
  assert.equal(Game.poseOf(e), "hit")
  for (let i = 0; i < 60; i++) Game.updateFighter(state, e, {}, frame, p)
  assert.equal(e.y, 0)
  assert.equal(Game.poseOf(e), "down")
})

test("player controls: walk, duck, jump, and the attacks change with stance", () => {
  const s = passive(fight())
  const p = s.player
  run(s, 200, { right: true })
  assert.ok(p.x > 70)
  assert.equal(Game.poseOf(p).startsWith("walk"), true)

  Game.step(s, { down: true }, frame)
  assert.equal(Game.stance(p), "crouch")
  Game.step(s, { down: true, kick: true }, frame)
  assert.equal(p.action.move.name, "sweep")
  run(s, 600, {})

  Game.step(s, { down: true, punch: true }, frame)
  assert.equal(p.action.move.name, "lowPunch")
  run(s, 600, {})

  Game.step(s, { punch: true }, frame)
  assert.equal(p.action.move.name, "punch")
  run(s, 600, {})

  Game.step(s, { up: true, right: true }, frame)
  assert.ok(p.y > 0)
  Game.step(s, { kick: true }, frame)
  assert.equal(p.action.move.name, "flyKick")
  Game.step(s, { punch: true }, frame)
  assert.equal(p.action.move.name, "flyKick", "one air attack per jump")
  run(s, 700, {})
  assert.equal(p.y, 0)
  assert.equal(p.action, null, "air attacks end on landing")

  Game.step(s, { up: true }, frame)
  Game.step(s, { punch: true }, frame)
  assert.equal(p.action.move.name, "airPunch")
})

test("a jump lands after about 640 ms", () => {
  const s = fight()
  Game.step(s, { up: true }, frame)
  let t = frame
  while (s.player.y > 0 && t < 2000) {
    Game.step(s, {}, frame)
    t += frame
  }
  assert.ok(t > 560 && t < 720, `landed after ${t} ms`)
})

test("grounded fighters can't overlap, and walls hold", () => {
  const a = Game.newFighter(Game.lee, 100, 1, true)
  const b = Game.newFighter(Game.lee, 104, -1, false)
  Game.separate(a, b)
  assert.ok(Math.abs(a.x - b.x) >= 18)

  const c = Game.newFighter(Game.lee, Game.stageLeft, 1, true)
  const d = Game.newFighter(Game.lee, Game.stageLeft, -1, false)
  Game.separate(c, d)
  assert.ok(Math.abs(c.x - d.x) >= 18)

  const e = Game.newFighter(Game.lee, Game.stageRight - 2, 1, true)
  const f = Game.newFighter(Game.lee, Game.stageRight, -1, false)
  Game.separate(e, f)
  assert.ok(Math.abs(e.x - f.x) >= 18)

  const g = Game.newFighter(Game.lee, 100, 1, true)
  const h = Game.newFighter(Game.lee, 104, -1, false)
  g.y = 20
  Game.separate(g, h)
  assert.equal(h.x, 104, "a jumper passes over")
})

test("Star's shuriken fly, hit, and can be knocked down for 500", () => {
  const s = fight(1)
  Game.startAction(s.enemy, "throw")
  run(s, 300, {})
  assert.equal(s.projectiles.length, 1)
  const pr = s.projectiles[0]
  assert.equal(pr.kind, "shuriken")
  assert.ok(["high", "mid", "low"].includes(pr.level))

  // Swat it: a mid kick covers any height but the floor.
  pr.level = "mid"
  pr.x = s.player.x + 20
  pr.vx = -0.15
  activate(s.player, "kick")
  const before = s.score
  Game.updateProjectiles(s, frame)
  assert.equal(s.projectiles.length, 0)
  assert.equal(s.score, before + 500)

  // Unswatted, it hits.
  s.player.action = null
  s.projectiles.push({ x: s.player.x + 2, level: "mid", vx: -0.15, kind: "shuriken", fromPlayer: false, spin: 0 })
  Game.updateProjectiles(s, frame)
  assert.equal(s.player.energy, Game.maxEnergy - 1)

  // Ducked, a high one sails over and leaves the stage.
  s.player.hitstun = 0
  s.player.crouch = true
  s.projectiles.push({ x: s.player.x + 2, level: "high", vx: -0.15, kind: "fan", fromPlayer: false, spin: 0 })
  Game.updateProjectiles(s, frame)
  assert.equal(s.projectiles.length, 1)
  for (let i = 0; i < 200; i++) Game.updateProjectiles(s, frame)
  assert.equal(s.projectiles.length, 0)
})

test("Feedle and Sword reappear on your far side", () => {
  const s = fight(4)
  s.enemy.x = 150
  s.player.x = 100
  assert.equal(Game.teleport(s, s.enemy, s.player), true)
  assert.equal(s.enemy.x, 66)
  assert.equal(s.enemy.facing, 1)

  s.player.x = Game.stageLeft + 4
  s.enemy.x = 60
  assert.equal(Game.teleport(s, s.enemy, s.player), false, "no room behind")
})

test("each opponent's trick fires in a real bout", () => {
  const seen = {}
  for (let stage = 0; stage < Game.roster.length; stage++) {
    const s = fight(stage, 100 + stage)
    const id = Game.roster[stage].id
    run(s, 20000, (st) => {
      const a = st.enemy.action
      if (a && (a.move.name === "lunge" || a.move.name === "throw")) seen[id] = true
      if (st.sparks.some(k => k.kind === "warp")) seen[id] = true
      if (st.enemy.y > 0 && st.enemy.airPlan) seen[id] = true
      return {}
    })
  }
  for (const id of ["buchu", "star", "pole", "feedle", "fan", "sword"]) assert.ok(seen[id], `${id} used its special`)
})

test("an idle player loses a life to every opponent", () => {
  for (let stage = 0; stage < Game.roster.length; stage++) {
    const s = fight(stage, 9)
    for (let t = 0; t < 40000 && s.mode === "fight"; t += frame) Game.step(s, {}, frame)
    assert.equal(s.mode, "down", `${Game.roster[stage].name} never finished it`)
    assert.equal(s.player.energy, 0, Game.roster[stage].name)
  }
})

test("the AI reads attacks: ducks high, jumps low, backs off mid", () => {
  for (const [move, check] of [["punch", e => e.duckFor > 0], ["sweep", e => e.y > 0], ["kick", e => e.retreatFor > 0]]) {
    const s = fight(10)
    s.enemy.profile = { ...s.enemy.profile, skill: 1 }
    s.enemy.x = s.player.x + 30
    Game.startAction(s.player, move)
    const intent = Game.aiIntent(s, s.enemy, s.player, frame)
    Game.updateFighter(s, s.enemy, intent, frame, s.player)
    assert.ok(check(s.enemy), move)
  }
})

test("winning a stage pays the energy bonus, perfect adds 5000", () => {
  const s = passive(fight(0))
  s.enemy.energy = 1
  s.enemy.x = s.player.x + 20
  activate(s.player, "punch")
  Game.step(s, {}, frame)
  assert.equal(s.mode, "ko")
  assert.equal(s.player.won, true)
  assert.equal(Game.banner(s), "K.O.")
  run(s, Game.timings.ko, {})
  assert.equal(s.mode, "clear")
  assert.equal(s.perfect, true)
  assert.equal(s.bonus, Game.maxEnergy * 1000 + 5000)
  assert.equal(Game.banner(s), "PERFECT!")
  run(s, Game.timings.clear, {})
  assert.equal(s.mode, "intro")
  assert.equal(s.stage, 1)
  assert.equal(Game.opponent(s).name, "STAR")
})

test("a stage won hurt shows the bonus", () => {
  const s = fight(0)
  s.player.energy = 3
  s.enemy.energy = 0
  s.enemy.ko = true
  s.mode = "ko"
  run(s, Game.timings.ko, {})
  assert.equal(s.bonus, 3000)
  assert.equal(Game.banner(s), "BONUS 3000")
})

test("beating Blues makes you Grand Master and the tournament starts again, faster", () => {
  const s = fight(Game.roster.length - 1)
  s.enemy.ko = true
  s.mode = "clear"
  s.modeT = 0
  run(s, Game.timings.clear, {})
  assert.equal(s.mode, "champion")
  assert.equal(Game.banner(s), "GRAND MASTER")
  run(s, Game.timings.champion, {})
  assert.equal(s.mode, "intro")
  assert.equal(s.stage, 0)
  assert.equal(s.loop, 1)
  assert.ok(s.enemy.profile.speed > Game.roster[0].speed)
  assert.equal(Game.scaled(Game.roster[0], 20).skill, 0.8)
})

test("losing costs a life, then a continue, then the game", () => {
  const s = fight(2)
  s.player.energy = 1
  s.enemy.x = s.player.x + 20
  activate(s.enemy, "kick")
  Game.step(s, {}, frame)
  assert.equal(s.mode, "down")
  assert.equal(s.enemy.won, true)
  run(s, Game.timings.down, {})
  assert.equal(s.lives, Game.startLives - 1)
  assert.equal(s.mode, "intro")
  assert.equal(s.stage, 2, "same opponent again")

  s.lives = 1
  s.mode = "down"
  s.modeT = 0
  run(s, Game.timings.down, {})
  assert.equal(s.mode, "continue")
  assert.equal(Game.banner(s), "CONTINUE? 9")
  run(s, 3000, {})
  assert.equal(Game.continueCount(s), 6)

  s.score = 5000
  Game.step(s, { start: true }, frame)
  assert.equal(s.mode, "intro")
  assert.equal(s.credits, Game.startCredits - 1)
  assert.equal(s.score, 0)
  assert.equal(s.lives, Game.startLives)

  s.mode = "continue"
  s.modeT = 0
  run(s, 10100, {})
  assert.equal(s.mode, "gameover")
  assert.equal(Game.banner(s), "GAME OVER")
  run(s, Game.timings.gameover, {})
  assert.equal(s.mode, "title")
  assert.equal(s.demo, true)
})

test("no credits left means no continue", () => {
  const s = fight(0)
  s.credits = 0
  s.mode = "continue"
  s.modeT = 0
  Game.step(s, { start: true }, frame)
  assert.equal(s.mode, "continue")
})

test("P pauses and resumes", () => {
  const s = fight(0)
  Game.step(s, { pause: true }, frame)
  assert.equal(s.mode, "pause")
  assert.equal(Game.banner(s), "PAUSE")
  const x = s.enemy.x
  run(s, 500, {})
  assert.equal(s.enemy.x, x)
  Game.step(s, { pause: true }, frame)
  assert.equal(s.mode, "fight")
  Game.step(s, { pause: true }, frame)
  Game.step(s, { start: true }, frame)
  assert.equal(s.mode, "fight")
})

test("the hi score keeps the best, and the banner is quiet mid-fight", () => {
  const s = Game.newGame(1, 9000)
  Game.startGame(s)
  passive(s)
  s.mode = "fight"
  assert.equal(Game.banner(s), "")
  assert.equal(s.hiScore, 9000)
  s.enemy.x = s.player.x + 20
  activate(s.player, "punch")
  Game.step(s, {}, frame)
  assert.equal(s.hiScore, 9000)
  assert.equal(Game.pad(1234, 6), "001234")
  assert.equal(Game.pad(-5, 3), "000")
})

test("every pose draws with finite coordinates for every fighter", () => {
  for (const profile of [Game.lee, ...Game.roster]) {
    for (const pose of Object.keys(Game.poses)) {
      const f = Game.newFighter(profile, 120, profile === Game.lee ? 1 : -1, profile === Game.lee)
      if (Game.moves[pose]) Game.startAction(f, pose)
      else if (pose === "crouch") f.crouch = true
      else if (pose === "jump") f.y = 20
      else if (pose === "hit") f.hitstun = 100
      else if (pose === "down") f.ko = true
      else if (pose === "win") f.won = true
      else if (pose.startsWith("walk")) {
        f.vx = 0.07
        f.walkT = pose === "walk1" ? 0 : 140
      }
      const fig = Game.figure(f, true)
      assert.equal(fig.pose, pose, `${profile.id} ${pose}`)
      for (const part of [...fig.parts, ...fig.weapon]) {
        for (const v of [part.from.x, part.from.y, part.to.x, part.to.y]) assert.ok(Number.isFinite(v), `${profile.id} ${pose}`)
      }
      assert.ok(Number.isFinite(fig.head.x) && Number.isFinite(fig.head.y))
      Game.figure(f, false)
    }
  }
})

test("standing feet touch the floor", () => {
  const fig = Game.figure(Game.newFighter(Game.lee, 100, 1, true), false)
  const lowest = Math.max(...fig.parts.map(p => Math.max(p.from.y, p.to.y)))
  assert.ok(Math.abs(lowest - Game.floorY) < 0.5)
})

test("the roster and trivia are in order", () => {
  assert.deepEqual(Game.roster.map(r => r.name), ["BUCHU", "STAR", "NUNCHA", "POLE", "FEEDLE", "CHAIN", "CLUB", "FAN", "SWORD", "TONFUN", "BLUES"])
  assert.deepEqual(Game.roster.map(r => r.level), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
  assert.ok(Game.trivia.length >= 8)
  const s = Game.newGame(1, 0)
  Game.setupFight(s, 7, false)
  assert.equal(Game.stageLevel(s), 2)
  assert.equal(Game.playerIntent(null).move, 0)
})
