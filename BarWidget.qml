import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Next UFC event in the bar. Left click opens the fight card, middle click
// refreshes, right click opens the next event on ESPN.
BarWidget {
  id: root
  moduleName: "leewynne.next-ufc"

  readonly property var ufc: panelLoader.item
  readonly property string label: ufc ? ufc.label : ""
  readonly property bool live: ufc ? ufc.nextLive : false
  readonly property bool badge: ufc ? ufc.labelStyle === "badge" : false
  readonly property bool showBadge: badge && !vertical
  readonly property bool showLabel: !badge && !vertical && label !== ""

  // Shape contract for shell.summon/hide/toggle routing: Bar.findPanelWidget
  // requires open/close/opened on the bar-widget root.
  readonly property bool opened: ufc ? ufc.opened === true : false

  function open() {
    if (ufc) ufc.open()
  }

  function close() {
    if (ufc) ufc.close()
  }

  function togglePanel() {
    if (ufc) ufc.toggle()
  }

  function refresh() {
    if (ufc) ufc.refresh()
  }

  function step(delta) {
    if (!ufc) return
    if (!ufc.opened) ufc.open()
    ufc.step(delta)
  }

  // Forwarded so this widget can stand in for the panel as the bar's popout
  // identity: Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: ufc ? ufc.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (ufc) ufc.closeForPopoutSwitch()
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  // A text pill marks its label as open, like the clock, and the badge marks
  // its own outline; the icon-only form leaves the bar to size the mark.
  readonly property real openPanelIndicatorWidth: showLabel ? button.labelWidth : (showBadge ? badgeShape.width : 0)

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "leewynne.next-ufc"

    function refresh(): void { root.broadcast("refresh") }
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function next(): void { root.step(1) }
    function previous(): void { root.step(-1) }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.showBadge ? "" : (root.showLabel ? Model.glyphs.ufc + "  " + root.label : (root.badge ? Model.glyphs.fist : Model.glyphs.ufc))
    labelVisible: !root.showBadge
    hasVisualContent: true
    fontSize: root.showLabel ? Style.font.body : Style.bar.iconFont
    fixedWidth: root.showBadge ? badgeShape.width + Style.space(12) : (root.showLabel || root.vertical ? -1 : Style.bar.iconSlot)
    fixedHeight: root.vertical ? Style.bar.iconSlot : -1
    active: root.live
    dimmed: root.ufc ? (root.ufc.failed && !root.ufc.loaded) : false
    tooltipText: root.ufc ? root.ufc.tooltip : ""

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else if (b === Qt.RightButton) { if (root.ufc) root.ufc.openEvent(root.ufc.nextEvent) }
      else root.togglePanel()
    }

    // Outlined fist-and-UFC badge, filled in the urgent colour while an
    // event is live.
    Rectangle {
      id: badgeShape
      readonly property color ink: root.live ? (root.bar ? root.bar.background : Color.background) : button.foreground

      visible: root.showBadge
      anchors.centerIn: parent
      width: badgeRow.implicitWidth + Style.space(12)
      height: badgeRow.implicitHeight + Style.space(4)
      radius: Math.min(Style.cornerRadius, height / 2)
      color: root.live ? button.activeColor : "transparent"
      border.width: root.live ? 0 : 1
      border.color: Util.alpha(button.foreground, 0.6)

      Row {
        id: badgeRow
        anchors.centerIn: parent
        spacing: Style.space(5)

        Text {
          textFormat: Text.PlainText
          anchors.verticalCenter: parent.verticalCenter
          text: Model.glyphs.fist
          color: badgeShape.ink
          font.family: button.fontFamily
          font.pixelSize: Style.font.body
          renderType: Text.NativeRendering
        }

        Text {
          textFormat: Text.PlainText
          anchors.verticalCenter: parent.verticalCenter
          text: root.live ? "LIVE" : "UFC"
          color: badgeShape.ink
          font.family: button.fontFamily
          font.pixelSize: Style.font.caption
          font.bold: true
          font.letterSpacing: 1
          renderType: Text.NativeRendering
        }
      }
    }
  }
}
