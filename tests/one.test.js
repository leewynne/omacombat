const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const Model = require("../Model.js")

// onefc.com's schedule and two event pages as they stood on 27 Oct 2026:
// ONE Fight Night 49's card before the event, and ONE SAMURAI 4's after it.
const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
const now = Date.UTC(2026, 9, 27, 12, 0)

function schedule() {
  return Model.parseOneSchedule(fixture("one-events.html"))
}

test("parseOneSchedule reads every upcoming event in time order", () => {
  const events = schedule()
  assert.equal(events.length, 13)
  assert.equal(events[0].name, "ONE Friday Fights 176 & The Inner Circle 36")
  assert.equal(events[0].startMs, 1793359800 * 1000)
  assert.equal(events[0].location, "Lumpinee Stadium, Bangkok")
  assert.equal(events[0].url, "https://www.onefc.com/events/one-friday-fights-176/")
  assert.equal(events[0].sport, "one")
  assert.deepEqual(events[0].broadcasts, [])
  for (let i = 1; i < events.length; i++) assert.ok(events[i - 1].startMs <= events[i].startMs)
  assert.equal(events[events.length - 1].name, "ONE: Qatar")
})

test("names split into brand and headliners only when there are headliners", () => {
  const fn49 = schedule().find(e => e.url.endsWith("onefightnight49/"))
  assert.equal(fn49.brand, "ONE Fight Night 49")
  assert.equal(fn49.headline, "Gabriel vs. Magomedov")
  assert.deepEqual(Model.oneName("ONE: Qatar"), { brand: "ONE: Qatar", headline: "" })
  assert.deepEqual(Model.oneName("ONE SAMURAI 5"), { brand: "ONE SAMURAI 5", headline: "" })
})

test("the weekly Friday Fights aren't big events", () => {
  const big = schedule().filter(e => e.big).map(e => e.name)
  assert.deepEqual(big, ["ONE Fight Night 49: Gabriel Vs. Magomedov", "ONE SAMURAI 5", "ONE SAMURAI 6", "ONE Fight Night 50", "ONE: Qatar"])
})

test("parseOneSchedule returns null without an upcoming section", () => {
  assert.equal(Model.parseOneSchedule(""), null)
  assert.equal(Model.parseOneSchedule("<html><body>Maintenance</body></html>"), null)
  assert.deepEqual(Model.parseOneSchedule('<div id="upcoming-events-section"></div><a id="past"></a>'), [])
  assert.deepEqual(Model.parseOneSchedule('<div id="upcoming-events-section"><div class="simple-post-card is-event">no link</div>'), [])
})

test("a card lists every bout, main event first, with discipline and weight", () => {
  const bouts = Model.parseOneCard(fixture("one-card.html"))
  assert.equal(bouts.length, 9)
  const [main, co] = bouts
  assert.equal(main.mainEvent, true)
  assert.equal(co.mainEvent, false)
  assert.equal(main.red.name, "Lucas Gabriel")
  assert.equal(main.red.lastName, "Gabriel")
  assert.equal(main.red.country, "Brazil")
  assert.equal(main.blue.name, "Magomed Magomedov")
  assert.equal(main.blue.country, "Russia")
  assert.equal(main.discipline, "MMA")
  assert.equal(main.weightClass, "Lightweight")
  assert.equal(main.titleFight, false)
  assert.equal(main.result, "")
  assert.equal(Model.boutTag(main), "MMA")
  assert.equal(Model.boutNote(main), "Lightweight")
  assert.equal(Model.boutAccent(main), false)
  assert.equal(co.red.lastName, "Kongthoranee", "ONE's own short names")
  assert.deepEqual(bouts.map(b => b.discipline), ["MMA", "Kickboxing", "MMA", "Muay Thai", "Kickboxing", "MMA", "Grappling", "MMA", "Kickboxing"])
  assert.equal(Model.cornerDetail(main.red), "Brazil")
})

test("finished bouts carry the winner and the method; title fights are marked", () => {
  const bouts = Model.parseOneCard(fixture("one-results.html"))
  assert.equal(bouts.length, 10)
  const [title, , split, blueWin] = bouts
  assert.equal(title.titleFight, true)
  assert.equal(title.weightClass, "Bantamweight World Championship")
  assert.equal(title.discipline, "Kickboxing")
  assert.equal(title.red.winner, true)
  assert.equal(title.blue.winner, false)
  assert.equal(title.result, "Haggerty · TKO (R3)")
  assert.equal(Model.boutNote(title), "Bantamweight World Championship · Haggerty · TKO (R3)")
  assert.equal(Model.boutAccent(title), true)
  assert.equal(split.result, "Noiri · Split Decision (R3)")
  assert.equal(blueWin.blue.winner, true)
  assert.equal(blueWin.result, "Anane · Unanimous Decision (R3)")
})

