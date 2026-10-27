const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

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
  state.events = []
  return state
}

// An opponent that stands still, for tests about the player's side.
function passive(state) {
  state.enemy.profile = { ...state.enemy.profile, skill: 0, aggression: 0, special: "" }
  return state
}

// Two fighters facing each other at a set gap, for the hit rules.
function duel(gap, enemyStage = 0) {
  const p = Game.newFighter(Game.lee, 100, 1, true)
  const e = Game.newFighter(Game.roster[enemyStage], 100 + gap, -1, false)
  const state = { clock: 0, sparks: [], projectiles: [], events: [], clones: [], score: 0, hiScore: 0, demo: false, seed: 1, player: p, enemy: e }
  return { state, p, e }
}

function activate(state, f, name) {
  Game.startAction(state, f, name)
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

test("sixteen attacks: eight directions, each with punch and kick", () => {
  assert.equal(Game.punches.length, 8)
  assert.equal(Game.kicks.length, 8)
  const seen = new Set()
  for (const button of ["punch", "kick"]) {
    for (const dir of ["u", "uf", "f", "df", "d", "db", "b", "ub"]) {
      const name = Game.moveFor(button, dir)
      assert.ok(name, `${button} ${dir}`)
      assert.equal(Game.moves[name].button, button)
      seen.add(name)
    }
  }
  assert.equal(seen.size, 16)
  assert.equal(Game.moveFor("punch", ""), "")
})

test("relativeDir reads the stick the way the fighter faces", () => {
  assert.equal(Game.relativeDir({ right: true }, 1), "f")
  assert.equal(Game.relativeDir({ right: true }, -1), "b")
  assert.equal(Game.relativeDir({ up: true, left: true }, -1), "uf")
  assert.equal(Game.relativeDir({ down: true, left: true }, 1), "db")
  assert.equal(Game.relativeDir({ down: true }, 1), "d")
  assert.equal(Game.relativeDir({}, 1), "")
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

test("the demo plays itself silently and without scoring, then Enter starts stage 1", () => {
  const s = run(Game.newGame(42, 0), 40000, {})
  assert.equal(s.score, 0)
  assert.deepEqual(Game.takeEvents(s), [])
  assert.ok(s.demoStage > 0, "the demo moved on to another opponent")
  Game.step(s, { start: true }, frame)
  assert.equal(s.mode, "intro")
  assert.equal(s.stage, 0)
  assert.equal(s.demo, false)
  assert.deepEqual(Game.takeEvents(s), ["start"], "the start jingle, without the stage one over it")
  assert.equal(Game.banner(s), "STAGE 1")
  run(s, Game.timings.intro - 400, {})
  assert.equal(Game.banner(s), "FIGHT!")
  run(s, 400, {})
  assert.equal(s.mode, "fight")
  assert.ok(Game.takeEvents(s).includes("fight"))
})

test("attack levels: a crouch ducks high, a jump clears low, the floor only fears low", () => {
  const table = {
    high: { stand: true, crouch: false, air: true, floor: false },
    mid: { stand: true, crouch: true, air: true, floor: false },
    low: { stand: true, crouch: true, air: false, floor: true },
    up: { stand: true, crouch: false, air: true, floor: false },
    none: { stand: false, crouch: false, air: false, floor: false }
  }
  for (const [level, row] of Object.entries(table)) {
    for (const [st, hits] of Object.entries(row)) assert.equal(Game.levelHits(level, st), hits, `${level} vs ${st}`)
  }
})

test("each hit takes one of ten hit points, scores and staggers", () => {
  const { state, p, e } = duel(24)
  assert.equal(e.energy, 10)
  activate(state, p, "lungePunch")
  Game.resolveHit(state, p, e)
  assert.equal(e.energy, 9)
  assert.ok(e.hitstun > 0)
  assert.equal(state.score, 100)
  assert.equal(state.hiScore, 100)
  assert.deepEqual(state.events, ["swing", "hit"])
  Game.resolveHit(state, p, e)
  assert.equal(e.energy, 9, "one hit per attack")
})

test("misses: out of reach, ducked, jumped, on the floor, still winding up", () => {
  let d = duel(40)
  activate(d.state, d.p, "highPunch")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, 10)

  d = duel(20)
  d.e.crouch = true
  activate(d.state, d.p, "highPunch")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, 10)

  d = duel(20)
  d.e.y = 20
  activate(d.state, d.p, "sweep")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, 10)

  d = duel(20)
  activate(d.state, d.e, "splitPunch")
  activate(d.state, d.p, "sideKick")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, 10, "a split dodges the middle")

  d = duel(20)
  Game.startAction(d.state, d.p, "sideKick")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, 10)
})

