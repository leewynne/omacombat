import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Next UFC event in the bar. Left click opens the fight card (with boxing a
// switch away), middle click refreshes, right click opens the next UFC event
// on ESPN.
BarWidget {
  id: root
  moduleName: "leewynne.omacombat"

  readonly property var fights: panelLoader.item
  readonly property string label: fights ? fights.label : ""
  readonly property bool live: fights ? fights.nextLive : false
  // The icon style has no label, so this also covers it.
  readonly property bool showLabel: !vertical && label !== ""

  // Shape contract for shell.summon/hide/toggle routing: Bar.findPanelWidget
  // requires open/close/opened on the bar-widget root.
  readonly property bool opened: fights ? fights.opened === true : false

  function open() {
    if (fights) fights.open()
  }

  function close() {
    if (fights) fights.close()
  }

  function togglePanel() {
    if (fights) fights.toggle()
  }

  function refresh() {
    if (fights) fights.refresh()
  }

  function step(delta) {
    if (!fights) return
    if (!fights.opened) fights.open()
    fights.step(delta)
  }

  function openArcade() {
    if (fights) fights.openArcade()
  }

  function openSport(name) {
    if (fights) fights.openSport(name)
  }

  // Forwarded so this widget can stand in for the panel as the bar's popout
  // identity: Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: fights ? fights.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (fights) fights.closeForPopoutSwitch()
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  // The open-panel mark spans the label, like the clock's; the glove alone
  // leaves the bar to size it.
  readonly property real openPanelIndicatorWidth: showLabel ? pill.width : 0

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
    target: "leewynne.omacombat"

    function refresh(): void { root.broadcast("refresh") }
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function next(): void { root.step(1) }
    function previous(): void { root.step(-1) }
    function ufc(): void { root.openSport("ufc") }
    function one(): void { root.openSport("one") }
    function boxing(): void { root.openSport("boxing") }
    function insertCoin(): void { root.openArcade() }
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
    fixedWidth: root.vertical ? -1 : (root.showLabel ? pill.width + Style.space(7) : Math.max(Style.bar.iconSlot, pill.width))
    fixedHeight: root.vertical ? Style.bar.iconSlot : -1
    active: root.live
    dimmed: root.fights ? (root.fights.failed && !root.fights.loaded) : false
    tooltipText: root.fights ? root.fights.tooltip : ""

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else if (b === Qt.RightButton) { if (root.fights) root.fights.openEvent(root.fights.nextEvent) }
      else root.togglePanel()
    }

    // The glove, with the fighters beside it unless the icon style is set.
    // A live event turns the label urgent, or fills behind a lone glove.
    Rectangle {
      id: pill
      readonly property bool filled: root.live && !root.showLabel
      readonly property color ink: filled
        ? (root.bar ? root.bar.background : Color.background)
        : (root.live ? button.activeColor : button.foreground)

      anchors.centerIn: parent
      width: pillRow.implicitWidth + (root.vertical ? 0 : Style.space(root.showLabel ? 10 : 6))
      height: pillRow.implicitHeight + Style.space(4)
      radius: Math.min(Style.cornerRadius, height / 2)
      color: filled ? button.activeColor : "transparent"

      Row {
        id: pillRow
        anchors.centerIn: parent
        spacing: Style.space(4)

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
          visible: root.showLabel
          text: root.label
          color: pill.ink
          font.family: button.fontFamily
          font.pixelSize: Style.font.body
          renderType: Text.NativeRendering
        }
      }
    }
  }
}
