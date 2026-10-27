const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const Model = require("../Model.js")

// ESPN's "Boxing schedule" story as the news API served it on 27 Oct 2026,
// last edited 25 Oct: key dates, then October 2026 through January 2027.
const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "boxing.json"), "utf8")
const now = Date.UTC(2026, 9, 27, 10, 0)
const published = Date.UTC(2026, 9, 25, 4, 3, 58)

function cards() {
  return Model.parseBoxingSchedule(fixture, now)
}

function story(html, extra = {}) {
  return JSON.stringify({ headlines: [{ lastModified: "2026-10-25T04:03:58Z", story: html, ...extra }] })
}

function find(list, headline) {
  return list.find(c => c.headline === headline)
}

test("parseBoxingSchedule reads every card in date order", () => {
  const list = cards()
  assert.equal(list.length, 21)
  assert.deepEqual(list.slice(0, 3).map(c => c.headline), ["Alvarez vs. Mbilli", "Buatsi vs. Hutchinson", "Billam-Smith vs. Clarke"])
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].dayMs <= list[i].dayMs)
})

test("cards carry the date, place, channel and a link to their month", () => {
  const card = cards()[0]
  assert.equal(card.dayMs, Date.UTC(2026, 9, 31))
  assert.deepEqual([card.year, card.month, card.day], [2026, 9, 31])
  assert.equal(card.location, "Riyadh, Saudi Arabia")
  assert.deepEqual(card.broadcasts, ["DAZN PPV"])
  assert.equal(card.url, "https://www.espn.com/boxing/story/_/id/12508267/boxing-schedule#OCT")
  assert.equal(card.fightCount, 6)
  assert.equal(card.sport, "boxing")

  const tokyo = find(cards(), "Jimenez vs. Akui")
  assert.equal(tokyo.location, "Tokyo")
  assert.deepEqual(tokyo.broadcasts, [])
})

