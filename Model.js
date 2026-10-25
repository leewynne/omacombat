// ESPN's public UFC scoreboard, shaped into what the bar pill and the
// fight-card panel need. Pure functions only: the QML owns fetching and
// timers, so everything here runs under node for the tests.

var scoreboardBase = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"
var minuteMs = 60 * 1000
var dayMs = 24 * 60 * minuteMs

// An event ESPN still hasn't marked final this long after its first bout is
// treated as over, so a stale feed can't pin a finished card to the bar.
var staleAfterMs = 18 * 60 * minuteMs

var glyphs = {
  glove: String.fromCodePoint(0xF0D8F),    // nf-md-mixed_martial_arts
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
    cornerDetail: cornerDetail
  }
}