test("rising attacks meet a jumper", () => {
  const d = duel(18)
  d.e.y = 30
  activate(d.state, d.p, "risingKick")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, 9)
  assert.equal(d.state.score, 500)
})

test("weapons add reach: Pole hits from where Lee can't", () => {
  const d = duel(40, 3)
  activate(d.state, d.e, "sideKick")
  Game.resolveHit(d.state, d.e, d.p)
  assert.equal(d.p.energy, 9)
  assert.equal(d.state.score, 0, "the opponent doesn't score for you")
})

test("Club's shield turns a middle kick from the front, not a high punch", () => {
  const d = duel(20, 6)
  activate(d.state, d.p, "sideKick")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, 10)
  assert.equal(d.state.sparks[0].kind, "block")
  assert.ok(d.state.events.includes("block"))
  activate(d.state, d.p, "highPunch")
  Game.resolveHit(d.state, d.p, d.e)
  assert.equal(d.e.energy, 9)
})

test("Club hits harder: more knockback, still one hit point", () => {
  const d = duel(20, 6)
  activate(d.state, d.e, "highPunch")
  Game.resolveHit(d.state, d.e, d.p)
  assert.equal(d.p.energy, 9)
  assert.equal(Math.abs(d.p.kb), 0.18)
})

test("the last hit knocks out and the body falls", () => {
  const { state, p, e } = duel(20)
  e.energy = 1
  activate(state, p, "lungePunch")
  Game.resolveHit(state, p, e)
  assert.equal(e.ko, true)
  assert.ok(state.events.includes("ko"))
  assert.equal(Game.poseOf(e), "hit")
  for (let i = 0; i < 60; i++) Game.updateFighter(state, e, {}, frame, p)
  assert.equal(e.y, 0)
  assert.equal(Game.poseOf(e), "down")
})

test("player controls: a button picks its attack from the stick", () => {
  const s = passive(fight())
  const p = s.player
  run(s, 200, { right: true })
  assert.ok(p.x > 70)
  assert.equal(Game.poseOf(p).startsWith("walk"), true)

  const cases = [
    [{ kick: true, down: true, right: true }, "sweep"],
    [{ kick: true, down: true }, "lowKick"],
    [{ punch: true, down: true, left: true }, "splitPunch"],
    [{ kick: true, down: true, left: true }, "groundKick"],
    [{ punch: true, left: true }, "highPunch"],
    [{ kick: true, left: true }, "highKick"],
    [{ punch: true }, "lungePunch"],
    [{ kick: true }, "sideKick"]
  ]
  for (const [input, name] of cases) {
    Game.step(s, input, frame)
    assert.equal(p.action && p.action.move.name, name)
    run(s, 900, {})
  }

  // Holding the button, then pressing a direction, works too.
  Game.step(s, { punchHeld: true }, frame)
  assert.equal(p.action, null, "a held button waits for a direction")
  Game.step(s, { punchHeld: true, up: true, left: true, dirPressed: true }, frame)
  assert.equal(p.action.move.name, "risingPunch")
})

