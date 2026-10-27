import QtQuick
import qs.Commons
import "Arcade.js" as Game

// The Yie Ar Kung-Fu easter egg's screen. Arcade.js plays the game; this
// takes the keys, runs the clock and draws each frame as chunky pixels.
Item {
  id: arcade

  property string fontFamily: Style.font.family
  property color foreground: Color.foreground
  property color dim: Qt.darker(foreground, 1.4)
  property color accent: Color.accent
  property real hiScore: 0
  property bool running: true

  signal exitRequested()
  signal hiScoreReached(real score)

  // Made once on load, not bound: a binding on hiScore would restart the
  // game every time the high score moved.
  property var game: null
  property var held: ({ left: false, right: false, up: false, down: false })
  property var queued: ({ punch: false, kick: false, start: false, pause: false })
  property real lastTick: 0
  property int triviaIndex: 0

  implicitHeight: screen.height + legend.implicitHeight + Style.space(12)
  focus: true

  Component.onCompleted: {
    game = Game.newGame(Math.floor(Math.random() * 2147483647), hiScore)
    triviaIndex = Math.floor(Math.random() * Game.trivia.length)
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
    if (k in held) held[k] = true
    else if (k !== "" && !event.isAutoRepeat) queued[k] = true
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
      punch: queued.punch, kick: queued.kick, start: queued.start, pause: queued.pause
    }
    queued = { punch: false, kick: false, start: false, pause: false }
    Game.step(game, input, dt)
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
  // touched left faint seams between them.
  function disc(ctx, cx, cy, r, color, top) {
    ctx.fillStyle = color
    var R = Math.round(r)
    var last = top ? -1 : R
    for (var dy = -R; dy <= last; dy++) {
      var half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)))
      ctx.fillRect(Math.round(cx) - half, Math.round(cy) + dy, half * 2 + 1, dy < last ? 1.5 : 1)
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

  function drawCave(ctx) {
    ctx.fillStyle = "#140f0c"
    ctx.fillRect(0, 0, Game.worldWidth, Game.worldHeight)
    ctx.fillStyle = "#211813"
    var rocks = [[8, 60, 30, 40], [52, 44, 22, 70], [118, 70, 40, 34], [176, 50, 26, 60], [206, 84, 30, 40]]
    rocks.forEach(function(r) { ctx.fillRect(r[0], r[1], r[2], r[3]) })
    ctx.fillStyle = "#2c2019"
    var drips = [[20, 14], [44, 9], [80, 18], [112, 11], [146, 16], [170, 8], [200, 15], [226, 10]]
    drips.forEach(function(d) {
      for (var row = 0; row < d[1]; row++) {
        var half = Math.round((d[1] - row) / 3)
        ctx.fillRect(d[0] - half, 26 + row, half * 2 + 1, 1)
      }
    })
    ctx.fillStyle = "#2b211b"
    ctx.fillRect(0, Game.floorY, Game.worldWidth, Game.worldHeight - Game.floorY)
    ctx.fillStyle = "#4a3a30"
    ctx.fillRect(0, Game.floorY, Game.worldWidth, 1)
  }

  function drawPalace(ctx) {
    ctx.fillStyle = "#0d1630"
    ctx.fillRect(0, 0, Game.worldWidth, Game.worldHeight)
    disc(ctx, 196, 48, 8, "#e9e4c9", false)
    ctx.fillStyle = "#7a1c1c"
    ctx.fillRect(0, 30, Game.worldWidth, 7)
    ctx.fillStyle = "#c9a227"
    ctx.fillRect(0, 37, Game.worldWidth, 2)
    var pillars = [30, 90, 150, 210]
    pillars.forEach(function(x) {
      ctx.fillStyle = "#8f1d1d"
      ctx.fillRect(x - 4, 39, 8, Game.floorY - 39)
      ctx.fillStyle = "#b33a3a"
      ctx.fillRect(x - 4, 39, 2, Game.floorY - 39)
    })
    ctx.fillStyle = "#4b3621"
    ctx.fillRect(0, Game.floorY, Game.worldWidth, Game.worldHeight - Game.floorY)
    ctx.fillStyle = "#5e4630"
    for (var x = 0; x < Game.worldWidth; x += 16) ctx.fillRect(x, Game.floorY, 1, Game.worldHeight - Game.floorY)
    ctx.fillRect(0, Game.floorY, Game.worldWidth, 1)
  }

  function drawFighter(ctx, f) {
    var fig = Game.figure(f, Game.isActive(f))
    var k = f.profile.build || 1
    var flash = f.flash > 0 && Math.floor(game.clock / 50) % 2 === 0
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)"
    ctx.fillRect(Math.round(f.x - 9 * k), Game.floorY, Math.round(18 * k), 2)
    fig.parts.forEach(function(p) { stroke(ctx, p.from, p.to, p.w, flash ? "#ffffff" : p.color) })
    ctx.fillStyle = f.isPlayer ? "#d62828" : "#111111"
    if (fig.pose !== "down") ctx.fillRect(Math.round(fig.belt.x - fig.belt.w / 2), Math.round(fig.belt.y - 1), fig.belt.w, 2)
    disc(ctx, fig.head.x, fig.head.y, fig.head.r, flash ? "#ffffff" : fig.head.skin, false)
    disc(ctx, fig.head.x, fig.head.y, fig.head.r, fig.head.hair, true)
    ctx.fillStyle = "#111111"
    if (fig.pose !== "down") ctx.fillRect(Math.round(fig.head.x + f.facing * 2), Math.round(fig.head.y), 1, 1)
    fig.weapon.forEach(function(p) { stroke(ctx, p.from, p.to, p.w, p.color) })
  }

  function drawProjectiles(ctx) {
    game.projectiles.forEach(function(pr) {
      var y = Game.floorY - Game.levelHeight[pr.level]
      var turn = pr.spin / 60
      var color = pr.kind === "fan" ? "#f2c14e" : "#cfd6de"
      for (var i = 0; i < 4; i++) {
        var a = turn + i * Math.PI / 2
        stroke(ctx, { x: pr.x, y: y }, { x: pr.x + Math.cos(a) * 4, y: y + Math.sin(a) * 4 }, pr.kind === "fan" ? 2 : 1, color)
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
      ctx.fillStyle = on ? (energy <= 2 ? "#ff4d4d" : "#ffd23f") : "#3a3a3a"
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

  Column {
    id: legend
    anchors.top: screen.bottom
    anchors.topMargin: Style.space(10)
    width: parent.width
    spacing: Style.space(3)

    Line {
      text: "← →  walk    ↑  jump    ↓  duck    Z  punch    X  kick"
      color: arcade.foreground
    }

    Line {
      text: "↓+Z low punch  ·  ↓+X sweep  ·  in the air: X flying kick, Z jump punch"
    }

    Line {
      text: "Enter start  ·  P pause  ·  Esc back to the fight cards"
    }

    Line {
      topPadding: Style.space(6)
      text: "Did you know? " + Game.trivia[arcade.triviaIndex]
      color: arcade.accent
    }
  }
}
