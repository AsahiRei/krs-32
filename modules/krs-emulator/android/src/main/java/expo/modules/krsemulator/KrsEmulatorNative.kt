package expo.modules.krsemulator

import android.view.Surface

/** The systems the player runs. The numbers match `System` in krsemulator.cpp. */
internal enum class GameSystem(val id: Int, val key: String) {
  GBA(0, "gba"),
  NDS(1, "nds");

  companion object {
    fun fromKey(key: String?): GameSystem = entries.firstOrNull { it.key == key } ?: GBA
  }
}

internal object KrsEmulatorNative {
  init {
    System.loadLibrary("krsemulator")
  }

  external fun coreName(system: Int): String?
  external fun coreVersion(system: Int): String?
  external fun validExtensions(system: Int): String?
  external fun libretroApiVersion(system: Int): Int
  external fun isAAudioRecommended(): Boolean

  /** Reads the ROM from [romFd], which stays the caller's to close. Returns an error, or null. */
  external fun start(romFd: Int, system: Int, savePath: String, saveDir: String, systemDir: String): String?
  external fun stop()
  external fun setPaused(paused: Boolean)
  external fun setButtons(buttons: Int)
  /** A touch on the DS touchscreen, as fractions of its width and height from its top left. */
  external fun setPointer(pressed: Boolean, x: Float, y: Float)
  /**
   * Where the DS's top and bottom screens go in the surface: left, top, width, height in pixels
   * for each, top screen first. A zero width hides that screen; null draws one picture. A ninth
   * value, when not zero, draws the touchscreen first so the top screen pops up over it.
   */
  external fun setScreenRects(rects: FloatArray?)
  external fun setFastForward(enabled: Boolean)
  external fun setFastForwardSpeed(speed: Double)
  external fun setBackgrounded(backgrounded: Boolean)
  external fun saveState(path: String): Boolean
  external fun loadState(path: String): Boolean
  external fun reset(): Boolean
  /** The picture as RGBA8888, with its width and height written to [size]. */
  external fun getLastFrame(size: IntArray): ByteArray?
  external fun setCheats(lines: Array<String>): Boolean
  external fun setPadButtons(buttons: Int)
  external fun setPadFastForward(enabled: Boolean)
  external fun setVideoSettings(filter: Int, strength: Float, aspect: Int, scaling: Int)
  external fun setSurface(surface: Surface?)
  external fun getStats(): DoubleArray
}