test("jump attacks start with the jump, or in its first moments", () => {
  const s = passive(fight())
  const p = s.player
  Game.step(s, { kickHeld: true, up: true, dirPressed: true }, frame)
  assert.equal(p.action.move.name, "flyingKick")
  assert.ok(p.y > 0)
  run(s, 1000, {})
  assert.equal(p.y, 0)
  assert.equal(p.action, null, "air attacks end on landing")

  Game.step(s, { up: true, right: true }, frame)
  Game.step(s, { punch: true, up: true }, frame)
  assert.equal(p.action.move.name, "divePunch", "a jump towards the foe dives")
  run(s, 1000, {})

  Game.step(s, { up: true }, frame)
  Game.step(s, { kick: true }, frame)
  assert.equal(p.action.move.name, "flyingKick")
  run(s, 1000, {})

  Game.step(s, { up: true }, frame)
  run(s, Game.jumpAttackWindow + 50, {})
  Game.step(s, { punch: true }, frame)
  assert.equal(p.action, null, "too late in the jump")
})

test("a jump lasts about 900 ms and only drifts towards the middle", () => {
  const s = passive(fight())
  const p = s.player
  Game.step(s, { up: true, right: true }, frame)
  let t = frame
  while (p.y > 0 && t < 2000) {
    Game.step(s, {}, frame)
    t += frame
  }
  assert.ok(t > 820 && t < 980, `landed after ${t} ms`)
  assert.ok(p.x > 150, "a diagonal jump carries far")

  const q = passive(fight())
  q.player.x = 40
  Game.step(q, { up: true, left: true }, frame)
  assert.equal(q.player.vx, 0, "no jumping towards the wall")
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
  Game.startAction(s, s.enemy, "throw")
  run(s, 300, {})
  assert.equal(s.projectiles.length, 1)
  assert.ok(s.events.includes("throw"))
  const pr = s.projectiles[0]
  assert.equal(pr.kind, "shuriken")
  assert.ok(["high", "mid", "low"].includes(pr.level))

  pr.level = "mid"
  pr.x = s.player.x + 20
  pr.vx = -0.15
  activate(s, s.player, "sideKick")
  const before = s.score
  Game.updateProjectiles(s, frame)
  assert.equal(s.projectiles.length, 0)
  assert.equal(s.score, before + 500)
  assert.ok(s.events.includes("swat"))

  s.player.action = null
  s.projectiles.push({ x: s.player.x + 2, level: "mid", vx: -0.15, kind: "shuriken", fromPlayer: false, spin: 0 })
  Game.updateProjectiles(s, frame)
  assert.equal(s.player.energy, 9)

  s.player.hitstun = 0
  s.player.crouch = true
  s.projectiles.push({ x: s.player.x + 2, level: "high", vx: -0.15, kind: "fan", fromPlayer: false, spin: 0 })
  Game.updateProjectiles(s, frame)
  assert.equal(s.projectiles.length, 1, "ducked")
  for (let i = 0; i < 200; i++) Game.updateProjectiles(s, frame)
  assert.equal(s.projectiles.length, 0)
})

test("Sword reappears on your far side", () => {
  const s = fight(8)
  s.enemy.x = 150
  s.player.x = 100
  assert.equal(Game.teleport(s, s.enemy, s.player), true)
  assert.equal(s.enemy.x, 66)
  assert.equal(s.enemy.facing, 1)
  assert.ok(s.events.includes("warp"))

  s.player.x = Game.stageLeft + 4
  s.enemy.x = 60
  assert.equal(Game.teleport(s, s.enemy, s.player), false, "no room behind")
})

