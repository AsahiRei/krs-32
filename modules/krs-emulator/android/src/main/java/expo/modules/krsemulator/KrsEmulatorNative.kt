package expo.modules.krsemulator

import android.view.Surface

internal object KrsEmulatorNative {
  init {
    System.loadLibrary("krsemulator")
  }

  external fun coreName(): String
  external fun coreVersion(): String
  external fun validExtensions(): String
  external fun libretroApiVersion(): Int
  external fun isAAudioRecommended(): Boolean

  external fun start(rom: ByteArray, savePath: String, systemDir: String): String?
  external fun stop()
  external fun setPaused(paused: Boolean)
  external fun setButtons(buttons: Int)
  external fun setFastForward(enabled: Boolean)
  external fun setFastForwardSpeed(speed: Double)
  external fun setBackgrounded(backgrounded: Boolean)
  external fun saveState(path: String): Boolean
  external fun loadState(path: String): Boolean
  external fun reset(): Boolean
  external fun getLastFrame(): ByteArray?
  external fun setCheats(lines: Array<String>): Boolean
  external fun setPadButtons(buttons: Int)
  external fun setPadFastForward(enabled: Boolean)
  external fun setVideoSettings(filter: Int, strength: Float, aspect: Int, scaling: Int)
  external fun setSurface(surface: Surface?)
  external fun getStats(): DoubleArray
}
