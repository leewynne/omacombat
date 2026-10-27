const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const Model = require("../Model.js")

// A trimmed ESPN PFL response captured on 27 Oct 2026: PFL Chicago (final),
// then PFL Dubai and PFL Lyon, scheduled.
const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "pfl.json"), "utf8")
const now = Date.UTC(2026, 9, 27, 12, 0)

function schedule() {
  return Model.parseScoreboard(fixture, "pfl")
}

test("the PFL scoreboard comes from the same ESPN feed as the UFC's", () => {
  assert.equal(
    Model.scoreboardUrl(now, 180, "pfl"),
    "https://site.api.espn.com/apis/site/v2/sports/mma/pfl/scoreboard?limit=100&dates=20261026-20270425"
  )
  assert.match(Model.scoreboardUrl(now, 180), /\/mma\/ufc\/scoreboard\?/)
  assert.match(Model.scoreboardUrl(now, 180, "junk"), /\/mma\/ufc\/scoreboard\?/)
  assert.deepEqual(Model.leagues, ["ufc", "pfl"])
})

test("PFL events read like UFC ones, finished events dropped", () => {
  const events = schedule()
  assert.deepEqual(events.map(e => e.name), ["PFL Dubai: Nemkov vs. Bilostenniy", "PFL Lyon: Lapilus vs. McKee"])
  const [dubai] = events
  assert.equal(dubai.brand, "PFL Dubai")
  assert.equal(dubai.headline, "Nemkov vs. Bilostenniy")
  assert.equal(dubai.venue, "Coca-Cola Arena")
  assert.equal(dubai.location, "Dubai, United Arab Emirates")
  assert.deepEqual(dubai.broadcasts, ["ESPN+"])
  assert.equal(dubai.url, "https://www.espn.com/mma/fightcenter/_/id/600061421/league/pfl")
  assert.equal(dubai.fightCount, 14)
  assert.equal(Model.statusText(dubai, now), "In 18d 6h")
})

test("a PFL card splits into main card and prelims, the main event first", () => {
  const [dubai] = schedule()
  assert.deepEqual(dubai.segments.map(s => s.label), ["Main Card", "Prelims"])
  assert.deepEqual(dubai.segments.map(s => s.fights.length), [5, 9])
  assert.equal(dubai.mainCardMs, Date.UTC(2026, 10, 14, 18, 0))
  assert.equal(dubai.startMs, Date.UTC(2026, 10, 14, 14, 0))
  const main = Model.mainEvent(dubai)
  assert.equal(main, dubai.segments[0].fights[0])
  assert.equal(main.red.name, "Vadim Nemkov")
  assert.equal(main.red.record, "20-2-0")
  assert.equal(main.weightClass, "Heavyweight")
  assert.equal(main.rounds, 5)
  const unlisted = dubai.segments[0].fights.find(f => f.red.lastName === "Pettis")
  assert.equal(unlisted.weightClass, "", "a bout ESPN gives no weight class")
  assert.equal(unlisted.rounds, 3)
})

test("a PFL event without a name or link falls back to PFL's", () => {
  const [event] = Model.parseScoreboard(JSON.stringify({ events: [{ id: "7", date: "2026-11-14T18:00Z" }] }), "pfl")
  assert.equal(event.name, "PFL")
  assert.equal(event.brand, "PFL")
  assert.equal(event.url, "https://www.espn.com/mma/fightcenter/_/id/7/league/pfl")
})

test("the PFL setting is a switch, on unless turned off", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"))
  const pfl = manifest.barWidget.schema.find(s => s.key === "pfl")
  assert.equal(pfl.type, "boolean")
  assert.equal(pfl.defaultValue, true)
  assert.equal(manifest.barWidget.defaults.pfl, true)
  assert.equal(Model.switchedOn(true), true)
  assert.equal(Model.switchedOn(undefined), true)
  assert.equal(Model.switchedOn(false), false)
  assert.equal(Model.switchedOn("false"), false)
  assert.equal(Model.sport("pfl"), "pfl")
})