test("January after December lands in the next year", () => {
  const list = cards()
  const january = list[list.length - 1]
  assert.equal(january.headline, "Bank vs. Alimkhanuly")
  assert.equal(january.dayMs, Date.UTC(2027, 0, 23))
  assert.match(january.url, /#JAN$/)
})

test("the key dates mark the big fights", () => {
  const big = cards().filter(c => c.big).map(c => c.headline)
  assert.deepEqual(big, ["Alvarez vs. Mbilli", "Baumgardner vs. Turhan", "Benavidez vs. Cieslak", "Fury vs. Joshua", "Bivol vs. Smith"])
})

test("bouts carry rounds and the title or the weight class", () => {
  const [main, second] = cards()[0].fights
  assert.equal(main.mainEvent, true)
  assert.equal(main.titleFight, true)
  assert.equal(main.red.name, "Canelo Alvarez")
  assert.equal(main.blue.lastName, "Mbilli")
  assert.equal(main.rounds, 12)
  assert.equal(main.belt, "Mbilli's WBC super middleweight title")
  assert.equal(main.weightClass, "")
  assert.equal(second.mainEvent, false)

  const undercard = cards()[0].fights[4]
  assert.equal(undercard.titleFight, false)
  assert.equal(undercard.belt, "")
  assert.equal(undercard.weightClass, "Junior featherweight")
  assert.equal(Model.boutNote(undercard), "Junior featherweight")
  assert.equal(Model.boutNote(main), "Mbilli's WBC super middleweight title")
  assert.equal(Model.boutRounds(main), "12 RDS")
})

test("typos in the story still parse", () => {
  const bivol = find(cards(), "Bivol vs. Smith").fights[0]
  assert.equal(bivol.rounds, 12) // "12 rouns"
  const moses = find(cards(), "Pacheco vs. Fulghum").fights.find(f => f.red.lastName === "Moses")
  assert.equal(moses.rounds, 8) // "8. rounds"
  assert.equal(moses.blue.name, "TBA")
})

test("a vacant title drops the article", () => {
  const fury = find(cards(), "Fury vs. Joshua").fights[0]
  assert.equal(fury.belt, "Vacant WBA \"super\" heavyweight title")
})

test("the key dates can pick a headliner other than the first bout", () => {
  const list = Model.parseBoxingSchedule(story(
    "<h2>Key dates:</h2><ul><li><b>Nov. 7: London (DAZN)</b> -- Title fight: Cat Gamma vs. Dee Delta, 12 rounds, for Gamma's WBO title</li></ul>" +
    "<h2>Full schedule:</h2><h3>Nov. 7: London (DAZN)</h3><ul>" +
    "<li>Ann Alpha vs. Bea Beta, 10 rounds, heavyweights</li>" +
    "<li><b>Title fight:</b> Cat Gamma vs. Dee Delta, 12 rounds, for Gamma's WBO title</li></ul>"
  ), now)
  assert.equal(list.length, 1)
  assert.equal(list[0].headline, "Gamma vs. Delta")
  assert.equal(list[0].big, true)
  assert.deepEqual(list[0].fights.map(f => f.red.lastName), ["Gamma", "Alpha"])
})

test("a key date missing from the full schedule still becomes a card", () => {
  const list = Model.parseBoxingSchedule(story(
    "<h2>Key dates:</h2><ul><li><b>Dec. 11: Cardiff, Wales (Netflix)</b> &mdash; Tyson Fury vs. Anthony Joshua, 12 rounds, heavyweights</li>" +
    "<li>not a key date</li></ul>"
  ), now)
  assert.equal(list.length, 1)
  assert.equal(list[0].headline, "Fury vs. Joshua")
  assert.equal(list[0].fightCount, 1)
  assert.equal(list[0].big, true)
})

test("parseBoxingSchedule returns null for unusable responses", () => {
  assert.equal(Model.parseBoxingSchedule("", now), null)
  assert.equal(Model.parseBoxingSchedule("<html>", now), null)
  assert.equal(Model.parseBoxingSchedule("{}", now), null)
  assert.equal(Model.parseBoxingSchedule(JSON.stringify({ headlines: [{}] }), now), null)
  assert.equal(Model.parseBoxingSchedule(story("<p>No fights listed.</p>"), now), null)
})

test("without a publication date the year comes from now", () => {
  const list = Model.parseBoxingSchedule(JSON.stringify({ headlines: [{
    story: "<h3>Jan. 9: Bournemouth, England</h3><ul><li>Ryan Garner vs. James Dickens, 12 rounds, for Garner's WBC interim junior lightweight title</li></ul>"
  }] }), now)
  assert.equal(list[0].dayMs, Date.UTC(2027, 0, 9))
  assert.equal(list[0].titleFight, false)
  assert.equal(list[0].fights[0].belt, "Garner's WBC interim junior lightweight title")
})

test("card headings that aren't dates are skipped", () => {
  const list = Model.parseBoxingSchedule(story(
    "<h3>Date TBA: Las Vegas</h3><ul><li>Ann Alpha vs. Bea Beta, 10 rounds, heavyweights</li></ul>" +
    "<h3>Smarch 3: Springfield</h3><ul><li>Ann Alpha vs. Bea Beta</li></ul>" +
    "<h3>Feb. 30: Nowhere</h3><ul><li>Ann Alpha vs. Bea Beta</li></ul>" +
    "<h3>Nov. 14: Levallois-Perret, France</h3><ul><li>Bakary Samake vs. Uisma Lima</li><li>Card subject to change</li></ul>"
  ), now)
  assert.equal(list.length, 1)
  assert.equal(list[0].fights[0].rounds, 0)
  assert.equal(list[0].fights[0].weightClass, "")
  assert.equal(Model.boutRounds(list[0].fights[0]), "")
})

test("a card announced without bouts has no headline", () => {
  const list = Model.parseBoxingSchedule(story("<h3>Nov. 20: Indio, California (DAZN)</h3><p>Card to be announced.</p>"), now)
  assert.equal(list[0].headline, "")
  assert.equal(list[0].fightCount, 0)
})

test("parseCardHeading takes ranges, spelled-out months and entities", () => {
  const h = Model.parseCardHeading("Sept. 12-13: Las Vegas &amp; Henderson (DAZN)", published)
  assert.equal(h.dayMs, Date.UTC(2026, 8, 12))
  assert.equal(h.location, "Las Vegas & Henderson")
  assert.equal(Model.parseCardHeading("June 6: London", published).dayMs, Date.UTC(2026, 5, 6))
  assert.equal(Model.parseCardHeading("TBA", published), null)
})

test("nearestDate picks the year closest to the reference", () => {
  assert.equal(Model.nearestDate(0, 9, published), Date.UTC(2027, 0, 9))
  assert.equal(Model.nearestDate(9, 1, published), Date.UTC(2026, 9, 1))
  assert.ok(isNaN(Model.nearestDate(1, 30, published)))
})

test("boxer names keep suffixes with the surname", () => {
  const bout = Model.parseBout("Vergil Ortiz Jr. vs. Keith Thurman, 12 rounds, middleweights", 0)
  assert.equal(bout.red.lastName, "Ortiz Jr.")
  assert.equal(bout.blue.lastName, "Thurman")
  assert.equal(Model.parseBout("Cher vs. Madonna", 0).red.lastName, "Cher")
  assert.equal(Model.parseBout("No opponent here", 0), null)
})

test("decodeEntities handles named and numeric references", () => {
  assert.equal(Model.decodeEntities("Ali&rsquo;s &quot;belt&quot; &#8212; &#x2014; &bogus; &#0;"), "Ali’s \"belt\" — — &bogus; &#0;")
  assert.equal(Model.plainText("<li><b>Title fight:</b>  A&nbsp;vs. B</li>"), "Title fight: A vs. B")
  assert.equal(Model.plainText(undefined), "")
})

test("boxingCards filters by scope and drops past cards", () => {
  const list = cards()
  assert.equal(Model.boxingCards(list, "big", now).length, 5)
  assert.equal(Model.boxingCards(list, "titles", now).length, 13)
  assert.equal(Model.boxingCards(list, "all", now).length, 21)
  assert.deepEqual(Model.boxingCards(list, "off", now), [])
  assert.equal(Model.boxingCards(list, "junk", now).length, 5)
  assert.deepEqual(Model.boxingCards(null, "all", now), [])

  // Alvarez vs. Mbilli is on 31 Oct; it stays until midday UTC on 1 Nov.
  assert.equal(Model.boxingCards(list, "big", Date.UTC(2026, 10, 1, 11, 59))[0].headline, "Alvarez vs. Mbilli")
  assert.equal(Model.boxingCards(list, "big", Date.UTC(2026, 10, 1, 12, 1))[0].headline, "Baumgardner vs. Turhan")
})

test("big falls back to title fights when the key dates are gone", () => {
  const noKeys = cards().map(c => ({ ...c, big: false }))
  assert.equal(Model.boxingCards(noKeys, "big", now).length, 13)
})

test("boxingStatus counts calendar days", () => {
  const card = cards()[0] // 31 Oct
  const at = (month, day, hour) => new Date(2026, month, day, hour).getTime()
  assert.equal(Model.daysUntil(card, at(9, 27, 23)), 4)
  assert.equal(Model.boxingStatus(card, at(9, 27, 9)), "In 4 days")
  assert.equal(Model.boxingStatus(card, at(9, 30, 23)), "Tomorrow")
  assert.equal(Model.boxingStatus(card, at(9, 31, 1)), "Fight night")
  assert.equal(Model.boxingStatus(card, at(10, 1, 1)), "Fight night")
  assert.equal(Model.boxingStatus(null, now), "")
})

test("cardDate is local midnight on the card's date", () => {
  const d = Model.cardDate(cards()[0])
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 31, 0])
})

test("sport and scope settings fall back to the defaults", () => {
  assert.equal(Model.sport("boxing"), "boxing")
  assert.equal(Model.sport("ufc"), "ufc")
  assert.equal(Model.sport("kickboxing"), "ufc")
  assert.equal(Model.boxingScope("titles"), "titles")
  assert.equal(Model.boxingScope(undefined), "big")
})

test("the boxing setting stays in step with the manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"))
  const boxing = manifest.barWidget.schema.find(s => s.key === "boxing")
  assert.deepEqual(boxing.options, Model.boxingScopes)
  assert.equal(boxing.defaultValue, manifest.barWidget.defaults.boxing)
  assert.equal(Model.boxingStoryUrl, "https://now.core.api.espn.com/v1/sports/news/12508267")
})
