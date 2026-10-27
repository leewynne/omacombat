import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Arcade.js" as Arcade

// Fetches the UFC and boxing schedules from ESPN and shows one fight card at
// a time. UFC is the default; the switch at the top (or u/b) changes sport.
// The arrows (or h/l) step through upcoming events; Return opens the event on
// ESPN.
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

  // What the panel is showing: the UFC event or the boxing card.
  readonly property bool onBoxing: sport === "boxing" && boxingEnabled
  readonly property var current: onBoxing ? card : event
  readonly property var currentList: onBoxing ? boxingSchedule : schedule
  readonly property int currentIndex: onBoxing ? Math.min(boxingIndex, boxingSchedule.length - 1) : Math.min(index, schedule.length - 1)
  readonly property bool currentLive: onBoxing ? (card !== null && Model.daysUntil(card, now) <= 0) : Model.isLive(event, now)
  readonly property bool currentFailed: onBoxing ? boxingFailed : failed
  readonly property bool currentLoaded: onBoxing ? boxingLoaded : loaded
  readonly property real currentFetchedAt: onBoxing ? boxingFetchedAt : fetchedAt

  readonly property string label: Model.barLabel(nextEvent, now, labelStyle)
  readonly property var nextBoxing: boxingSchedule.length > 0 ? boxingSchedule[0] : null
  readonly property string tooltip: (nextEvent
    ? nextEvent.name + "\n" + formatDay(nextEvent.mainCardMs) + " · " + formatTime(nextEvent.mainCardMs)
    : (failed ? "Couldn't reach ESPN" : "OmaCombat"))
    + (nextBoxing ? "\n\nBoxing: " + nextBoxing.headline + "\n" + formatDay(Model.cardDate(nextBoxing).getTime()) : "")

  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color dim: Qt.darker(barForeground, 1.4)
  readonly property color live: bar ? bar.urgent : Color.urgent

  function open() {
    index = 0
    boxingIndex = 0
    sport = "ufc"
    konami = []
    arcadeOn = false
    now = Date.now()
    cardScroll.contentY = 0
    root.controller.show()
    if (Date.now() - fetchedAt > 5 * 60 * 1000) refreshUfc()
    if (Date.now() - boxingFetchedAt > 30 * 60 * 1000) refreshBoxing()
  }

  function openSport(name) {
    if (!root.opened) open()
    showSport(name)
  }

  function showSport(name) {
    var next = Model.sport(name)
    if (next === "boxing" && !boxingEnabled) return
    if (next === sport) return
    sport = next
    cardScroll.contentY = 0
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
    else index = next
    cardScroll.contentY = 0
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

  // A boxing bout: the story has names, rounds and either the title at stake
  // or the weight class, which runs underneath because it can be long.
  component BoutRow: Column {
    id: bout
    required property var modelData
    readonly property real middleWidth: Style.space(104)

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
        decided: false
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
          text: Model.boutRounds(bout.modelData)
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
        decided: false
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
      color: bout.modelData.belt !== "" ? Color.accent : root.dim
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
          visible: root.boxingEnabled
          focusable: false
          options: [
            { value: "ufc", label: "UFC", tooltip: "UFC (u)" },
            { value: "boxing", label: "Boxing", tooltip: "Boxing (b)" }
          ]
          value: root.onBoxing ? "boxing" : "ufc"
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
              text: (root.onBoxing ? "BOXING" : (root.event ? root.event.brand.toUpperCase() : "UFC"))
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
                ? (root.current.headline || root.current.name)
                : (root.currentFailed ? "Couldn't reach ESPN" : (root.currentLoaded ? "No events scheduled" : "Loading schedule…"))
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
                : root.formatDay(root.current.mainCardMs) + " · " + root.formatTime(root.current.mainCardMs))
            color: root.barForeground
          }

          InfoLine {
            text: !root.current ? ""
              : (root.onBoxing ? root.current.location
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
            text: (root.onBoxing ? Model.boxingStatus(root.card, root.now) : Model.statusText(root.event, root.now)).toUpperCase()
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
              : (!root.event
                ? (root.failed ? "ESPN didn't answer. Press r to try again." : (root.loaded ? "ESPN has no upcoming UFC events listed." : ""))
                : (root.event.fightCount === 0 ? "The fight card hasn't been announced yet." : ""))
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }

          Column {
            width: cardColumn.width
            spacing: 0
            visible: root.onBoxing && root.card !== null

            PanelSectionHeader {
              width: parent.width
              text: "FIGHT CARD"
              foreground: root.barForeground
              fontFamily: root.fontFamily
              bottomPadding: Style.space(2)
            }

            Repeater {
              model: root.onBoxing && root.card ? root.card.fights : []

              BoutRow {}
            }
          }

          Repeater {
            model: !root.onBoxing && root.event ? root.event.segments : []

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
          text: root.currentFetchedAt > 0
            ? (root.currentFailed ? "Offline · " : "") + "ESPN · updated " + root.formatTime(root.currentFetchedAt)
            : "ESPN"
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
            enabled: !fetchProc.running && !boxingProc.running
            onClicked: root.refresh()
          }

          PanelActionButton {
            iconText: Model.glyphs.open
            tooltipText: "Open on ESPN (Enter)"
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
