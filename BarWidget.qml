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

  // The open-panel mark spans the label or badge, like the clock's; the
  // icon-only form leaves the bar to size it.
  readonly property real openPanelIndicatorWidth: showLabel || showBadge ? pill.width : 0

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
    // Drawn below rather than as the button's label, so the glove can lie on
    // its side without turning the text with it.
    text: ""
    labelVisible: false
    hasVisualContent: true
    fixedWidth: root.vertical ? -1 : pill.width + Style.space(7)
    fixedHeight: root.vertical ? Style.bar.iconSlot : -1
    active: root.live
    dimmed: root.ufc ? (root.ufc.failed && !root.ufc.loaded) : false
    tooltipText: root.ufc ? root.ufc.tooltip : ""

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else if (b === Qt.RightButton) { if (root.ufc) root.ufc.openEvent(root.ufc.nextEvent) }
      else root.togglePanel()
    }

    // Glove plus the fighters, or plus "Next" as a badge. A live event
    // turns the fighters label urgent and fills the badge with it.
    Rectangle {
      id: pill
      readonly property bool filled: root.showBadge && root.live
      readonly property color ink: filled
        ? (root.bar ? root.bar.background : Color.background)
        : (root.live && root.showLabel ? button.activeColor : button.foreground)

      anchors.centerIn: parent
      width: pillRow.implicitWidth + (root.vertical ? 0 : Style.space(10))
      height: pillRow.implicitHeight + Style.space(4)
      radius: Math.min(Style.cornerRadius, height / 2)
      color: filled ? button.activeColor : "transparent"

      Row {
        id: pillRow
        anchors.centerIn: parent
        spacing: Style.space(root.showLabel ? 4 : 3)

        // Square slot, so the glove's turned box can't overlap the text.
        Item {
          anchors.verticalCenter: parent.verticalCenter
          width: glove.implicitHeight
          height: glove.implicitHeight

          Text {
            id: glove
            textFormat: Text.PlainText
            anchors.centerIn: parent
            text: Model.glyphs.glove
            rotation: 90
            color: pill.ink
            font.family: button.fontFamily
            // On its side the glove is short and wide, so it needs a larger
            // size than other bar icons to read at the same weight.
            font.pixelSize: Math.round(Style.bar.iconFont * 1.35)
            renderType: Text.NativeRendering
          }
        }

        Text {
          textFormat: Text.PlainText
          anchors.verticalCenter: parent.verticalCenter
          visible: root.showLabel || root.showBadge
          text: root.showBadge ? (root.live ? "LIVE" : "Next") : root.label
          color: pill.ink
          font.family: button.fontFamily
          font.pixelSize: root.showBadge ? Style.font.caption : Style.font.body
          font.bold: root.showBadge
          font.letterSpacing: root.showBadge ? 0.5 : 0
          renderType: Text.NativeRendering
        }
      }
    }
  }
}