test("Feedle's doubles come from the other side and cost him a hit point each", () => {
  const s = passive(fight(4))
  s.enemy.profile = { ...s.enemy.profile, special: "swarm" }
  s.player.x = 100
  s.enemy.x = 160
  Game.updateSwarm(s, 2000)
  assert.equal(s.clones.length, 1)
  const clone = s.clones[0]
  assert.equal(clone.x, Game.stageLeft, "behind the player")
  assert.equal(clone.clone, true)
  assert.equal(Game.nearestFoe(s), s.enemy)

  clone.x = 80
  assert.equal(Game.nearestFoe(s), clone)
  s.player.facing = -1
  activate(s, s.player, "lungePunch")
  Game.resolveHit(s, s.player, clone)
  assert.equal(clone.gone, true)
  assert.equal(s.enemy.energy, 9)

  // No more doubles than he has hit points to spare.
  s.enemy.energy = 1
  s.clones = []
  s.swarmT = 0
  Game.updateSwarm(s, frame)
  assert.equal(s.clones.length, 0)

  // The last hit point lost to a double knocks him out.
  s.enemy.energy = 1
  const last = Game.newFighter(s.enemy.profile, 80, 1, false)
  last.clone = true
  last.energy = 1
  s.clones = [last]
  s.player.action = null
  activate(s, s.player, "lungePunch")
  Game.resolveHit(s, s.player, last)
  assert.equal(s.enemy.ko, true)
})

test("each opponent's trick fires in a real bout", () => {
  const seen = {}
  for (let stage = 0; stage < Game.roster.length; stage++) {
    const s = fight(stage, 100 + stage)
    const id = Game.roster[stage].id
    run(s, 25000, (st) => {
      const a = st.enemy.action
      if (a && ["lunge", "throw"].includes(a.move.name)) seen[id] = true
      if (a && a.move.name === "jumpKick" && id === "pole") seen[id] = true
      if (st.sparks.some(k => k.kind === "warp")) seen[id] = true
      if (st.clones.length > 0) seen[id] = true
      return {}
    })
  }
  for (const id of ["buchu", "star", "pole", "feedle", "fan", "sword"]) assert.ok(seen[id], `${id} used its trick`)
})

test("Blues answers your move with the same one", () => {
  const s = fight(10)
  s.enemy.profile = { ...s.enemy.profile }
  s.seed = 3
  let mirrored = 0
  for (let i = 0; i < 40; i++) {
    s.player.x = 100
    s.enemy.x = 124
    s.enemy.action = null
    s.enemy.hitstun = 0
    s.enemy.seen = null
    Game.startAction(s, s.player, "sideKick")
    const intent = Game.aiIntent(s, s.enemy, s.player, frame)
    if (intent.attack === "sideKick") mirrored++
  }
  assert.ok(mirrored > 5, `mirrored ${mirrored} of 40`)
})

test("an idle player loses a life to every opponent", () => {
  for (let stage = 0; stage < Game.roster.length; stage++) {
    const s = fight(stage, 9)
    for (let t = 0; t < 60000 && s.mode === "fight"; t += frame) Game.step(s, {}, frame)
    assert.equal(s.mode, "down", `${Game.roster[stage].name} never finished it`)
    assert.equal(s.player.energy, 0, Game.roster[stage].name)
  }
})

test("the AI reads attacks: ducks high, jumps low, backs off mid, kicks up at jumpers", () => {
  for (const [move, check] of [["highPunch", e => e.duckFor > 0], ["sweep", e => e.y > 0], ["sideKick", e => e.retreatFor > 0]]) {
    const s = fight(9)
    s.enemy.profile = { ...s.enemy.profile, skill: 1 }
    s.enemy.x = s.player.x + 30
    Game.startAction(s, s.player, move)
    const intent = Game.aiIntent(s, s.enemy, s.player, frame)
    Game.updateFighter(s, s.enemy, intent, frame, s.player)
    assert.ok(check(s.enemy), move)
  }
  const s = fight(9)
  s.enemy.profile = { ...s.enemy.profile, skill: 1, attacks: ["risingKick"] }
  s.enemy.cooldown = 0
  s.player.y = 30
  s.enemy.x = s.player.x + 20
  assert.equal(Game.aiIntent(s, s.enemy, s.player, frame).attack, "risingKick")
})

