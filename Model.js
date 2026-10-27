// ESPN's public UFC scoreboard and boxing schedule, shaped into what the bar
// pill and the fight-card panel need. Pure functions only: the QML owns
// fetching and timers, so everything here runs under node for the tests.

var scoreboardBase = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"

// ESPN has no boxing scoreboard. Its long-running "Boxing schedule" story is
// the source instead, read through the news API so it arrives as JSON.
var boxingStoryUrl = "https://now.core.api.espn.com/v1/sports/news/12508267"
var boxingPageUrl = "https://www.espn.com/boxing/story/_/id/12508267/boxing-schedule"
var minuteMs = 60 * 1000
var dayMs = 24 * 60 * minuteMs

// An event ESPN still hasn't marked final this long after its first bout is
// treated as over, so a stale feed can't pin a finished card to the bar.
var staleAfterMs = 18 * 60 * minuteMs

var glyphs = {
  glove: String.fromCodePoint(0xF0D8F),    // nf-md-mixed_martial_arts
  boxing: String.fromCodePoint(0xF0B65),   // nf-md-boxing_glove
  previous: String.fromCodePoint(0xF0141), // nf-md-chevron_left
  next: String.fromCodePoint(0xF0142),     // nf-md-chevron_right
  refresh: String.fromCodePoint(0xF0450),  // nf-md-refresh
  open: String.fromCodePoint(0xF03CC),     // nf-md-open_in_new
  date: String.fromCodePoint(0xF00ED),     // nf-md-calendar
  venue: String.fromCodePoint(0xF034E),    // nf-md-map_marker
  broadcast: String.fromCodePoint(0xF0502) // nf-md-television
}

var labelStyles = ["fighters", "icon"]
var segmentNames = ["Main Card", "Prelims", "Early Prelims"]

function pad2(n) {
  return (n < 10 ? "0" : "") + n
}

function utcDateKey(ms) {
  var d = new Date(ms)
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate())
}

// The window starts a day back so an event running past midnight UTC stays
// listed until ESPN marks it final.
function scoreboardUrl(nowMs, lookaheadDays) {
  var days = Math.max(7, Math.min(365, parseInt(lookaheadDays, 10) || 180))
  return scoreboardBase + "?limit=100&dates=" + utcDateKey(nowMs - dayMs) + "-" + utcDateKey(nowMs + days * dayMs)
}

// ESPN timestamps look like 2026-11-01T00:00Z, without seconds, which not
// every Date parser accepts.
function parseTime(value) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z$/.exec(String(value || ""))
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
}

// "UFC 334: Gane vs. Hokit" -> brand "UFC 334", headline "Gane vs. Hokit".
function splitName(name) {
  var text = String(name || "").trim()
  var colon = text.indexOf(":")
  if (colon < 0) return { brand: text, headline: "" }
  return { brand: text.slice(0, colon).trim(), headline: text.slice(colon + 1).trim() }
}

function lastName(athlete) {
  var short = String(athlete.shortName || "")
  var dot = short.indexOf(". ")
  if (dot > 0) return short.slice(dot + 2)
  var parts = String(athlete.displayName || "").trim().split(/\s+/)
  return parts[parts.length - 1] || ""
}

function fighter(competitor) {
  var c = competitor || {}
  var athlete = c.athlete || {}
  var records = Array.isArray(c.records) ? c.records : []
  var record = ""
  for (var i = 0; i < records.length; i++) {
    if (!records[i] || !records[i].summary) continue
    if (record === "" || records[i].type === "total") record = String(records[i].summary)
  }
  var name = String(athlete.displayName || athlete.fullName || "").trim()
  return {
    name: name || "TBA",
    lastName: name ? lastName(athlete) : "TBA",
    record: record,
    country: athlete.flag && athlete.flag.alt ? String(athlete.flag.alt) : "",
    winner: c.winner === true
  }
}

