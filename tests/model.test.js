const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const Model = require("../Model.js")

// A trimmed ESPN response captured on 25 Oct 2026: UFC 333 (final), then two
// scheduled Fight Nights.
const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "scoreboard.json"), "utf8")
const now = Date.UTC(2026, 9, 25, 15, 30)

function schedule() {
  return Model.parseScoreboard(fixture)
}

function competitor(name, order, extra = {}) {
  return { order, athlete: { displayName: name, shortName: name.replace(/^(\S)\S*\s/, "$1. ") }, ...extra }
}

function fight(date, red, blue, extra = {}) {
  return { id: red + blue, date, competitors: [competitor(red, 1), competitor(blue, 2)], ...extra }
}

function scoreboard(events) {
  return JSON.stringify({ events })
}

test("scoreboardUrl covers yesterday through the lookahead in UTC days", () => {
  assert.equal(
    Model.scoreboardUrl(now, 180),
    "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?limit=100&dates=20261024-20270423"
  )
  assert.match(Model.scoreboardUrl(now, "junk"), /dates=20261024-20270423$/)
  assert.match(Model.scoreboardUrl(now, 1), /dates=20261024-20261101$/)
})

test("parseTime accepts ESPN's minute-precision UTC stamps", () => {
  assert.equal(Model.parseTime("2026-11-01T00:00Z"), Date.UTC(2026, 10, 1, 0, 0))
  assert.equal(Model.parseTime("2026-11-01T00:00:30.000Z"), Date.UTC(2026, 10, 1, 0, 0, 30))
  assert.ok(isNaN(Model.parseTime("Sat, Oct 31")))
  assert.ok(isNaN(Model.parseTime(undefined)))
})

test("splitName separates the brand from the headline", () => {
  assert.deepEqual(Model.splitName("UFC 334: Gane vs. Hokit"), { brand: "UFC 334", headline: "Gane vs. Hokit" })
  assert.deepEqual(Model.splitName("UFC Fight Night"), { brand: "UFC Fight Night", headline: "" })
})

test("parseScoreboard drops finished events and sorts the rest", () => {
  const events = schedule()
  assert.deepEqual(events.map(e => e.name), [
    "UFC Fight Night: Moicano vs. Nolan",
    "UFC Fight Night: Bonfim vs. Brady"
  ])
})

test("parseScoreboard returns null for unusable responses", () => {
  assert.equal(Model.parseScoreboard(""), null)
  assert.equal(Model.parseScoreboard("<html>"), null)
  assert.equal(Model.parseScoreboard("{}"), null)
  assert.deepEqual(Model.parseScoreboard(scoreboard([])), [])
})

test("events carry venue, broadcast, link and both card times", () => {
  const event = schedule()[0]
  assert.equal(event.brand, "UFC Fight Night")
  assert.equal(event.headline, "Moicano vs. Nolan")
  assert.equal(event.venue, "Meta APEX")
  assert.equal(event.location, "Las Vegas, NV")
  assert.deepEqual(event.broadcasts, ["Paramount+"])
  assert.equal(event.url, "https://www.espn.com/mma/fightcenter/_/id/600061420/league/ufc")
  assert.equal(event.startMs, Date.UTC(2026, 9, 31, 21, 0))
  assert.equal(event.mainCardMs, Date.UTC(2026, 10, 1, 0, 0))
  assert.equal(event.fightCount, 13)
})

test("the card splits into segments with the main event on top", () => {
  const event = schedule()[0]
  assert.deepEqual(event.segments.map(s => [s.label, s.fights.length]), [["Main Card", 6], ["Prelims", 7]])

  const main = event.segments[0].fights[0]
  assert.equal(main.mainEvent, true)
  assert.equal(main.red.name, "Renato Moicano")
  assert.equal(main.red.record, "21-7-1")
  assert.equal(main.red.country, "Brazil")
  assert.equal(main.blue.name, "Tom Nolan")
  assert.equal(main.weightClass, "Lightweight")
  assert.equal(main.rounds, 5)
  assert.equal(Model.mainEvent(event), main)
})

test("three start times label early prelims", () => {
  const [event] = Model.parseScoreboard(scoreboard([{
    id: "1",
    name: "UFC 400: Alpha vs. Beta",
    date: "2027-01-01T22:00Z",
    status: { type: { state: "pre" } },
    competitions: [
      fight("2027-01-01T22:00Z", "Early One", "Early Two"),
      fight("2027-01-02T00:00Z", "Prelim One", "Prelim Two"),
      fight("2027-01-02T02:00Z", "Co Main", "Co Other"),
      fight("2027-01-02T02:00Z", "Ann Alpha", "Bea Beta")
    ]
  }]))
  assert.deepEqual(event.segments.map(s => s.label), ["Main Card", "Prelims", "Early Prelims"])
  assert.deepEqual(event.segments[0].fights.map(f => f.red.name), ["Ann Alpha", "Co Main"])
})

test("the headline picks the main event even when ESPN lists it early", () => {
  const [event] = Model.parseScoreboard(scoreboard([{
    id: "2",
    name: "UFC 401: Alpha vs. Beta",
    date: "2027-02-01T02:00Z",
    status: { type: { state: "pre" } },
    competitions: [
      fight("2027-02-01T02:00Z", "Ann Alpha", "Bea Beta"),
      fight("2027-02-01T02:00Z", "Cat Gamma", "Dee Delta")
    ]
  }]))
  assert.equal(event.segments[0].label, "Fight Card")
  assert.equal(Model.mainEvent(event).red.name, "Ann Alpha")
})