test("winning a stage pays the energy bonus, perfect adds 5000", () => {
  const s = passive(fight(0))
  s.enemy.energy = 1
  s.enemy.x = s.player.x + 20
  activate(s, s.player, "lungePunch")
  Game.step(s, {}, frame)
  assert.equal(s.mode, "ko")
  assert.equal(s.player.won, true)
  assert.equal(Game.banner(s), "K.O.")
  run(s, Game.timings.ko, {})
  assert.equal(s.mode, "clear")
  assert.equal(s.perfect, true)
  assert.equal(s.bonus, Game.maxEnergy * 1000 + 5000)
  assert.equal(Game.banner(s), "PERFECT!")
  assert.ok(s.events.includes("perfect"))
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
  assert.ok(s.events.includes("bonus"))
})

test("beating Blues makes you Grand Master and the tournament starts again, faster", () => {
  const s = fight(Game.roster.length - 1)
  s.enemy.ko = true
  s.mode = "clear"
  s.modeT = 0
  run(s, Game.timings.clear, {})
  assert.equal(s.mode, "champion")
  assert.equal(Game.banner(s), "GRAND MASTER")
  assert.ok(s.events.includes("champion"))
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
  activate(s, s.enemy, "sideKick")
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
  s.events = []
  Game.step(s, { start: true }, frame)
  assert.equal(s.mode, "intro")
  assert.equal(s.credits, Game.startCredits - 1)
  assert.equal(s.score, 0)
  assert.equal(s.lives, Game.startLives)
  assert.deepEqual(s.events, ["start"])

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
  activate(s, s.player, "lungePunch")
  Game.step(s, {}, frame)
  assert.equal(s.hiScore, 9000)
  assert.equal(Game.pad(1234, 6), "001234")
  assert.equal(Game.pad(-5, 3), "000")
})

test("every pose draws with finite coordinates for every fighter", () => {
  for (const profile of [Game.lee, ...Game.roster]) {
    for (const pose of Object.keys(Game.poses)) {
      const f = Game.newFighter(profile, 120, profile === Game.lee ? 1 : -1, profile === Game.lee)
      const s = { events: [], demo: false }
      if (Game.moves[pose]) {
        Game.startAction(s, f, pose)
        if (Game.moves[pose].stance === "air") f.y = 20
        else {
          f.y = 0
          f.vy = 0
        }
      } else if (pose === "crouch") f.crouch = true
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

test("standing feet touch the floor, and floor moves lie on it", () => {
  const lowest = fig => Math.max(...fig.parts.map(p => Math.max(p.from.y, p.to.y)))
  const stand = Game.figure(Game.newFighter(Game.lee, 100, 1, true), false)
  assert.ok(Math.abs(lowest(stand) - Game.floorY) < 3)
  const f = Game.newFighter(Game.lee, 100, 1, true)
  Game.startAction({ events: [], demo: false }, f, "splitPunch")
  const split = Game.figure(f, false)
  assert.ok(split.head.y > stand.head.y + 15, "the split is low")
})

test("every sound cue has a file", () => {
  const cues = new Set(["coin"])
  const s = fight(1)
  s.demo = false
  run(s, 30000, (st, t) => ({ punch: t % 400 === 0, up: t % 1300 === 0 }))
  for (const e of s.events) cues.add(e)
  for (const e of ["start", "stage", "fight", "bonus", "perfect", "champion", "gameover", "ko", "block", "swat", "warp", "throw", "swing", "hit", "jump"]) cues.add(e)
  for (const cue of cues) assert.ok(fs.existsSync(path.join(__dirname, "..", "sounds", cue + ".wav")), cue)
})

test("the roster and trivia are in order", () => {
  assert.deepEqual(Game.roster.map(r => r.name), ["BUCHU", "STAR", "NUNCHA", "POLE", "FEEDLE", "CHAIN", "CLUB", "FAN", "SWORD", "TONFUN", "BLUES"])
  assert.deepEqual(Game.roster.map(r => r.level), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
  assert.ok(Game.trivia.length >= 10)
  const s = Game.newGame(1, 0)
  Game.setupFight(s, 7, false)
  assert.equal(Game.stageLevel(s), 2)
  assert.equal(Game.playerIntent(null, 1).move, 0)
})