function parseFight(comp, index) {
  var competitors = (Array.isArray(comp.competitors) ? comp.competitors : []).slice()
  competitors.sort(function(a, b) { return (a.order || 0) - (b.order || 0) })
  var status = comp.status && comp.status.type ? comp.status.type : {}
  var regulation = comp.format && comp.format.regulation ? comp.format.regulation : {}
  return {
    id: String(comp.id || index),
    order: index,
    startMs: parseTime(comp.startDate || comp.date),
    weightClass: comp.type && comp.type.abbreviation ? String(comp.type.abbreviation) : "",
    rounds: parseInt(regulation.periods, 10) || 3,
    state: String(status.state || "pre"),
    red: fighter(competitors[0]),
    blue: fighter(competitors[1]),
    mainEvent: false
  }
}

function headlineMatches(fight, headline) {
  var text = headline.toLowerCase()
  return fight.red.lastName !== "TBA" && fight.blue.lastName !== "TBA"
    && text.indexOf(fight.red.lastName.toLowerCase()) >= 0
    && text.indexOf(fight.blue.lastName.toLowerCase()) >= 0
}

// ESPN lists bouts roughly in running order with the main event last, so the
// headline's fighters pick the main event and the last bout is the fallback.
function markMainEvent(fights, headline) {
  if (fights.length === 0) return
  var main = fights[fights.length - 1]
  for (var i = 0; headline && i < fights.length; i++) {
    if (headlineMatches(fights[i], headline)) main = fights[i]
  }
  main.mainEvent = true
}

// Bouts sharing a start time form a segment; the latest is the main card.
// Each segment lists its bouts top of the bill first.
function cardSegments(fights) {
  var times = []
  fights.forEach(function(f) {
    var key = isNaN(f.startMs) ? -1 : f.startMs
    if (times.indexOf(key) < 0) times.push(key)
  })
  times.sort(function(a, b) { return b - a })

  return times.map(function(time, i) {
    var bouts = fights.filter(function(f) { return (isNaN(f.startMs) ? -1 : f.startMs) === time })
    bouts.sort(function(a, b) {
      if (a.mainEvent !== b.mainEvent) return a.mainEvent ? -1 : 1
      return b.order - a.order
    })
    return {
      label: times.length === 1 ? "Fight Card" : segmentNames[Math.min(i, segmentNames.length - 1)],
      startMs: time < 0 ? NaN : time,
      fights: bouts
    }
  })
}

function broadcasts(comps) {
  var names = []
  comps.forEach(function(comp) {
    var list = Array.isArray(comp.broadcasts) ? comp.broadcasts : []
    list.forEach(function(b) {
      (Array.isArray(b.names) ? b.names : []).forEach(function(n) {
        if (n && names.indexOf(n) < 0) names.push(String(n))
      })
    })
    if (comp.broadcast && names.indexOf(comp.broadcast) < 0) names.push(String(comp.broadcast))
  })
  return names
}

