import QtQuick
import QtMultimedia

// The arcade's sound effects, kept in their own file because Qt Multimedia
// isn't part of every Omarchy install: if it's missing, only this fails to
// load and the arcade falls back to pw-play.
Item {
  id: root

  property real volume: 0.4
  property var effects: ({})

  function play(name) {
    var fx = effects[name]
    if (!fx) return
    fx.stop()
    fx.play()
  }

  component Fx: SoundEffect {
    volume: root.volume
  }

  Fx { id: swing; source: Qt.resolvedUrl("sounds/swing.wav") }
  Fx { id: hit; source: Qt.resolvedUrl("sounds/hit.wav") }
  Fx { id: block; source: Qt.resolvedUrl("sounds/block.wav") }
  Fx { id: jump; source: Qt.resolvedUrl("sounds/jump.wav") }
  Fx { id: throwFx; source: Qt.resolvedUrl("sounds/throw.wav") }
  Fx { id: swat; source: Qt.resolvedUrl("sounds/swat.wav") }
  Fx { id: ko; source: Qt.resolvedUrl("sounds/ko.wav") }
  Fx { id: warp; source: Qt.resolvedUrl("sounds/warp.wav") }
  Fx { id: coin; source: Qt.resolvedUrl("sounds/coin.wav") }
  Fx { id: start; source: Qt.resolvedUrl("sounds/start.wav") }
  Fx { id: stage; source: Qt.resolvedUrl("sounds/stage.wav") }
  Fx { id: fight; source: Qt.resolvedUrl("sounds/fight.wav") }
  Fx { id: bonus; source: Qt.resolvedUrl("sounds/bonus.wav") }
  Fx { id: perfect; source: Qt.resolvedUrl("sounds/perfect.wav") }
  Fx { id: gameover; source: Qt.resolvedUrl("sounds/gameover.wav") }
  Fx { id: champion; source: Qt.resolvedUrl("sounds/champion.wav") }

  Component.onCompleted: effects = {
    swing: swing, hit: hit, block: block, jump: jump, throw: throwFx, swat: swat,
    ko: ko, warp: warp, coin: coin, start: start, stage: stage, fight: fight,
    bonus: bonus, perfect: perfect, gameover: gameover, champion: champion
  }
}
