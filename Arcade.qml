import QtQuick
import Quickshell
import qs.Commons
import "Arcade.js" as Game

// The Yie Ar Kung-Fu easter egg's screen. Arcade.js plays the game; this
// takes the keys, runs the clock, plays the sound and draws each frame as
// chunky outlined pixels.
Item {
  id: arcade

  property string fontFamily: Style.font.family
  property color foreground: Color.foreground
  property color dim: Qt.darker(foreground, 1.4)
  property color accent: Color.accent
  property real hiScore: 0
  property bool muted: false
  property bool running: true

  signal exitRequested()
  signal hiScoreReached(real score)
  signal mutedToggled(bool muted)

  // Made once on load, not bound: a binding on hiScore would restart the
  // game every time the high score moved.
  property var game: null
  property var held: ({ left: false, right: false, up: false, down: false, punch: false, kick: false })
  property var queued: ({ punch: false, kick: false, start: false, pause: false, dir: false })
  property var lastSound: ({})
  property real lastTick: 0
  property int triviaIndex: 0

  readonly property string ink: "#0b0b12"

  implicitHeight: screen.height + legend.implicitHeight + Style.space(12)
  focus: true

  Component.onCompleted: {
    game = Game.newGame(Math.floor(Math.random() * 2147483647), hiScore)
    triviaIndex = Math.floor(Math.random() * Game.trivia.length)
    // Later, so the panel has handed over the mute setting first.
    Qt.callLater(function() { arcade.play("coin") })
  }

  onRunningChanged: lastTick = 0

  component Line: Text {
    textFormat: Text.PlainText
    width: parent ? parent.width : 0
    horizontalAlignment: Text.AlignHCenter
    wrapMode: Text.WordWrap
    color: arcade.dim
    font.family: arcade.fontFamily
    font.pixelSize: Style.font.caption
  }

  // ---------- sound ----------

  Loader {
    id: sounds
    source: Qt.resolvedUrl("Sounds.qml")
  }

  // Without Qt Multimedia, PipeWire's player stands in, a little behind.
  function play(name) {
    if (muted) return
    if (sounds.status === Loader.Ready) {
      sounds.item.play(name)
      return
    }
    if (sounds.status !== Loader.Error) return
    var now = Date.now()
    if (now - (lastSound[name] || 0) < 60) return
    lastSound[name] = now
    var file = decodeURIComponent(String(Qt.resolvedUrl("sounds/" + name + ".wav")).replace(/^file:\/\//, ""))
    Quickshell.execDetached(["pw-play", "--volume", "0.4", file])
  }

  // ---------- keys ----------

  function keyName(event) {
    var t = String(event.text || "").toLowerCase()
    if (event.key === Qt.Key_Escape) return "exit"
    if (event.key === Qt.Key_Left || t === "h") return "left"
    if (event.key === Qt.Key_Right || t === "l") return "right"
    if (event.key === Qt.Key_Up || t === "k") return "up"
    if (event.key === Qt.Key_Down || t === "j") return "down"
    if (t === "z") return "punch"
    if (t === "x") return "kick"
    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) return "start"
    if (t === "p") return "pause"
    if (t === "m") return "mute"
    return ""
  }

  // The arcade owns the keyboard while it's up, Tab included.
  Keys.priority: Keys.BeforeItem
  Keys.onPressed: function(event) {
    event.accepted = true
    var k = keyName(event)
    if (k === "exit") {
      arcade.exitRequested()
      return
    }
    if (event.isAutoRepeat || k === "") return
    if (k === "mute") {
      muted = !muted
      mutedToggled(muted)
      return
    }
    if (k in held) held[k] = true
    if (k === "left" || k === "right" || k === "up" || k === "down") queued.dir = true
    else queued[k] = true
  }
  Keys.onReleased: function(event) {
    event.accepted = true
    if (event.isAutoRepeat) return
    var k = keyName(event)
    if (k in held) held[k] = false
  }

  function tick() {
    if (!game) return
    var now = Date.now()
    var dt = lastTick > 0 ? now - lastTick : 16
    lastTick = now
    var input = {
      left: held.left, right: held.right, up: held.up, down: held.down,
      punchHeld: held.punch, kickHeld: held.kick,
      punch: queued.punch, kick: queued.kick, start: queued.start, pause: queued.pause, dirPressed: queued.dir
    }
    queued = { punch: false, kick: false, start: false, pause: false, dir: false }
    Game.step(game, input, dt)
    var cues = Game.takeEvents(game)
    for (var i = 0; i < cues.length; i++) if (cues.indexOf(cues[i]) === i) play(cues[i])
    if (game.hiScore > hiScore) hiScoreReached(game.hiScore)
    screen.requestPaint()
  }

  Timer {
    interval: 16
    repeat: true
    running: arcade.running && arcade.visible
    onTriggered: arcade.tick()
  }

  Timer {
    interval: 7000
    repeat: true
    running: arcade.running && arcade.visible
    onTriggered: arcade.triviaIndex = (arcade.triviaIndex + 1) % Game.trivia.length
  }

  // ---------- drawing ----------

  function font(size, bold) {
    return (bold ? "bold " : "") + size + "px \"" + fontFamily + "\""
  }

  function px(ctx, x, y, w) {
    var h = w / 2
    ctx.fillRect(Math.round(x - h), Math.round(y - h), w, w)
  }

  // A limb is a run of square brush stamps, snapped to the pixel grid.
  function stroke(ctx, a, b, w, color) {
    ctx.fillStyle = color
    var n = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))))
    for (var i = 0; i <= n; i++) px(ctx, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n, w)
  }

  // Rows overlap a little: at the panel's fractional scale, rows that only
  // touched left faint seams between them. part: "all", "top" or "back".
  function disc(ctx, cx, cy, r, color, part, facing) {
    ctx.fillStyle = color
    var R = Math.round(r)
    var last = part === "top" ? -1 : R
    for (var dy = -R; dy <= last; dy++) {
      var half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)))
      var x0 = Math.round(cx) - half
      var w = half * 2 + 1
      if (part === "back") {
        w = half + 1
        if (facing > 0) x0 = Math.round(cx) - half
        else x0 = Math.round(cx)
      }
      ctx.fillRect(x0, Math.round(cy) + dy, w, dy < last ? 1.5 : 1)
    }
  }

  function text(ctx, value, x, y, size, color, align, shadow) {
    ctx.font = font(size, true)
    ctx.textAlign = align || "left"
    ctx.textBaseline = "middle"
    if (shadow) {
      ctx.fillStyle = shadow
      ctx.fillText(value, x + Math.max(1, size / 10), y + Math.max(1, size / 10))
    }
    ctx.fillStyle = color
    ctx.fillText(value, x, y)
  }

  // Level 1: a cave with a waterfall falling behind the fight.
  function drawCave(ctx) {
    var t = game.clock
    ctx.fillStyle = "#120d0a"
    ctx.fillRect(0, 0, Game.worldWidth, Game.worldHeight)
    var rocks = [[0, 40, 46, 124, "#1d1511"], [40, 64, 34, 100, "#231914"], [96, 52, 44, 112, "#1f1612"], [184, 46, 56, 118, "#211813"]]
    rocks.forEach(function(r) {
      ctx.fillStyle = r[4]
      ctx.fillRect(r[0], r[1], r[2], r[3])
      ctx.fillStyle = "#2f231c"
      ctx.fillRect(r[0], r[1], r[2], 2)
    })
    // The fall, its streaks scrolling down.
    ctx.fillStyle = "#1f4f74"
    ctx.fillRect(146, 26, 34, Game.floorY - 26)
    for (var x = 146; x < 180; x += 2) {
      var off = (t * 0.07 + x * 13) % 16
      for (var y = 26 + off - 16; y < Game.floorY; y += 16) {
        ctx.fillStyle = (x / 2) % 3 === 0 ? "#d6ecff" : "#7fb3dd"
        ctx.fillRect(x, Math.max(26, y), 1, 6)
      }
    }
    ctx.fillStyle = "#0f0b09"
    ctx.fillRect(140, 26, 6, Game.floorY - 26)
    ctx.fillRect(180, 26, 6, Game.floorY - 26)
    for (var i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#e4f2ff" : "#a9cfee"
      ctx.fillRect(144 + i * 2.4, Game.floorY - 2 - ((Math.floor(t / 90) + i * 7) % 5), 2, 2)
    }
    ctx.fillStyle = "#2c2019"
    var drips = [[20, 14], [44, 9], [80, 18], [112, 11], [204, 15], [226, 10]]
    drips.forEach(function(d) {
      for (var row = 0; row < d[1]; row++) {
        var half = Math.round((d[1] - row) / 3)
        ctx.fillRect(d[0] - half, 26 + row, half * 2 + 1, 1.5)
      }
    })
    ctx.fillStyle = "#2b211b"
    ctx.fillRect(0, Game.floorY, Game.worldWidth, Game.worldHeight - Game.floorY)
    ctx.fillStyle = "#4a3a30"
    ctx.fillRect(0, Game.floorY, Game.worldWidth, 1)
    ctx.fillStyle = "#3a2d25"
    var pebbles = [12, 37, 63, 98, 131, 190, 214, 233]
    pebbles.forEach(function(p, j) { ctx.fillRect(p, Game.floorY + 4 + (j % 3) * 2, 2, 1) })
  }

  // Level 2: a palace courtyard at night, lanterns swaying.
  function drawPalace(ctx) {
    var t = game.clock
    ctx.fillStyle = "#0d1630"
    ctx.fillRect(0, 0, Game.worldWidth, Game.worldHeight)
    ctx.fillStyle = "#9fb3d9"
    var stars = [[14, 48], [36, 60], [70, 44], [104, 70], [128, 50], [162, 64], [218, 56], [232, 72]]
    stars.forEach(function(s) { ctx.fillRect(s[0], s[1], 1, 1) })
    disc(ctx, 196, 52, 8, "#e9e4c9", "all")
    disc(ctx, 199, 50, 6, "#0d1630", "all")
    ctx.fillStyle = "#7a1c1c"
    ctx.fillRect(0, 30, Game.worldWidth, 7)
    ctx.fillStyle = "#5e1414"
    for (var x = 0; x < Game.worldWidth; x += 4) ctx.fillRect(x, 30, 1, 7)
    ctx.fillStyle = "#c9a227"
    ctx.fillRect(0, 37, Game.worldWidth, 2)
    ctx.fillRect(0, 27, 6, 3)
    ctx.fillRect(Game.worldWidth - 6, 27, 6, 3)
    var pillars = [30, 90, 150, 210]
    pillars.forEach(function(px0) {
      ctx.fillStyle = "#8f1d1d"
      ctx.fillRect(px0 - 4, 39, 8, Game.floorY - 39)
      ctx.fillStyle = "#b33a3a"
      ctx.fillRect(px0 - 4, 39, 2, Game.floorY - 39)
      ctx.fillStyle = "#c9a227"
      ctx.fillRect(px0 - 5, 39, 10, 2)
      ctx.fillRect(px0 - 5, Game.floorY - 3, 10, 3)
    })
    var lanterns = [60, 120, 180]
    lanterns.forEach(function(lx, i) {
      var sway = Math.round(Math.sin(t / 700 + i * 1.7))
      ctx.fillStyle = "#3a2a1a"
      ctx.fillRect(lx, 39, 1, 7)
      ctx.fillStyle = "#d62828"
      ctx.fillRect(lx - 3 + sway, 46, 7, 9)
      ctx.fillStyle = "#ffd166"
      ctx.fillRect(lx - 1 + sway, 48, 3, 5)
      ctx.fillStyle = "#c9a227"
      ctx.fillRect(lx - 2 + sway, 45, 5, 1)
      ctx.fillRect(lx - 2 + sway, 55, 5, 1)
    })
    ctx.fillStyle = "#4b3621"
    ctx.fillRect(0, Game.floorY, Game.worldWidth, Game.worldHeight - Game.floorY)
    ctx.fillStyle = "#5e4630"
    for (var gx = 0; gx < Game.worldWidth; gx += 16) ctx.fillRect(gx, Game.floorY, 1, Game.worldHeight - Game.floorY)
    ctx.fillRect(0, Game.floorY, Game.worldWidth, 1)
    ctx.fillRect(0, Game.floorY + 6, Game.worldWidth, 1)
  }

  function drawHead(ctx, h, facing, flash) {
    var skin = flash ? "#ffffff" : h.skin
    disc(ctx, h.x, h.y, h.r + 1, ink, "all")
    disc(ctx, h.x, h.y, h.r, skin, "all")
    var hair = flash ? "#ffffff" : h.hair
    if (h.style === "mask") {
      disc(ctx, h.x, h.y, h.r, hair, "all")
      ctx.fillStyle = h.skin
      ctx.fillRect(facing > 0 ? Math.round(h.x) : Math.round(h.x - h.r), Math.round(h.y) - 1, Math.round(h.r), 2)
      ctx.fillStyle = ink
      ctx.fillRect(Math.round(h.x + facing * 2), Math.round(h.y) - 1, 1, 1)
      return
    }
    if (h.style === "short" || h.style === "bun" || h.style === "long") {
      disc(ctx, h.x, h.y, h.r, hair, "top")
      disc(ctx, h.x, h.y, h.r, hair, "back", facing)
      ctx.fillStyle = skin
      ctx.fillRect(facing > 0 ? Math.round(h.x) + 1 : Math.round(h.x - h.r) + 1, Math.round(h.y) - 1, Math.round(h.r - 1), 3)
    }
    if (h.style === "bun") disc(ctx, h.x - facing * h.r, h.y - h.r * 0.6, 2, hair, "all")
    if (h.style === "long") {
      ctx.fillStyle = hair
      ctx.fillRect(Math.round(h.x - facing * h.r) - 1, Math.round(h.y), 3, Math.round(h.r * 2))
    }
    if (h.style === "topknot") {
      ctx.fillStyle = hair
      ctx.fillRect(Math.round(h.x - facing) - 1, Math.round(h.y - h.r) - 3, 3, 3)
      ctx.fillRect(Math.round(h.x - h.r), Math.round(h.y - h.r) + 1, Math.round(h.r * 2), 1)
    }
    ctx.fillStyle = ink
    ctx.fillRect(Math.round(h.x + facing * 2), Math.round(h.y), 1, 1)
  }

  function drawFighter(ctx, f) {
    var fig = Game.figure(f, Game.isActive(f))
    var k = f.profile.build || 1
    var flash = f.flash > 0 && Math.floor(game.clock / 50) % 2 === 0
    ctx.globalAlpha = f.clone ? 0.85 : 1
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)"
    ctx.fillRect(Math.round(f.x - 9 * k), Game.floorY, Math.round(18 * k), 2)
    // Outline then fill, part by part, so limbs stay readable over each
    // other like a hand-drawn sprite's.
    fig.parts.forEach(function(p) {
      stroke(ctx, p.from, p.to, p.w + 2, ink)
      stroke(ctx, p.from, p.to, p.w, flash ? "#ffffff" : p.color)
    })
    drawHead(ctx, fig.head, f.facing, flash)
    fig.weapon.forEach(function(p) {
      stroke(ctx, p.from, p.to, p.w + 2, ink)
      stroke(ctx, p.from, p.to, p.w, p.color)
    })
    ctx.globalAlpha = 1
  }

  function drawProjectiles(ctx) {
    game.projectiles.forEach(function(pr) {
      var y = Game.floorY - Game.levelHeight[pr.level]
      var turn = pr.spin / 60
      var color = pr.kind === "fan" ? "#f2c14e" : "#cfd6de"
      for (var i = 0; i < 4; i++) {
        var a = turn + i * Math.PI / 2
        var tip = { x: pr.x + Math.cos(a) * 4, y: y + Math.sin(a) * 4 }
        stroke(ctx, { x: pr.x, y: y }, tip, pr.kind === "fan" ? 4 : 3, ink)
        stroke(ctx, { x: pr.x, y: y }, tip, pr.kind === "fan" ? 2 : 1, color)
      }
      ctx.fillStyle = "#6c757d"
      px(ctx, pr.x, y, 2)
    })
  }

  function drawSparks(ctx) {
    game.sparks.forEach(function(s) {
      var t = (game.clock - s.at) / 260
      if (s.kind === "warp") {
        var r = 4 + t * 10
        for (var i = 0; i < 8; i++) {
          ctx.fillStyle = "#c77dff"
          px(ctx, s.x + Math.cos(i * Math.PI / 4) * r, s.y + Math.sin(i * Math.PI / 4) * r, 2)
        }
        return
      }
      var size = s.kind === "block" ? 4 : 6 + t * 4
      var color = s.kind === "block" ? "#9ad1ff" : (t < 0.5 ? "#fff3b0" : "#ffb703")
      for (var j = 0; j < 4; j++) {
        var a = Math.PI / 4 + j * Math.PI / 2
        stroke(ctx, { x: s.x, y: s.y }, { x: s.x + Math.cos(a) * size, y: s.y + Math.sin(a) * size }, 2, color)
      }
    })
  }

  function drawEnergy(ctx, x, energy, rightToLeft) {
    for (var i = 0; i < Game.maxEnergy; i++) {
      var on = rightToLeft ? i >= Game.maxEnergy - energy : i < energy
      ctx.fillStyle = on ? (energy <= 3 ? "#ff4d4d" : "#ffd23f") : "#3a3a3a"
      ctx.fillRect(x + i * 6, 17, 5, 6)
    }
  }

  function drawHud(ctx) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)"
    ctx.fillRect(0, 0, Game.worldWidth, 26)
    var demo = game.mode === "title"
    text(ctx, "1P " + Game.pad(demo ? 0 : game.score, 6), 5, 8, 7, "#ffffff", "left")
    text(ctx, "HI " + Game.pad(game.hiScore, 6), 235, 8, 7, "#ffffff", "right")
    text(ctx, demo ? "DEMO" : "STAGE " + (game.stage + 1), 120, 8, 7, "#ffd23f", "center")
    var name = Game.opponent(game).name
    text(ctx, "LEE", 5, 20, 7, "#ffffff", "left")
    var leeEnd = 5 + ctx.measureText("LEE").width + 4
    drawEnergy(ctx, leeEnd, game.player.energy, false)
    text(ctx, name, 235, 20, 7, "#ffffff", "right")
    drawEnergy(ctx, 235 - ctx.measureText(name).width - 4 - Game.maxEnergy * 6, game.enemy.energy, true)
    if (!demo) {
      ctx.fillStyle = "#d62828"
      for (var i = 0; i < game.lives; i++) ctx.fillRect(leeEnd + Game.maxEnergy * 6 + 3 + i * 5, 18, 3, 3)
    }
    if (muted) text(ctx, "SOUND OFF", 120, 170, 5, "#dddddd", "center")
  }

  function drawBanner(ctx) {
    var b = Game.banner(game)
    if (b === "") return
    if (game.mode === "pause") {
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)"
      ctx.fillRect(0, 26, Game.worldWidth, Game.worldHeight - 26)
    }
    text(ctx, b, 120, 74, 16, "#ffd23f", "center", "#d62828")
    if (game.mode === "intro" && b.indexOf("STAGE") === 0) {
      var who = Game.opponent(game)
      text(ctx, who.name, 120, 94, 10, "#ffffff", "center", "#000000")
      text(ctx, who.note, 120, 107, 6, "#cccccc", "center", "#000000")
    } else if (game.mode === "clear") {
      text(ctx, "ENERGY BONUS " + (game.player.energy * 1000) + (game.perfect ? " + PERFECT 5000" : ""), 120, 94, 6, "#ffffff", "center", "#000000")
    } else if (game.mode === "champion") {
      text(ctx, "THE TOURNAMENT STARTS AGAIN", 120, 94, 6, "#ffffff", "center", "#000000")
    } else if (game.mode === "continue") {
      text(ctx, "PRESS ENTER · CREDIT " + game.credits, 120, 94, 6, "#ffffff", "center", "#000000")
    }
  }

  function drawTitle(ctx) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)"
    ctx.fillRect(0, 26, Game.worldWidth, Game.worldHeight - 26)
    text(ctx, "YIE AR", 120, 54, 24, "#ffd23f", "center", "#d62828")
    text(ctx, "KUNG-FU", 120, 80, 20, "#ffd23f", "center", "#d62828")
    text(ctx, "A TRIBUTE TO KONAMI'S 1985 ARCADE CLASSIC", 120, 98, 5, "#dddddd", "center")
    if (game.modeT < Game.timings.codeBanner && game.clock < Game.timings.codeBanner)
      text(ctx, "CODE ACCEPTED", 120, 118, 8, "#9ad1ff", "center", "#000000")
    else if (Math.floor(game.clock / 500) % 2 === 0)
      text(ctx, "PRESS ENTER", 120, 118, 8, "#ffffff", "center", "#000000")
    text(ctx, "PLAYER 1  LEE", 5, 170, 5, "#dddddd", "left")
    text(ctx, "CREDIT " + game.credits, 235, 170, 5, "#dddddd", "right")
  }

  function draw(ctx) {
    if (!game) return
    var s = screen.width / Game.worldWidth
    ctx.reset()
    ctx.save()
    ctx.scale(s, s)
    if (Game.stageLevel(game) === 2) drawPalace(ctx)
    else drawCave(ctx)
    drawFighter(ctx, game.enemy)
    game.clones.forEach(function(c) { drawFighter(ctx, c) })
    drawFighter(ctx, game.player)
    drawProjectiles(ctx)
    drawSparks(ctx)
    drawHud(ctx)
    if (game.mode === "title") drawTitle(ctx)
    else drawBanner(ctx)
    ctx.restore()
  }

  Canvas {
    id: screen
    width: parent.width
    height: Math.round(width * Game.worldHeight / Game.worldWidth)
    onPaint: arcade.draw(getContext("2d"))
  }

  // The arcade's sixteen attacks: hold a button and press a direction, or
  // hold the direction and press the button. Arrows as if facing right.
  Column {
    id: legend
    anchors.top: screen.bottom
    anchors.topMargin: Style.space(10)
    width: parent.width
    spacing: Style.space(3)

    Line {
      text: "Hold Z punch or X kick with a direction: 16 moves"
      color: arcade.foreground
    }

    Line {
      text: "Z  ← high  → lunge  ↓ crouch  ↘ low  ↙ split  ↖ rising  ↑ jump  ↗ dive"
    }

    Line {
      text: "X  ← high  → side  ↓ low  ↘ sweep  ↙ floor  ↖ rising  ↑ flying  ↗ jump"
    }

    Line {
      text: "↑ jump  ↓ duck  ← → walk  ·  arrows as facing right  ·  Enter start  P pause  M sound  Esc back"
    }

    Line {
      topPadding: Style.space(6)
      text: "Did you know? " + Game.trivia[arcade.triviaIndex]
      color: arcade.accent
    }
  }
}