function eventUrl(ev) {
  var links = Array.isArray(ev.links) ? ev.links : []
  for (var i = 0; i < links.length; i++) {
    var rel = Array.isArray(links[i].rel) ? links[i].rel : []
    if (rel.indexOf("event") >= 0 && /^https:\/\//.test(String(links[i].href || ""))) return String(links[i].href)
  }
  return "https://www.espn.com/mma/fightcenter/_/id/" + encodeURIComponent(String(ev.id || "")) + "/league/ufc"
}

function parseEvent(ev) {
  var comps = Array.isArray(ev.competitions) ? ev.competitions : []
  var names = splitName(ev.name)
  var fights = comps.map(parseFight)
  markMainEvent(fights, names.headline)
  var segments = cardSegments(fights)

  var status = ev.status && ev.status.type ? ev.status.type : {}
  var venue = (comps[0] && comps[0].venue) || (Array.isArray(ev.venues) && ev.venues[0]) || {}
  var address = venue.address || {}
  var place = [address.city, address.state || address.country].filter(function(p) { return !!p })

  var startMs = parseTime(ev.date)
  fights.forEach(function(f) {
    if (!isNaN(f.startMs) && (isNaN(startMs) || f.startMs < startMs)) startMs = f.startMs
  })
  var mainCardMs = segments.length > 0 && !isNaN(segments[0].startMs) ? segments[0].startMs : startMs

  return {
    id: String(ev.id || ""),
    name: String(ev.name || "UFC"),
    brand: names.brand || "UFC",
    headline: names.headline,
    startMs: startMs,
    mainCardMs: mainCardMs,
    state: String(status.state || "pre"),
    completed: status.completed === true,
    venue: venue.fullName ? String(venue.fullName) : "",
    location: place.join(", "),
    broadcasts: broadcasts(comps),
    url: eventUrl(ev),
    segments: segments,
    fightCount: fights.length
  }
}

// Returns null (not []) when the response is unusable, so callers can keep
// the last good schedule instead of blanking it.
function parseScoreboard(raw) {
  var data
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw
  } catch (e) {
    return null
  }
  if (!data || !Array.isArray(data.events)) return null
  return data.events
    .map(parseEvent)
    .filter(function(e) { return !e.completed && e.state !== "post" && !isNaN(e.startMs) })
    .sort(function(a, b) { return a.startMs - b.startMs })
}

function isLive(event, nowMs) {
  if (!event) return false
  return event.state === "in" || (nowMs >= event.startMs && event.state !== "post")
}

function upcoming(events, nowMs) {
  return (events || []).filter(function(e) {
    return e.state === "in" || nowMs < e.startMs + staleAfterMs
  })
}

function parts(diffMs) {
  var minutes = Math.max(0, Math.floor(diffMs / minuteMs))
  return { days: Math.floor(minutes / 1440), hours: Math.floor(minutes % 1440 / 60), minutes: minutes % 60 }
}

// Compact countdown for the bar: "6d", "5h", "12m".
function countdown(targetMs, nowMs) {
  var diff = targetMs - nowMs
  if (isNaN(diff)) return ""
  if (diff < minuteMs) return "now"
  var p = parts(diff)
  if (p.days > 0) return p.days + "d"
  if (p.hours > 0) return p.hours + "h"
  return p.minutes + "m"
}

// Two-unit countdown for the panel: "6d 8h", "5h 12m", "12m".
function countdownLong(targetMs, nowMs) {
  var diff = targetMs - nowMs
  if (isNaN(diff)) return ""
  if (diff < minuteMs) return "now"
  var p = parts(diff)
  if (p.days > 0) return p.days + "d " + p.hours + "h"
  if (p.hours > 0) return p.hours + "h " + p.minutes + "m"
  return p.minutes + "m"
}

function fightersLabel(event) {
  if (event.headline) return event.headline
  var main = mainEvent(event)
  return main ? main.red.lastName + " vs. " + main.blue.lastName : event.brand
}

function mainEvent(event) {
  if (!event) return null
  for (var i = 0; i < event.segments.length; i++) {
    for (var j = 0; j < event.segments[i].fights.length; j++) {
      if (event.segments[i].fights[j].mainEvent) return event.segments[i].fights[j]
    }
  }
  return null
}

// 1.1 called the icon style "badge"; anything else unknown falls back to the
// fighters.
function labelStyle(value) {
  return value === "icon" || value === "badge" ? "icon" : "fighters"
}

// The icon style is the glove alone, so only the fighters style has text.
function barLabel(event, nowMs, style) {
  if (!event || labelStyle(style) === "icon") return ""
  var when = isLive(event, nowMs) ? "LIVE" : countdown(event.mainCardMs, nowMs)
  return fightersLabel(event) + " · " + when
}

// The countdown pill runs to the main card, the time the event is billed for.
function statusText(event, nowMs) {
  if (!event) return ""
  if (isLive(event, nowMs)) return nowMs < event.mainCardMs ? "Live · prelims" : "Live now"
  return "In " + countdownLong(event.mainCardMs, nowMs)
}

