import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Arcade.js" as Arcade

// Fetches the UFC and boxing schedules from ESPN and ONE Championship's from
// onefc.com, and shows one fight card at a time. UFC is the default; the
// switch at the top (or u/o/b) changes sport. The arrows (or h/l) step
// through upcoming events; Return opens the event's page.
Panel {
  id: root
  moduleName: "leewynne.omacombat"
  manageIpc: false

  property var anchorItem: null

  // The bar identifies an open panel by the widget in its slot, so the
  // popout coordinator and Tab switching have to see BarWidget.qml, not this.
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  // Last good schedule. A failed refresh keeps it so the card never blanks.
  property var events: []
  property bool loaded: false
  property bool failed: false
  property real fetchedAt: 0
  property real now: Date.now()
  property int index: 0
  property int retries: 0
  property string sport: "ufc"

  // Boxing keeps its own last good schedule, kept the same way.
  property var boxingAll: []
  property bool boxingLoaded: false
  property bool boxingFailed: false
  property real boxingFetchedAt: 0
  property int boxingIndex: 0
  property int boxingRetries: 0

  // ONE's schedule, plus each event's card as it's fetched, by page URL.
  property var oneAll: []
  property bool oneLoaded: false
  property bool oneFailed: false
  property real oneFetchedAt: 0
  property int oneIndex: 0
  property int oneRetries: 0
  property var oneCards: ({})
  property string oneCardUrl: ""

  // ↑ ↑ ↓ ↓ ← → ← → B A opens Yie Ar Kung-Fu in place of the fight card.
  property var konami: []
  property bool arcadeOn: false
  property real arcadeHiScore: 0
  property bool arcadeMuted: false

  readonly property var schedule: Model.upcoming(events, now)
  readonly property var nextEvent: schedule.length > 0 ? schedule[0] : null
  readonly property var event: schedule.length > 0 ? schedule[Math.max(0, Math.min(index, schedule.length - 1))] : null
  readonly property bool nextLive: Model.isLive(nextEvent, now)
  readonly property string labelStyle: Model.labelStyle(String(setting("label", "fighters")))
  readonly property int refreshMinutes: Math.max(5, parseInt(setting("refreshMinutes", 30), 10) || 30)
  readonly property string timeFormat: Model.timeFormat(String(setting("clock", "locale")), Qt.locale().timeFormat(Locale.ShortFormat))

  readonly property string boxingScope: Model.boxingScope(String(setting("boxing", "big")))
  readonly property bool boxingEnabled: boxingScope !== "off"
  readonly property var boxingSchedule: Model.boxingCards(boxingAll, boxingScope, now)
  readonly property var card: boxingSchedule.length > 0 ? boxingSchedule[Math.max(0, Math.min(boxingIndex, boxingSchedule.length - 1))] : null

  readonly property string oneScope: Model.oneScope(String(setting("one", "all")))
  readonly property bool oneEnabled: oneScope !== "off"
  readonly property var oneSchedule: Model.oneEvents(oneAll, oneScope, now)
  readonly property var oneEvent: oneSchedule.length > 0 ? oneSchedule[Math.max(0, Math.min(oneIndex, oneSchedule.length - 1))] : null
  readonly property var oneEntry: oneEvent ? (oneCards[oneEvent.url] || null) : null
  readonly property var oneBouts: oneEntry ? oneEntry.bouts : null

  readonly property var sportOptions: {
    var options = [{ value: "ufc", label: "UFC", tooltip: "UFC (u)" }]
    if (oneEnabled) options.push({ value: "one", label: "ONE", tooltip: "ONE Championship (o)" })
    if (boxingEnabled) options.push({ value: "boxing", label: "Boxing", tooltip: "Boxing (b)" })
    return options
  }

  // What the panel is showing: the UFC event, the ONE event or the boxing
  // card.
  readonly property bool onBoxing: sport === "boxing" && boxingEnabled
  readonly property bool onOne: sport === "one" && oneEnabled
  readonly property var current: onBoxing ? card : (onOne ? oneEvent : event)
  readonly property var currentList: onBoxing ? boxingSchedule : (onOne ? oneSchedule : schedule)
  readonly property int currentIndex: Math.min(onBoxing ? boxingIndex : (onOne ? oneIndex : index), currentList.length - 1)
  readonly property bool currentLive: onBoxing ? (card !== null && Model.daysUntil(card, now) <= 0)
    : (onOne ? Model.oneLive(oneEvent, now) : Model.isLive(event, now))
  readonly property bool currentFailed: onBoxing ? boxingFailed : (onOne ? oneFailed : failed)
  readonly property bool currentLoaded: onBoxing ? boxingLoaded : (onOne ? oneLoaded : loaded)
  readonly property real currentFetchedAt: onBoxing ? boxingFetchedAt : (onOne ? oneFetchedAt : fetchedAt)
  readonly property string currentHeadline: !current ? ""
    : (onOne ? (Model.oneHeadline(oneEvent, oneBouts) || oneEvent.name) : (current.headline || current.name))

  readonly property string label: Model.barLabel(nextEvent, now, labelStyle)
  readonly property var nextOne: oneSchedule.length > 0 ? oneSchedule[0] : null
  readonly property var nextBoxing: boxingSchedule.length > 0 ? boxingSchedule[0] : null
  readonly property string tooltip: (nextEvent
    ? nextEvent.name + "\n" + formatDay(nextEvent.mainCardMs) + " · " + formatTime(nextEvent.mainCardMs)
    : (failed ? "Couldn't reach ESPN" : "OmaCombat"))
    + (nextOne ? "\n\nONE: " + nextOne.name + "\n" + formatDay(nextOne.startMs) + " · " + formatTime(nextOne.startMs) : "")
    + (nextBoxing ? "\n\nBoxing: " + nextBoxing.headline + "\n" + formatDay(Model.cardDate(nextBoxing).getTime()) : "")

  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color dim: Qt.darker(barForeground, 1.4)
  readonly property color live: bar ? bar.urgent : Color.urgent

  function open() {
    index = 0
    boxingIndex = 0
    oneIndex = 0
    sport = "ufc"
    konami = []
    arcadeOn = false
    now = Date.now()
    cardScroll.contentY = 0
    root.controller.show()
    if (Date.now() - fetchedAt > 5 * 60 * 1000) refreshUfc()
    if (Date.now() - boxingFetchedAt > 30 * 60 * 1000) refreshBoxing()
    if (Date.now() - oneFetchedAt > 30 * 60 * 1000) refreshOne()
  }

  function openSport(name) {
    if (!root.opened) open()
    showSport(name)
  }

  function showSport(name) {
    var next = Model.sport(name)
    if (next === "boxing" && !boxingEnabled) return
    if (next === "one" && !oneEnabled) return
    if (next === sport) return
    sport = next
    cardScroll.contentY = 0
    ensureOneCard()
  }

  function close() {
    arcadeOn = false
    root.controller.hide()
  }

  function konamiKey(token) {
    var r = Arcade.konamiStep(konami, token)
    konami = r.buffer
    if (r.matched) openArcade()
  }

  function openArcade() {
    if (!root.opened) open()
    konami = []
    arcadeOn = true
  }

  function closeArcade() {
    arcadeOn = false
    cardScroll.contentY = 0
    keyCatcher.forceActiveFocus()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function step(delta) {
    if (currentList.length === 0) return
    var next = Math.max(0, Math.min(currentList.length - 1, currentIndex + delta))
    if (onBoxing) boxingIndex = next
    else if (onOne) oneIndex = next
    else index = next
    cardScroll.contentY = 0
    ensureOneCard()
  }

  function scroll(direction) {
    var max = Math.max(0, cardScroll.contentHeight - cardScroll.height)
    cardScroll.contentY = Math.max(0, Math.min(max, cardScroll.contentY + direction * Style.space(48)))
  }

  function openEvent(target) {
    var ev = target || root.current
    if (!ev) return
    Quickshell.execDetached(["omarchy-launch-browser", ev.url])
    root.close()
  }

  function refresh() {
    refreshUfc()
    refreshBoxing()
    refreshOne()
    if (onOne && oneEvent) fetchOneCard(oneEvent.url)
  }

  function refreshOne() {
    oneRetries = 0
    fetchOne()
  }

  function fetchOne() {
    if (!oneEnabled || oneProc.running) return
    oneProc.command = ["curl", "-fsSL", "--compressed", "--max-time", "20", "-A", "OmaCombat (Omarchy plugin)", Model.oneScheduleUrl]
    oneProc.running = true
  }

  function scheduleOneRetry() {
    if (oneRetries >= 3) return
    oneRetries++
    oneRetryTimer.restart()
  }

  // Cards are fetched for the ONE event on show, one page at a time.
  function ensureOneCard() {
    if (!onOne || !oneEvent || !root.opened) return
    if (Model.oneCardStale(oneEntry, oneEvent, Date.now())) fetchOneCard(oneEvent.url)
  }

  function fetchOneCard(url) {
    if (oneCardProc.running) return
    oneCardUrl = url
    oneCardProc.command = ["curl", "-fsSL", "--compressed", "--max-time", "20", "-A", "OmaCombat (Omarchy plugin)", url]
    oneCardProc.running = true
  }

  function storeOneCard(url, bouts) {
    var next = {}
    for (var k in oneCards) next[k] = oneCards[k]
    var last = oneCards[url]
    next[url] = {
      bouts: bouts === null ? (last ? last.bouts : null) : bouts,
      failed: bouts === null,
      fetchedAt: Date.now()
    }
    oneCards = next
  }

  function oneEmptyText() {
    if (oneScope === "big") return "No big ONE events on the schedule right now."
    return "ONE's schedule is empty right now."
  }

  function refreshUfc() {
    retries = 0
    fetch()
  }

  function refreshBoxing() {
    boxingRetries = 0
    fetchBoxing()
  }

  function fetch() {
    if (fetchProc.running) return
    fetchProc.command = ["curl", "-fsS", "--compressed", "--max-time", "15", Model.scoreboardUrl(Date.now(), 180)]
    fetchProc.running = true
  }

  function fetchBoxing() {
    if (!boxingEnabled || boxingProc.running) return
    boxingProc.command = ["curl", "-fsS", "--compressed", "--max-time", "15", Model.boxingStoryUrl]
    boxingProc.running = true
  }

  function scheduleRetry() {
    if (retries >= 3) return
    retries++
    retryTimer.restart()
  }

  function scheduleBoxingRetry() {
    if (boxingRetries >= 3) return
    boxingRetries++
    boxingRetryTimer.restart()
  }

  function formatDay(ms) {
    return isNaN(ms) ? "" : Qt.formatDate(new Date(ms), "ddd d MMM")
  }

  function boxingEmptyText() {
    if (boxingScope === "big") return "No big fights on ESPN's boxing schedule right now."
    if (boxingScope === "titles") return "No title fights on ESPN's boxing schedule right now."
    return "ESPN's boxing schedule is empty right now."
  }

  function formatTime(ms) {
    return isNaN(ms) ? "" : Qt.formatTime(new Date(ms), timeFormat)
  }

  function segmentTitle(segment) {
    var when = isNaN(segment.startMs) ? "" : Qt.formatDate(new Date(segment.startMs), "ddd") + " " + formatTime(segment.startMs)
    return (segment.label + (when ? " · " + when : "")).toUpperCase()
  }

  Process {
    id: fetchProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var parsed = Model.parseScoreboard(String(text || ""))
        if (parsed === null) {
          root.failed = true
          root.scheduleRetry()
          return
        }
        root.events = parsed
        root.loaded = true
        root.failed = false
        root.retries = 0
        root.fetchedAt = Date.now()
        root.now = Date.now()
      }
    }
  }

  Process {
    id: boxingProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var parsed = Model.parseBoxingSchedule(String(text || ""), Date.now())
        if (parsed === null) {
          root.boxingFailed = true
          root.scheduleBoxingRetry()
          return
        }
        root.boxingAll = parsed
        root.boxingLoaded = true
        root.boxingFailed = false
        root.boxingRetries = 0
        root.boxingFetchedAt = Date.now()
        root.now = Date.now()
      }
    }
  }

  Process {
    id: oneProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var parsed = Model.parseOneSchedule(String(text || ""))
        if (parsed === null) {
          root.oneFailed = true
          root.scheduleOneRetry()
          return
        }
        root.oneAll = parsed
        root.oneLoaded = true
        root.oneFailed = false
        root.oneRetries = 0
        root.oneFetchedAt = Date.now()
        root.now = Date.now()
        root.ensureOneCard()
      }
    }
  }

  Process {
    id: oneCardProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.storeOneCard(root.oneCardUrl, Model.parseOneCard(String(text || "")))
        // Stepping on while this one loaded may have left another to fetch.
        Qt.callLater(root.ensureOneCard)
      }
    }
  }

  Timer {
    id: oneRetryTimer
    interval: 5000
    onTriggered: root.fetchOne()
  }

  Timer {
    interval: root.refreshMinutes * 60 * 1000
    running: root.oneEnabled
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refreshOne()
  }

  // While the ONE tab is up, keep its card fresh: results land every two
  // minutes during a live event.
  Timer {
    interval: 30 * 1000
    running: root.opened && root.onOne
    repeat: true
    onTriggered: root.ensureOneCard()
  }

  // ESPN occasionally drops a request; a few quick retries beat waiting out
  // the refresh interval with no schedule.
  Timer {
    id: retryTimer
    interval: 5000
    onTriggered: root.fetch()
  }

  Timer {
    id: boxingRetryTimer
    interval: 5000
    onTriggered: root.fetchBoxing()
  }

  // Poll faster while an event is live so results land on the card.
  Timer {
    interval: (root.nextLive ? 2 : root.refreshMinutes) * 60 * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refreshUfc()
  }

  // The boxing story carries no results, so it never needs the live pace.
  Timer {
    interval: root.refreshMinutes * 60 * 1000
    running: root.boxingEnabled
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refreshBoxing()
  }

  Timer {
    interval: 30 * 1000
    running: true
    repeat: true
    onTriggered: root.now = Date.now()
  }

  component InfoLine: Text {
    textFormat: Text.PlainText
    width: parent ? parent.width : 0
    horizontalAlignment: Text.AlignHCenter
    elide: Text.ElideRight
    color: root.dim
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
    visible: text !== ""
  }

  component Corner: Column {
    id: corner
    required property var fighter
    required property bool alignRight
    required property bool decided
    required property bool emphasized
    spacing: Style.space(1)

    Text {
      textFormat: Text.PlainText
      width: parent.width
      horizontalAlignment: corner.alignRight ? Text.AlignRight : Text.AlignLeft
      elide: Text.ElideRight
      text: corner.fighter.name
      color: corner.fighter.winner ? Color.accent : root.barForeground
      opacity: corner.decided && !corner.fighter.winner ? 0.5 : 1
      font.family: root.fontFamily
      font.pixelSize: corner.emphasized ? Style.font.title : Style.font.body
      font.bold: corner.emphasized || corner.fighter.winner
    }

    Text {
      textFormat: Text.PlainText
      width: parent.width
      horizontalAlignment: corner.alignRight ? Text.AlignRight : Text.AlignLeft
      elide: Text.ElideRight
      text: Model.cornerDetail(corner.fighter)
      visible: text !== ""
      color: root.dim
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  component FightRow: Item {
    id: row
    required property var modelData
    readonly property bool decided: modelData.red.winner || modelData.blue.winner
    readonly property real middleWidth: Style.space(104)

    width: parent ? parent.width : 0
    implicitHeight: Math.max(redCorner.implicitHeight, middle.implicitHeight) + Style.space(10)

    Corner {
      id: redCorner
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      width: (row.width - row.middleWidth) / 2
      fighter: row.modelData.red
      alignRight: false
      decided: row.decided
      emphasized: row.modelData.mainEvent
    }

    Column {
      id: middle
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.verticalCenter: parent.verticalCenter
      width: row.middleWidth
      spacing: Style.space(1)

      Text {
        textFormat: Text.PlainText
        width: parent.width
        horizontalAlignment: Text.AlignHCenter
        text: "vs"
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Text {
        textFormat: Text.PlainText
        width: parent.width
        horizontalAlignment: Text.AlignHCenter
        elide: Text.ElideRight
        text: row.modelData.weightClass.toUpperCase()
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.letterSpacing: 0.5
      }

      Text {
        textFormat: Text.PlainText
        width: parent.width
        horizontalAlignment: Text.AlignHCenter
        visible: row.modelData.rounds === 5
        text: "5 ROUNDS"
        color: Color.accent
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.letterSpacing: 0.5
      }
    }

    Corner {
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      width: (row.width - row.middleWidth) / 2
      fighter: row.modelData.blue
      alignRight: true
      decided: row.decided
      emphasized: row.modelData.mainEvent
    }
  }

  // A boxing or ONE bout: names, a tag under "vs" (rounds, or ONE's
  // discipline), and a line underneath for the title or weight class and,
  // once it's over, the result.
  component BoutRow: Column {
    id: bout
    required property var modelData
    readonly property real middleWidth: Style.space(104)
    readonly property bool decided: modelData.red.winner || modelData.blue.winner

    width: parent ? parent.width : 0
    topPadding: Style.space(5)
    bottomPadding: Style.space(5)
    spacing: Style.space(2)

    Item {
      width: parent.width
      height: Math.max(boutRed.implicitHeight, boutMiddle.implicitHeight)

      Corner {
        id: boutRed
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        width: (parent.width - bout.middleWidth) / 2
        fighter: bout.modelData.red
        alignRight: false
        decided: bout.decided
        emphasized: bout.modelData.mainEvent
      }

      Column {
        id: boutMiddle
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.verticalCenter: parent.verticalCenter
        width: bout.middleWidth
        spacing: Style.space(1)

        Text {
          textFormat: Text.PlainText
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: "vs"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          visible: text !== ""
          text: Model.boutTag(bout.modelData)
          color: bout.modelData.titleFight ? Color.accent : root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          font.letterSpacing: 0.5
        }
      }

      Corner {
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        width: (parent.width - bout.middleWidth) / 2
        fighter: bout.modelData.blue
        alignRight: true
        decided: bout.decided
        emphasized: bout.modelData.mainEvent
      }
    }

    Text {
      textFormat: Text.PlainText
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      wrapMode: Text.WordWrap
      visible: text !== ""
      text: Model.boutNote(bout.modelData)
      color: Model.boutAccent(bout.modelData) ? Color.accent : root.dim
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: false
    // Opening focuses this a beat later, so it must already be the arcade
    // when the insertCoin IPC opens straight into it.
    focusTarget: root.arcadeOn && arcadeLoader.item ? arcadeLoader.item : keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(460))
    contentHeight: root.arcadeOn
      ? panel.fittedContentHeight(arcadeLoader.item ? arcadeLoader.item.implicitHeight : Style.space(440), Style.space(680))
      : panel.fittedContentHeight(header.implicitHeight + cardColumn.implicitHeight + footer.implicitHeight + Style.space(24), Style.space(680))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // The arcade takes every key, releases included, while it's up.
      blocked: root.arcadeOn
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) {
        if (dx !== 0) root.step(dx)
        else root.scroll(dy)
        root.konamiKey(dx < 0 ? "left" : (dx > 0 ? "right" : (dy < 0 ? "up" : "down")))
      }
      onActivateRequested: root.openEvent()
      onTextKey: function(t) {
        if (t === "r") root.refresh()
        else if (t === "u") root.showSport("ufc")
        else if (t === "o") root.showSport("one")
        else if (t === "b") root.showSport("boxing")
        root.konamiKey(t.toLowerCase())
      }

      Loader {
        id: arcadeLoader
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        active: root.arcadeOn
        source: Qt.resolvedUrl("Arcade.qml")
        onLoaded: {
          item.fontFamily = root.fontFamily
          item.foreground = root.barForeground
          item.dim = root.dim
          item.hiScore = root.arcadeHiScore
          item.muted = root.arcadeMuted
          item.forceActiveFocus()
          // Again once the key that typed the code has finished dispatching.
          Qt.callLater(function() { if (arcadeLoader.item) arcadeLoader.item.forceActiveFocus() })
        }
      }

      Connections {
        target: arcadeLoader.item
        function onExitRequested() { root.closeArcade() }
        function onHiScoreReached(score) { root.arcadeHiScore = score }
        function onMutedToggled(muted) { root.arcadeMuted = muted }
      }

      // A hidden window leaves its items "visible", so the game clock stops
      // on the panel's own state, whichever way it was closed.
      Binding {
        target: arcadeLoader.item
        property: "running"
        value: root.opened
        when: arcadeLoader.item !== null
      }

      Column {
        id: header
        visible: !root.arcadeOn
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.space(10)

        ButtonGroup {
          anchors.horizontalCenter: parent.horizontalCenter
          visible: root.sportOptions.length > 1
          focusable: false
          options: root.sportOptions
          value: root.onBoxing ? "boxing" : (root.onOne ? "one" : "ufc")
          foreground: root.barForeground
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          onChanged: function(v) { root.showSport(v) }
        }

        Item {
          width: parent.width
          height: Math.max(previousButton.height, titleColumn.implicitHeight)

          PanelActionButton {
            id: previousButton
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            iconText: Model.glyphs.previous
            tooltipText: "Previous event (h)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            enabled: root.currentIndex > 0
            onClicked: root.step(-1)
          }

          Column {
            id: titleColumn
            anchors.left: previousButton.right
            anchors.right: nextButton.left
            anchors.leftMargin: Style.space(8)
            anchors.rightMargin: Style.space(8)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              textFormat: Text.PlainText
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              elide: Text.ElideRight
              text: (root.onBoxing ? "BOXING"
                : (root.onOne ? Model.oneCaption(root.oneEvent, root.oneBouts).toUpperCase()
                : (root.event ? root.event.brand.toUpperCase() : "UFC")))
                + (root.current ? "  ·  " + (root.currentIndex + 1) + " / " + root.currentList.length : "")
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.letterSpacing: 1
              font.bold: true
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              elide: Text.ElideRight
              text: root.current
                ? root.currentHeadline
                : (root.currentFailed ? (root.onOne ? "Couldn't reach ONE" : "Couldn't reach ESPN") : (root.currentLoaded ? "No events scheduled" : "Loading schedule…"))
              color: root.barForeground
              font.family: root.fontFamily
              font.pixelSize: Style.font.heading
              font.bold: true
            }
          }

          PanelActionButton {
            id: nextButton
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            iconText: Model.glyphs.next
            tooltipText: "Next event (l)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            enabled: root.currentIndex < root.currentList.length - 1
            onClicked: root.step(1)
          }
        }

        // Boxing cards have a date but no start time.
        Column {
          width: parent.width
          spacing: Style.space(3)
          visible: root.current !== null

          InfoLine {
            text: !root.current ? ""
              : Model.glyphs.date + "  " + (root.onBoxing
                ? Qt.formatDate(Model.cardDate(root.current), "ddd d MMM")
                : (root.onOne
                  ? root.formatDay(root.current.startMs) + " · " + root.formatTime(root.current.startMs)
                  : root.formatDay(root.current.mainCardMs) + " · " + root.formatTime(root.current.mainCardMs)))
            color: root.barForeground
          }

          InfoLine {
            text: !root.current ? ""
              : (root.onBoxing || root.onOne ? root.current.location
                : [root.current.venue, root.current.location].filter(function(p) { return p !== "" }).join(" · "))
          }

          InfoLine {
            text: root.current && root.current.broadcasts.length > 0 ? Model.glyphs.broadcast + "  " + root.current.broadcasts.join(", ") : ""
          }
        }

        BorderSurface {
          anchors.horizontalCenter: parent.horizontalCenter
          visible: root.current !== null
          implicitWidth: statusLabel.implicitWidth + Style.space(16)
          implicitHeight: statusLabel.implicitHeight + Style.space(6)
          radius: Style.cornerRadius
          color: root.currentLive ? Util.alpha(root.live, 0.18) : "transparent"
          borderSpec: Border.controlSpec("normal", root.currentLive ? root.live : root.barForeground, Color.accent)

          Text {
            id: statusLabel
            textFormat: Text.PlainText
            anchors.centerIn: parent
            text: (root.onBoxing ? Model.boxingStatus(root.card, root.now)
              : (root.onOne ? Model.oneStatus(root.oneEvent, root.now) : Model.statusText(root.event, root.now))).toUpperCase()
            color: root.currentLive ? root.live : root.barForeground
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            font.letterSpacing: 1
            font.bold: true
          }
        }

        PanelSeparator {
          foreground: root.barForeground
        }
      }

      Flickable {
        id: cardScroll
        visible: !root.arcadeOn
        anchors.top: header.bottom
        anchors.bottom: footer.top
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.topMargin: Style.space(4)
        anchors.bottomMargin: Style.space(8)
        contentWidth: width
        contentHeight: cardColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: cardColumn
          width: cardScroll.width
          spacing: Style.space(6)

          Text {
            textFormat: Text.PlainText
            width: parent.width
            topPadding: Style.space(12)
            bottomPadding: Style.space(12)
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            visible: text !== ""
            text: root.onBoxing
              ? (root.card ? "" : (root.boxingFailed ? "ESPN's boxing schedule didn't load. Press r to try again." : (root.boxingLoaded ? root.boxingEmptyText() : "")))
              : root.onOne
                ? (!root.oneEvent
                  ? (root.oneFailed ? "ONE's site didn't answer. Press r to try again." : (root.oneLoaded ? root.oneEmptyText() : ""))
                  : (root.oneBouts === null
                    ? (root.oneEntry && root.oneEntry.failed ? "The fight card didn't load. Press r to try again." : "Loading the fight card…")
                    : (root.oneBouts.length === 0 ? "The fight card hasn't been announced yet." : "")))
              : (!root.event
                ? (root.failed ? "ESPN didn't answer. Press r to try again." : (root.loaded ? "ESPN has no upcoming UFC events listed." : ""))
                : (root.event.fightCount === 0 ? "The fight card hasn't been announced yet." : ""))
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }

          // Boxing and ONE share a plain list of bouts, main event first.
          Column {
            readonly property var bouts: root.onBoxing ? (root.card ? root.card.fights : [])
              : (root.onOne && root.oneBouts ? root.oneBouts : [])
            width: cardColumn.width
            spacing: 0
            visible: bouts.length > 0

            PanelSectionHeader {
              width: parent.width
              text: root.onOne && root.oneEvent
                ? "FIGHT CARD · " + Qt.formatDate(new Date(root.oneEvent.startMs), "ddd").toUpperCase() + " " + root.formatTime(root.oneEvent.startMs)
                : "FIGHT CARD"
              foreground: root.barForeground
              fontFamily: root.fontFamily
              bottomPadding: Style.space(2)
            }

            Repeater {
              model: parent.bouts

              BoutRow {}
            }
          }

          Repeater {
            model: !root.onBoxing && !root.onOne && root.event ? root.event.segments : []

            Column {
              id: segmentColumn
              required property var modelData
              width: cardColumn.width
              spacing: 0

              PanelSectionHeader {
                width: parent.width
                text: root.segmentTitle(segmentColumn.modelData)
                foreground: root.barForeground
                fontFamily: root.fontFamily
                bottomPadding: Style.space(2)
              }

              Repeater {
                model: segmentColumn.modelData.fights

                FightRow {}
              }
            }
          }
        }
      }

      Item {
        id: footer
        visible: !root.arcadeOn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        implicitHeight: Math.max(footerText.implicitHeight, footerActions.implicitHeight)
        height: implicitHeight

        Text {
          id: footerText
          textFormat: Text.PlainText
          anchors.left: parent.left
          anchors.right: footerActions.left
          anchors.rightMargin: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          elide: Text.ElideRight
          text: (root.currentFailed && root.currentFetchedAt > 0 ? "Offline · " : "")
            + (root.onOne ? "onefc.com" : "ESPN")
            + (root.currentFetchedAt > 0 ? " · updated " + root.formatTime(root.currentFetchedAt) : "")
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        Row {
          id: footerActions
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(4)

          PanelActionButton {
            iconText: Model.glyphs.refresh
            tooltipText: "Refresh (r)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            enabled: !fetchProc.running && !boxingProc.running && !oneProc.running
            onClicked: root.refresh()
          }

          PanelActionButton {
            iconText: Model.glyphs.open
            tooltipText: (root.onOne ? "Open on onefc.com" : "Open on ESPN") + " (Enter)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            enabled: root.current !== null
            onClicked: root.openEvent()
          }
        }
      }
    }
  }
}
