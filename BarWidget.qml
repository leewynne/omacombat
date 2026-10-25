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
  readonly property bool showLabel: !vertical && label !== ""

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

  // A text pill marks its label as open, like the clock; the icon-only form
  // leaves the bar to size the mark.
  readonly property real openPanelIndicatorWidth: showLabel ? button.labelWidth : 0

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
    text: root.showLabel ? Model.glyphs.ufc + "  " + root.label : Model.glyphs.ufc
    fontSize: root.showLabel ? Style.font.body : Style.bar.iconFont
    fixedWidth: root.showLabel ? -1 : (root.vertical ? -1 : Style.bar.iconSlot)
    fixedHeight: root.vertical ? Style.bar.iconSlot : -1
    active: root.ufc ? root.ufc.nextLive : false
    dimmed: root.ufc ? (root.ufc.failed && !root.ufc.loaded) : false
    tooltipText: root.ufc ? root.ufc.tooltip : ""

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else if (b === Qt.RightButton) { if (root.ufc) root.ufc.openEvent(root.ufc.nextEvent) }
      else root.togglePanel()
    }
  }
}