// "locale" defers to the system's short time format, which may be 12-hour
// even when the bar clock is set to 24-hour.
function timeFormat(clock, localeFormat) {
  if (clock === "24h") return "HH:mm"
  if (clock === "12h") return "h:mm AP"
  return localeFormat || "HH:mm"
}

function cornerDetail(f) {
  return [f.record, f.country].filter(function(p) { return !!p }).join(" · ")
}

// ---------- boxing ----------

var sports = ["ufc", "one", "boxing"]
var boxingScopes = ["big", "titles", "all", "off"]
var monthIndex = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
var monthAnchors = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

// A card stays listed until midday UTC the day after its date, which covers
// evening shows in the Americas for viewers ahead of them.
var boxingStaleAfterMs = 36 * 60 * minuteMs

var entities = {
  amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " ",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—"
}

function decodeEntities(text) {
  return String(text || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function(all, name) {
    if (name.charAt(0) === "#") {
      var hex = name.charAt(1) === "x" || name.charAt(1) === "X"
      var code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : all
    }
    var key = name.toLowerCase()
    return entities.hasOwnProperty(key) ? entities[key] : all
  })
}

function plainText(html) {
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

function sport(value) {
  return sports.indexOf(value) >= 0 ? value : "ufc"
}

function boxingScope(value) {
  return boxingScopes.indexOf(value) >= 0 ? value : "big"
}

// The story gives "Oct. 31" with no year. The year is whichever puts the date
// nearest the story's publication, so January follows December.
function nearestDate(month, day, referenceMs) {
  var year = new Date(referenceMs).getUTCFullYear()
  var best = NaN
  for (var y = year - 1; y <= year + 1; y++) {
    var ms = Date.UTC(y, month, day)
    if (new Date(ms).getUTCDate() !== day) return NaN
    if (isNaN(best) || Math.abs(ms - referenceMs) < Math.abs(best - referenceMs)) best = ms
  }
  return best
}

// "Oct. 31: Riyadh, Saudi Arabia (DAZN PPV)" -> the date, place and channel.
function parseCardHeading(text, referenceMs) {
  var m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*:\s*(.+)$/.exec(plainText(text))
  if (!m) return null
  var month = monthIndex[m[1].slice(0, 3).toLowerCase()]
  if (month === undefined) return null
  var dayMs = nearestDate(month, parseInt(m[2], 10), referenceMs)
  if (isNaN(dayMs)) return null

  var place = m[3].trim()
  var broadcast = ""
  var channel = /\(([^()]*)\)\s*$/.exec(place)
  if (channel) {
    broadcast = channel[1].trim()
    place = place.slice(0, channel.index).trim()
  }
  return { dayMs: dayMs, location: place, broadcasts: broadcast ? [broadcast] : [] }
}

function boxer(name) {
  var text = String(name || "").trim()
  if (!text || /^tba$/i.test(text)) return { name: "TBA", lastName: "TBA", record: "", country: "", winner: false }
  var parts = text.split(/\s+/)
  var last = parts[parts.length - 1]
  if (parts.length > 2 && /^(jr|sr|ii|iii|iv)\.?$/i.test(last)) last = parts[parts.length - 2] + " " + last
  return { name: text, lastName: last, record: "", country: "", winner: false }
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// "Title fight: Canelo Alvarez vs. Christian Mbilli, 12 rounds, for Mbilli's
// WBC super middleweight title". The story is typed by hand, so "12 rouns"
// and "8. rounds" turn up and the parse stays loose.
function parseBout(html, index) {
  var text = plainText(html)
  var titleFight = false
  text = text.replace(/^title fight\s*:\s*/i, function() {
    titleFight = true
    return ""
  })
  var vs = /\s+vs\.?\s+/i.exec(text)
  if (!vs) return null

  var after = text.slice(vs.index + vs[0].length)
  var comma = after.indexOf(",")
  var rest = comma < 0 ? "" : after.slice(comma + 1).trim()
  var rounds = 0
  var r = /^(\d+)\.?\s*roun\w*\s*,?\s*/i.exec(rest)
  if (r) {
    rounds = parseInt(r[1], 10)
    rest = rest.slice(r[0].length)
  }
  rest = rest.replace(/\.\s*$/, "").trim()

  var belt = /^for\s+/i.test(rest) ? capitalize(rest.replace(/^for\s+(the\s+)?/i, "")) : ""
  return {
    id: String(index),
    order: index,
    red: boxer(text.slice(0, vs.index)),
    blue: boxer(comma < 0 ? after : after.slice(0, comma)),
    rounds: rounds,
    titleFight: titleFight,
    belt: belt,
    weightClass: belt ? "" : capitalize(rest.replace(/weights$/i, "weight")),
    mainEvent: false
  }
}

function sameBout(a, b) {
  return a.red.lastName === b.red.lastName && a.blue.lastName === b.blue.lastName
}

function cardKey(heading) {
  return heading.dayMs + "|" + heading.location.toLowerCase()
}

function newCard(heading) {
  var d = new Date(heading.dayMs)
  return {
    id: cardKey(heading),
    sport: "boxing",
    dayMs: heading.dayMs,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    location: heading.location,
    broadcasts: heading.broadcasts,
    url: boxingPageUrl + "#" + monthAnchors[d.getUTCMonth()],
    fights: [],
    headline: "",
    big: false,
    titleFight: false,
    fightCount: 0
  }
}

// ESPN lists each card top of the bill first, so the first bout headlines
// unless the key dates name a different one.
function finishCard(card, keyBout) {
  var main = card.fights[0] || null
  card.fights.forEach(function(f) {
    if (keyBout && sameBout(f, keyBout)) main = f
    if (f.titleFight) card.titleFight = true
  })
  if (main) {
    main.mainEvent = true
    card.headline = main.red.lastName + " vs. " + main.blue.lastName
    card.fights = [main].concat(card.fights.filter(function(f) { return f !== main }))
  }
  card.fightCount = card.fights.length
  return card
}

function listItems(html) {
  var items = []
  var re = /<li[^>]*>([\s\S]*?)<\/li>/gi
  var m
  while ((m = re.exec(html)) !== null) items.push(m[1])
  return items
}

// The "Key dates" list is ESPN's pick of the big fights: one line per card,
// "<b>Oct. 31: Riyadh (DAZN PPV)</b> -- Title fight: Alvarez vs. Mbilli…".
function parseKeyDates(story, referenceMs) {
  var start = story.search(/<h2[^>]*>\s*Key dates/i)
  if (start < 0) return []
  var end = story.indexOf("<h2", story.indexOf("</h2>", start))
  var section = story.slice(start, end < 0 ? story.length : end)
  var out = []
  listItems(section).forEach(function(item) {
    var m = /<b>([\s\S]*?)<\/b>\s*(?:--|–|—)?\s*([\s\S]*)$/i.exec(item)
    var heading = m ? parseCardHeading(m[1], referenceMs) : null
    var bout = m ? parseBout(m[2], 0) : null
    if (heading && bout) out.push({ heading: heading, bout: bout })
  })
  return out
}

// Returns null (not []) when the response is unusable or no card could be
// read, so a format change on ESPN's side shows as an error, not as an
// empty schedule.
function parseBoxingSchedule(raw, nowMs) {
  var data
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw
  } catch (e) {
    return null
  }
  var story = data && Array.isArray(data.headlines) && data.headlines[0] ? data.headlines[0] : null
  if (!story || typeof story.story !== "string") return null

  var referenceMs = parseTime(story.lastModified || story.published)
  if (isNaN(referenceMs)) referenceMs = nowMs
  var html = story.story
  var cards = {}
  var order = []

  var re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|<h2|$)/gi
  var m
  while ((m = re.exec(html)) !== null) {
    var heading = parseCardHeading(m[1], referenceMs)
    if (!heading) continue
    var key = cardKey(heading)
    if (!cards[key]) {
      cards[key] = newCard(heading)
      order.push(key)
    }
    listItems(m[2]).forEach(function(item) {
      var bout = parseBout(item, cards[key].fights.length)
      if (bout) cards[key].fights.push(bout)
    })
  }

  var keyBouts = {}
  parseKeyDates(html, referenceMs).forEach(function(k) {
    var key = cardKey(k.heading)
    if (!cards[key]) {
      cards[key] = newCard(k.heading)
      cards[key].fights.push(k.bout)
      order.push(key)
    }
    cards[key].big = true
    keyBouts[key] = k.bout
  })

  var list = order.map(function(key) { return finishCard(cards[key], keyBouts[key] || null) })
  if (list.length === 0) return null
  return list.sort(function(a, b) { return a.dayMs - b.dayMs })
}

