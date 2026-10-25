import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Fetches the UFC schedule from ESPN and shows one event's fight card at a
// time. The arrows (or h/l) step through upcoming events; Return opens the
// event on ESPN.
Panel {
  id: root
  moduleName: "leewynne.next-ufc"
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

  readonly property var schedule: Model.upcoming(events, now)
  readonly property var nextEvent: schedule.length > 0 ? schedule[0] : null
  readonly property var event: schedule.length > 0 ? schedule[Math.max(0, Math.min(index, schedule.length - 1))] : null
  readonly property bool nextLive: Model.isLive(nextEvent, now)
  readonly property string labelStyle: Model.labelStyles.indexOf(String(setting("label", "fighters"))) >= 0 ? String(setting("label", "fighters")) : "fighters"
  readonly property int refreshMinutes: Math.max(5, parseInt(setting("refreshMinutes", 30), 10) || 30)
  readonly property string timeFormat: Model.timeFormat(String(setting("clock", "locale")), Qt.locale().timeFormat(Locale.ShortFormat))

  readonly property string label: Model.barLabel(nextEvent, now, labelStyle)
  readonly property string tooltip: nextEvent
    ? nextEvent.name + "\n" + formatDay(nextEvent.mainCardMs) + " · " + formatTime(nextEvent.mainCardMs)
    : (failed ? "Couldn't reach ESPN" : "Next UFC")

  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color dim: Qt.darker(barForeground, 1.4)
  readonly property color live: bar ? bar.urgent : Color.urgent

  function open() {
    index = 0
    now = Date.now()
    cardScroll.contentY = 0
    root.controller.show()
    if (Date.now() - fetchedAt > 5 * 60 * 1000) refresh()
  }

  function close() {
    root.controller.hide()
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
    if (schedule.length === 0) return
    index = Math.max(0, Math.min(schedule.length - 1, index + delta))
    cardScroll.contentY = 0
  }

  function scroll(direction) {
    var max = Math.max(0, cardScroll.contentHeight - cardScroll.height)
    cardScroll.contentY = Math.max(0, Math.min(max, cardScroll.contentY + direction * Style.space(48)))
  }

  function openEvent(target) {
    var ev = target || root.event
    if (!ev) return
    Quickshell.execDetached(["omarchy-launch-browser", ev.url])
    root.close()
  }

  function refresh() {
    retries = 0
    fetch()
  }

  function fetch() {
    if (fetchProc.running) return
    fetchProc.command = ["curl", "-fsS", "--compressed", "--max-time", "15", Model.scoreboardUrl(Date.now(), 180)]
    fetchProc.running = true
  }

  function scheduleRetry() {
    if (retries >= 3) return
    retries++
    retryTimer.restart()
  }

  function formatDay(ms) {
    return isNaN(ms) ? "" : Qt.formatDate(new Date(ms), "ddd d MMM")
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

  // ESPN occasionally drops a request; a few quick retries beat waiting out
  // the refresh interval with no schedule.
  Timer {
    id: retryTimer
    interval: 5000
    onTriggered: root.fetch()
  }

  // Poll faster while an event is live so results land on the card.
  Timer {
    interval: (root.nextLive ? 2 : root.refreshMinutes) * 60 * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
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

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: false
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(460))
    contentHeight: panel.fittedContentHeight(header.implicitHeight + cardColumn.implicitHeight + footer.implicitHeight + Style.space(24), Style.space(680))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) {
        if (dx !== 0) root.step(dx)
        else root.scroll(dy)
      }
      onActivateRequested: root.openEvent()
      onTextKey: function(t) { if (t === "r") root.refresh() }

      Column {
        id: header
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.space(10)

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
            enabled: root.index > 0
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
              text: root.event
                ? root.event.brand.toUpperCase() + "  ·  " + (root.index + 1) + " / " + root.schedule.length
                : "NEXT UFC"
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
              text: root.event ? (root.event.headline || root.event.name) : (root.failed ? "Couldn't reach ESPN" : (root.loaded ? "No events scheduled" : "Loading schedule…"))
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
            enabled: root.index < root.schedule.length - 1
            onClicked: root.step(1)
          }
        }

        Column {
          width: parent.width
          spacing: Style.space(3)
          visible: root.event !== null

          InfoLine {
            text: root.event ? Model.glyphs.date + "  " + root.formatDay(root.event.mainCardMs) + " · " + root.formatTime(root.event.mainCardMs) : ""
            color: root.barForeground
          }

          InfoLine {
            text: root.event ? [root.event.venue, root.event.location].filter(function(p) { return p !== "" }).join(" · ") : ""
          }

          InfoLine {
            text: root.event && root.event.broadcasts.length > 0 ? Model.glyphs.broadcast + "  " + root.event.broadcasts.join(", ") : ""
          }
        }

        BorderSurface {
          anchors.horizontalCenter: parent.horizontalCenter
          visible: root.event !== null
          implicitWidth: statusLabel.implicitWidth + Style.space(16)
          implicitHeight: statusLabel.implicitHeight + Style.space(6)
          radius: Style.cornerRadius
          color: Model.isLive(root.event, root.now) ? Util.alpha(root.live, 0.18) : "transparent"
          borderSpec: Border.controlSpec("normal", Model.isLive(root.event, root.now) ? root.live : root.barForeground, Color.accent)

          Text {
            id: statusLabel
            textFormat: Text.PlainText
            anchors.centerIn: parent
            text: Model.statusText(root.event, root.now).toUpperCase()
            color: Model.isLive(root.event, root.now) ? root.live : root.barForeground
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
            text: !root.event
              ? (root.failed ? "ESPN didn't answer. Press r to try again." : (root.loaded ? "ESPN has no upcoming UFC events listed." : ""))
              : (root.event.fightCount === 0 ? "The fight card hasn't been announced yet." : "")
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }

          Repeater {
            model: root.event ? root.event.segments : []

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
          text: root.fetchedAt > 0
            ? (root.failed ? "Offline · " : "") + "ESPN · updated " + root.formatTime(root.fetchedAt)
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
            enabled: !fetchProc.running
            onClicked: root.refresh()
          }

          PanelActionButton {
            iconText: Model.glyphs.open
            tooltipText: "Open on ESPN (Enter)"
            foreground: root.barForeground
            fontFamily: root.fontFamily
            enabled: root.event !== null
            onClicked: root.openEvent()
          }
        }
      }
    }
  }
}