test("parseOneCard tells a missing page from an unannounced card", () => {
  assert.equal(Model.parseOneCard(""), null)
  assert.equal(Model.parseOneCard("curl: (6) Could not resolve host"), null)
  assert.deepEqual(Model.parseOneCard('<a href="https://www.onefc.com/">ONE</a><h2>Synopsis</h2>'), [])
})

test("a draw or no contest still shows its result", () => {
  const html = 'https://www.onefc.com <div class="event-matchup "><div class="title">Flyweight Muay Thai</div>' +
    '<div class="versus">A vs. B</div><a class="face face1"><div class="sticker is-draw"><span><em>DRAW</em></span></div></a>' +
    '<a class="face face2"><div class="sticker"></div></a><div class="stats"><table></table></div></div>'
  const [bout] = Model.parseOneCard(html)
  assert.equal(bout.result, "DRAW")
  assert.equal(bout.red.name, "TBA")
  assert.equal(bout.red.lastName, "A")
  assert.equal(bout.blue.country, "")
})

test("oneEvents filters by scope and drops finished events", () => {
  const events = schedule()
  assert.equal(Model.oneEvents(events, "all", now).length, 13)
  assert.equal(Model.oneEvents(events, "big", now).length, 5)
  assert.deepEqual(Model.oneEvents(events, "off", now), [])
  assert.equal(Model.oneEvents(events, "junk", now).length, 13)
  assert.deepEqual(Model.oneEvents(null, "all", now), [])
  const after = events[0].startMs + 8 * 3600e3 + 1
  assert.equal(Model.oneEvents(events, "all", after)[0].name, "ONE Friday Fights 177 & The Inner Circle 37")
})

test("ONE events count down, then run live for six hours", () => {
  const e = schedule()[0]
  assert.equal(Model.oneStatus(e, e.startMs - (2 * 86400e3 + 3 * 3600e3)), "In 2d 3h")
  assert.equal(Model.oneLive(e, e.startMs - 1), false)
  assert.equal(Model.oneLive(e, e.startMs + 3600e3), true)
  assert.equal(Model.oneStatus(e, e.startMs + 3600e3), "Live now")
  assert.equal(Model.oneLive(e, e.startMs + 6 * 3600e3), false)
  assert.equal(Model.oneLive(null, now), false)
  assert.equal(Model.oneStatus(null, now), "")
})

test("caption and headline come from the name, or from the card", () => {
  const events = schedule()
  const friday = events[0]
  const fn49 = events.find(e => e.headline)
  const bouts = Model.parseOneCard(fixture("one-card.html"))
  assert.equal(Model.oneCaption(fn49, null), "ONE Fight Night 49")
  assert.equal(Model.oneHeadline(fn49, null), "Gabriel vs. Magomedov")
  assert.equal(Model.oneCaption(friday, null), "ONE Championship")
  assert.equal(Model.oneHeadline(friday, null), "")
  assert.equal(Model.oneCaption(friday, bouts), "ONE Friday Fights 176 & The Inner Circle 36")
  assert.equal(Model.oneHeadline(friday, bouts), "Gabriel vs. Magomedov")
  assert.equal(Model.oneCaption(null, null), "ONE Championship")
  assert.equal(Model.oneHeadline(null, null), "")
})

test("cards refetch after 15 minutes, every 2 when live, and a minute after failing", () => {
  const e = schedule()[0]
  const before = e.startMs - 86400e3
  assert.equal(Model.oneCardStale(null, e, before), true)
  assert.equal(Model.oneCardStale({ fetchedAt: before - 10 * 60e3, failed: false }, e, before), false)
  assert.equal(Model.oneCardStale({ fetchedAt: before - 16 * 60e3, failed: false }, e, before), true)
  const live = e.startMs + 3600e3
  assert.equal(Model.oneCardStale({ fetchedAt: live - 3 * 60e3, failed: false }, e, live), true)
  assert.equal(Model.oneCardStale({ fetchedAt: live - 30e3, failed: true }, e, live), false)
  assert.equal(Model.oneCardStale({ fetchedAt: live - 90e3, failed: true }, e, live), true)
})

test("sports and the ONE setting stay in step with the manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"))
  const one = manifest.barWidget.schema.find(s => s.key === "one")
  assert.deepEqual(one.options, Model.oneScopes)
  assert.equal(one.defaultValue, manifest.barWidget.defaults.one)
  assert.deepEqual(Model.sports, ["ufc", "one", "pfl", "boxing"])
  assert.equal(Model.sport("one"), "one")
  assert.equal(Model.oneScope("big"), "big")
  assert.equal(Model.oneScope(undefined), "all")
  assert.equal(Model.oneScheduleUrl, "https://www.onefc.com/events/")
})