// "big" is ESPN's key dates. If the story ever drops that list, title fights
// stand in rather than the tab going empty.
function boxingCards(cards, scope, nowMs) {
  var s = boxingScope(scope)
  if (s === "off") return []
  var upcomingCards = (cards || []).filter(function(c) { return nowMs < c.dayMs + boxingStaleAfterMs })
  if (s === "all") return upcomingCards
  var anyBig = (cards || []).some(function(c) { return c.big })
  return upcomingCards.filter(function(c) { return s === "big" && anyBig ? c.big : c.titleFight })
}

// Calendar days from the viewer's today to the card's date. Fight dates are
// local to the venue, so the comparison is by date, not by instant.
function daysUntil(card, nowMs) {
  var d = new Date(nowMs)
  var today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((card.dayMs - today) / dayMs)
}

// Yesterday's date still reads "Fight night": a Saturday show in the US runs
// into Sunday for anyone east of it.
function boxingStatus(card, nowMs) {
  if (!card) return ""
  var days = daysUntil(card, nowMs)
  if (days <= 0) return "Fight night"
  if (days === 1) return "Tomorrow"
  return "In " + days + " days"
}

// A local-midnight Date for Qt.formatDate, so the weekday is the card's.
function cardDate(card) {
  return new Date(card.year, card.month, card.day)
}