test("an unannounced card still lists the event", () => {
  const [event] = Model.parseScoreboard(scoreboard([{
    id: "3", name: "UFC 402", date: "2027-03-01T02:00Z", status: { type: { state: "pre" } }
  }]))
  assert.equal(event.fightCount, 0)
  assert.equal(event.mainCardMs, event.startMs)
  assert.equal(Model.mainEvent(event), null)
  assert.equal(event.url, "https://www.espn.com/mma/fightcenter/_/id/3/league/ufc")
  assert.equal(Model.barLabel(event, Date.UTC(2027, 1, 27, 2), "fighters"), "UFC 402 · 2d")
})

test("missing fighters show as TBA", () => {
  const [event] = Model.parseScoreboard(scoreboard([{
    id: "4", name: "UFC 403", date: "2027-04-01T02:00Z", status: { type: { state: "pre" } },
    competitions: [{ id: "x", date: "2027-04-01T02:00Z", competitors: [] }]
  }]))
  const bout = event.segments[0].fights[0]
  assert.equal(bout.red.name, "TBA")
  assert.equal(bout.blue.lastName, "TBA")
  assert.equal(Model.barLabel(event, Date.UTC(2027, 2, 31, 2), "fighters"), "TBA vs. TBA · 1d")
})

test("countdowns shrink from days to minutes", () => {
  const target = Date.UTC(2026, 10, 1, 0, 0)
  assert.equal(Model.countdown(target, now), "6d")
  assert.equal(Model.countdownLong(target, now), "6d 8h")
  assert.equal(Model.countdown(target, target - 5 * 3600e3 - 60e3), "5h")
  assert.equal(Model.countdownLong(target, target - 5 * 3600e3 - 12 * 60e3), "5h 12m")
  assert.equal(Model.countdown(target, target - 12 * 60e3), "12m")
  assert.equal(Model.countdownLong(target, target - 12 * 60e3), "12m")
  assert.equal(Model.countdown(target, target - 30e3), "now")
  assert.equal(Model.countdownLong(target, target), "now")
  assert.equal(Model.countdown(NaN, now), "")
  assert.equal(Model.countdownLong(NaN, now), "")
})

test("barLabel shows the fighters, and nothing for the badge", () => {
  const event = schedule()[0]
  assert.equal(Model.barLabel(event, now, "fighters"), "Moicano vs. Nolan · 6d")
  assert.equal(Model.barLabel(event, now, "badge"), "")
  assert.equal(Model.barLabel(null, now, "fighters"), "")
})

test("labelStyle keeps 1.0's icon style working as the badge", () => {
  assert.equal(Model.labelStyle("fighters"), "fighters")
  assert.equal(Model.labelStyle("badge"), "badge")
  assert.equal(Model.labelStyle("icon"), "badge")
  assert.equal(Model.labelStyle("countdown"), "fighters")
  assert.equal(Model.labelStyle(undefined), "fighters")
})

test("an event goes live at the first bout", () => {
  const event = schedule()[0]
  const prelims = event.startMs + 60e3
  const mainCard = event.mainCardMs + 60e3
  assert.equal(Model.isLive(event, now), false)
  assert.equal(Model.isLive(event, prelims), true)
  assert.equal(Model.isLive({ ...event, state: "in" }, now), true)
  assert.equal(Model.isLive(null, now), false)
  assert.equal(Model.barLabel(event, prelims, "fighters"), "Moicano vs. Nolan · LIVE")
  assert.equal(Model.statusText(event, now), "In 6d 8h")
  assert.equal(Model.statusText(event, prelims), "Live · prelims")
  assert.equal(Model.statusText(event, mainCard), "Live now")
  assert.equal(Model.statusText(null, now), "")
})

test("upcoming drops events ESPN never closed out", () => {
  const events = schedule()
  assert.equal(Model.upcoming(events, now).length, 2)
  const later = events[0].startMs + Model.staleAfterMs + 1
  assert.deepEqual(Model.upcoming(events, later).map(e => e.headline), ["Bonfim vs. Brady"])
  assert.equal(Model.upcoming([{ ...events[0], state: "in" }], later).length, 1)
  assert.deepEqual(Model.upcoming(null, now), [])
})

test("winners come through for finished bouts", () => {
  const [event] = Model.parseScoreboard(scoreboard([{
    id: "5", name: "UFC 404: Alpha vs. Beta", date: "2027-05-01T02:00Z", status: { type: { state: "in" } },
    competitions: [fight("2027-05-01T02:00Z", "Ann Alpha", "Bea Beta", {
      competitors: [competitor("Ann Alpha", 1, { winner: true }), competitor("Bea Beta", 2, { winner: false })]
    })]
  }]))
  const bout = event.segments[0].fights[0]
  assert.equal(bout.red.winner, true)
  assert.equal(bout.blue.winner, false)
})

test("cornerDetail joins record and country", () => {
  assert.equal(Model.cornerDetail({ record: "21-7-1", country: "Brazil" }), "21-7-1 · Brazil")
  assert.equal(Model.cornerDetail({ record: "", country: "Brazil" }), "Brazil")
  assert.equal(Model.cornerDetail({ record: "", country: "" }), "")
})

test("timeFormat honours the clock setting", () => {
  assert.equal(Model.timeFormat("24h", "h:mm AP"), "HH:mm")
  assert.equal(Model.timeFormat("12h", "HH:mm"), "h:mm AP")
  assert.equal(Model.timeFormat("locale", "h:mm AP"), "h:mm AP")
  assert.equal(Model.timeFormat("locale", ""), "HH:mm")
})

test("glyphs and label styles stay in step with the manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"))
  const label = manifest.barWidget.schema.find(s => s.key === "label")
  assert.deepEqual(label.options, Model.labelStyles)
  for (const glyph of Object.values(Model.glyphs)) assert.equal([...glyph].length, 1)
})