function boutRounds(fight) {
  return fight.rounds > 0 ? fight.rounds + " RDS" : ""
}

// The tag under "vs": a boxing bout's rounds, a ONE bout's discipline.
function boutTag(fight) {
  return fight.discipline ? fight.discipline.toUpperCase() : boutRounds(fight)
}

function boutNote(fight) {
  var note = fight.belt || fight.weightClass
  if (fight.result) note += (note ? " · " : "") + fight.result
  return note
}

function boutAccent(fight) {
  return !!fight.belt || fight.titleFight === true
}

// ---------- ONE Championship ----------

// ONE's own schedule page. Its event pages carry the fight cards, and
// results once bouts finish.
var oneScheduleUrl = "https://www.onefc.com/events/"
var oneScopes = ["all", "big", "off"]
var oneDisciplines = [["submission grappling", "Grappling"], ["muay thai", "Muay Thai"], ["kickboxing", "Kickboxing"], ["mma", "MMA"]]

// A ONE card runs three to five hours: it counts as live for six, and drops
// off the schedule after eight.
var oneLiveMs = 6 * 60 * minuteMs
var oneStaleAfterMs = 8 * 60 * minuteMs

function oneScope(value) {
  return oneScopes.indexOf(value) >= 0 ? value : "all"
}

function tidyVersus(text) {
  return String(text || "").replace(/\s+vs\.?\s+/gi, " vs. ")
}

// "ONE Fight Night 49: Gabriel Vs. Magomedov" splits like a UFC name, but
// "ONE: Qatar" is just a name.
function oneName(name) {
  var parts = splitName(name)
  if (!/\svs\.?\s/i.test(parts.headline)) return { brand: name, headline: "" }
  return { brand: parts.brand, headline: tidyVersus(parts.headline) }
}

// Returns null when the page has no upcoming section, so a redesign shows
// as an error rather than an empty schedule.
function parseOneSchedule(raw) {
  var html = String(raw || "")
  var start = html.indexOf('id="upcoming-events-section"')
  if (start < 0) return null
  var end = html.indexOf('<a id="past"', start)
  var section = html.slice(start, end < 0 ? html.length : end)
  var chunks = section.split('<div class="simple-post-card is-event')
  var out = []
  for (var i = 1; i < chunks.length; i++) {
    var link = /<a class="title" href="(https:\/\/www\.onefc\.com\/events\/[^"]+)"[^>]*>\s*<h3>([\s\S]*?)<\/h3>/.exec(chunks[i])
    var stamp = /data-timestamp="(\d+)"/.exec(chunks[i])
    if (!link || !stamp) continue
    var place = /class="location">([\s\S]*?)<\/div>/.exec(chunks[i])
    var name = plainText(link[2])
    var names = oneName(name)
    out.push({
      id: link[1],
      sport: "one",
      name: name,
      brand: names.brand,
      headline: names.headline,
      startMs: parseInt(stamp[1], 10) * 1000,
      location: place ? plainText(place[1]) : "",
      broadcasts: [],
      url: link[1],
      big: !/friday fights/i.test(name)
    })
  }
  return out.sort(function(a, b) { return a.startMs - b.startMs })
}

function oneCorner(face, name) {
  var sticker = /class="sticker([^"]*)">([\s\S]*?)<\/div>/.exec(face || "")
  var method = sticker ? /<span class="opacity-50 d-none[^"]*">([\s\S]*?)<\/span>/.exec(sticker[2]) : null
  return {
    winner: !!sticker && /\bis-win\b/.test(sticker[1]),
    method: method ? plainText(method[1]) : (sticker ? plainText(sticker[2]) : "")
  }
}

function oneFighter(name, short, country, winner) {
  var full = plainText(name)
  return {
    name: full || "TBA",
    lastName: plainText(short) || (full ? boxer(full).lastName : "TBA"),
    record: "",
    country: plainText(country),
    winner: winner
  }
}

// "Bantamweight Kickboxing World Championship" -> discipline "Kickboxing",
// weight class "Bantamweight World Championship", a title fight.
function oneBout(block, index) {
  var title = plainText((/class="title">([\s\S]*?)<\/div>/.exec(block) || [])[1])
  var versus = plainText((/class="versus">([\s\S]*?)<\/div>/.exec(block) || [])[1]).split(/\s+vs\.?\s+/i)
  var names = []
  var re = /<td>\s*<a [^>]*title="([^"]*)"/g
  var m
  while ((m = re.exec(block)) !== null) names.push(m[1])
  var countries = /<td>([^<]*)<\/td>\s*<th>\s*Country\s*<\/th>\s*<td>([^<]*)<\/td>/.exec(block) || ["", "", ""]
  var face1 = block.indexOf('class="face face1"')
  var face2 = block.indexOf('class="face face2"')
  var stats = block.indexOf('class="stats"')
  var c1 = oneCorner(face1 >= 0 ? block.slice(face1, face2 >= 0 ? face2 : stats) : "")
  var c2 = oneCorner(face2 >= 0 ? block.slice(face2, stats >= 0 ? stats : block.length) : "")

  var discipline = ""
  var lower = title.toLowerCase()
  for (var i = 0; i < oneDisciplines.length; i++) {
    if (lower.indexOf(oneDisciplines[i][0]) >= 0) {
      discipline = oneDisciplines[i][1]
      title = title.replace(new RegExp("\\s*" + oneDisciplines[i][0], "i"), "")
      break
    }
  }
  var red = oneFighter(names[0], versus[0], countries[1], c1.winner)
  var blue = oneFighter(names[1], versus[1], countries[2], c2.winner)
  var winner = red.winner ? red : (blue.winner ? blue : null)
  var method = winner === red ? c1.method : (winner === blue ? c2.method : (c1.method || c2.method))
  return {
    id: String(index),
    order: index,
    red: red,
    blue: blue,
    discipline: discipline,
    weightClass: title.trim(),
    titleFight: /world (championship|title)/i.test(title),
    belt: "",
    rounds: 0,
    result: winner ? winner.lastName + " · " + method : method,
    mainEvent: index === 0
  }
}

// The bouts on an event page, main event first. Returns null when the
// response isn't one of ONE's pages at all.
function parseOneCard(raw) {
  var html = String(raw || "")
  if (html.indexOf("onefc.com") < 0) return null
  var blocks = html.split(/<div class="event-matchup[^"]*">/)
  var bouts = []
  for (var i = 1; i < blocks.length; i++) bouts.push(oneBout(blocks[i], i - 1))
  return bouts
}

function oneEvents(events, scope, nowMs) {
  var s = oneScope(scope)
  if (s === "off") return []
  return (events || []).filter(function(e) {
    return nowMs < e.startMs + oneStaleAfterMs && (s === "all" || e.big)
  })
}

function oneLive(event, nowMs) {
  return !!event && nowMs >= event.startMs && nowMs < event.startMs + oneLiveMs
}

function oneStatus(event, nowMs) {
  if (!event) return ""
  if (oneLive(event, nowMs)) return "Live now"
  return "In " + countdownLong(event.startMs, nowMs)
}

// The small line over the headline: the brand when the name carries the
// headliners, the event's full name once its card supplies them, and the
// promotion while neither is known.
function oneCaption(event, bouts) {
  if (!event) return "ONE Championship"
  if (event.headline) return event.brand
  return bouts && bouts.length > 0 ? event.name : "ONE Championship"
}

function oneHeadline(event, bouts) {
  if (!event) return ""
  if (event.headline) return event.headline
  var main = bouts && bouts[0]
  return main ? main.red.lastName + " vs. " + main.blue.lastName : ""
}

// A card is fetched when it's first shown, then again every 15 minutes, or
// every 2 while the event is live so results come through.
function oneCardStale(entry, event, nowMs) {
  if (!entry) return true
  var age = nowMs - entry.fetchedAt
  if (entry.failed) return age > minuteMs
  return age > (oneLive(event, nowMs) ? 2 : 15) * minuteMs
}

if (typeof module !== "undefined") {
  module.exports = {
    glyphs: glyphs,
    labelStyles: labelStyles,
    staleAfterMs: staleAfterMs,
    scoreboardUrl: scoreboardUrl,
    parseTime: parseTime,
    splitName: splitName,
    parseScoreboard: parseScoreboard,
    isLive: isLive,
    upcoming: upcoming,
    countdown: countdown,
    countdownLong: countdownLong,
    mainEvent: mainEvent,
    labelStyle: labelStyle,
    barLabel: barLabel,
    statusText: statusText,
    timeFormat: timeFormat,
    cornerDetail: cornerDetail,
    sports: sports,
    boxingScopes: boxingScopes,
    boxingStoryUrl: boxingStoryUrl,
    decodeEntities: decodeEntities,
    plainText: plainText,
    sport: sport,
    boxingScope: boxingScope,
    nearestDate: nearestDate,
    parseCardHeading: parseCardHeading,
    parseBout: parseBout,
    parseBoxingSchedule: parseBoxingSchedule,
    boxingCards: boxingCards,
    daysUntil: daysUntil,
    boxingStatus: boxingStatus,
    cardDate: cardDate,
    boutRounds: boutRounds,
    boutTag: boutTag,
    boutNote: boutNote,
    boutAccent: boutAccent,
    oneScheduleUrl: oneScheduleUrl,
    oneScopes: oneScopes,
    oneScope: oneScope,
    oneName: oneName,
    parseOneSchedule: parseOneSchedule,
    parseOneCard: parseOneCard,
    oneEvents: oneEvents,
    oneLive: oneLive,
    oneStatus: oneStatus,
    oneCaption: oneCaption,
    oneHeadline: oneHeadline,
    oneCardStale: oneCardStale
  }
}
