package expo.modules.krsemulator

import android.content.ContentValues
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest

private const val GAME_WIDTH = 240
private const val GAME_HEIGHT = 160
private const val UNDO_STATE = "undo"
private const val SCREENSHOT_SCALE = 4
private const val SCREENSHOT_FOLDER = "KRS32"

class KrsEmulatorModule : Module() {
  private var stateDir: File? = null

  private fun stateFile(name: String): File =
    File(stateDir ?: throw CodedException("No game is running."), "$name.state")

  private fun installInputHook() {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      val window = activity.window
      if (window.callback !is KrsWindowCallback) window.callback = KrsWindowCallback(window.callback)
    }
  }

  private fun gameBitmap(scale: Int): Bitmap? {
    val frame = KrsEmulatorNative.getLastFrame() ?: return null
    val source = Bitmap.createBitmap(GAME_WIDTH, GAME_HEIGHT, Bitmap.Config.RGB_565)
    source.copyPixelsFromBuffer(ByteBuffer.wrap(frame))
    // Enlarging without filtering keeps the pixels square.
    val bitmap = Bitmap.createScaledBitmap(source, GAME_WIDTH * scale, GAME_HEIGHT * scale, false)
    if (bitmap !== source) source.recycle()
    return bitmap
  }

  private fun saveToGallery(bitmap: Bitmap) {
    // Scoped storage lets an app add its own pictures without a permission from Android 10 on.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw CodedException("Screenshots need Android 10 or newer.")
    }
    val resolver = requireNotNull(appContext.reactContext).contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, "krs32-${System.currentTimeMillis()}.png")
      put(MediaStore.Images.Media.MIME_TYPE, "image/png")
      put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$SCREENSHOT_FOLDER")
    }
    val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val uri = resolver.insert(collection, values) ?: throw CodedException("Couldn't save the screenshot.")
    try {
      val stream = resolver.openOutputStream(uri) ?: throw CodedException("Couldn't save the screenshot.")
      stream.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    } catch (cause: Exception) {
      resolver.delete(uri, null, null)
      throw cause
    }
  }

  private fun writeThumbnail(name: String, scale: Int = 1) {
    val bitmap = gameBitmap(scale) ?: return
    val target = File(stateFile(name).parentFile, "$name.png")
    val temp = File(target.parentFile, "$name.png.tmp")
    temp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bitmap.recycle()
    temp.renameTo(target)
  }

  override fun definition() = ModuleDefinition {
    Name("KrsEmulator")

    Events("onControllerCapture", "onControllerAction")

    OnCreate {
      KrsInput.onAction = { action -> sendEvent("onControllerAction", mapOf("action" to action)) }
      KrsInput.onCapture = { keys -> sendEvent("onControllerCapture", mapOf("keys" to keys)) }
      installInputHook()
    }

    Function("getCoreInfo") {
      mapOf(
        "name" to KrsEmulatorNative.coreName(),
        "version" to KrsEmulatorNative.coreVersion(),
        "extensions" to KrsEmulatorNative.validExtensions(),
        "libretroApiVersion" to KrsEmulatorNative.libretroApiVersion(),
        "aaudioRecommended" to KrsEmulatorNative.isAAudioRecommended()
      )
    }

    AsyncFunction("loadGame") { uri: String ->
      val context = requireNotNull(appContext.reactContext)
      val rom = context.contentResolver.openInputStream(Uri.parse(uri))?.use { it.readBytes() }
        ?: throw CodedException("Could not open this file.")

      // Name saves after the ROM's contents so they survive the file being moved or renamed.
      val saves = File(context.filesDir, "saves").apply { mkdirs() }
      val saveId = sha256(rom)
      val saveFile = File(saves, "$saveId.sav")
      stateDir = File(context.filesDir, "states/$saveId").apply { mkdirs() }

      // A BIOS imported during setup is stored here as gba_bios.bin (see lib/setup.ts).
      val systemDir = File(context.filesDir, "system").apply { mkdirs() }

      KrsEmulatorNative.start(rom, saveFile.absolutePath, systemDir.absolutePath)
        ?.let { throw CodedException(it) }
      installInputHook()
      KrsInput.reset()
      KrsInput.gameActive = true
      mapOf("saveExists" to saveFile.exists(), "saveId" to saveId)
    }

    AsyncFunction("getSaveId") { uri: String ->
      val context = requireNotNull(appContext.reactContext)
      val digest = MessageDigest.getInstance("SHA-256")
      val stream = context.contentResolver.openInputStream(Uri.parse(uri))
        ?: throw CodedException("Could not open this file.")
      stream.use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          digest.update(buffer, 0, count)
        }
      }
      hex(digest.digest())
    }

    Function("getControlDefaults") {
      controlDefaults()
    }

    Function("stop") {
      KrsInput.gameActive = false
      KrsInput.reset()
      KrsEmulatorNative.stop()
    }

    Function("getControllers") {
      KrsInput.connectedControllers()
    }

    Function("setControllerMapping") { json: String ->
      KrsInput.setMapping(json)
    }

    Function("startControllerCapture") {
      installInputHook()
      KrsInput.startCapture()
    }

    Function("stopControllerCapture") {
      KrsInput.stopCapture()
    }

    AsyncFunction("setVideoSettings") { filter: Int, strength: Double, aspect: Int, scaling: Int ->
      KrsEmulatorNative.setVideoSettings(filter, strength.toFloat(), aspect, scaling)
    }

    Function("setPaused") { paused: Boolean ->
      KrsEmulatorNative.setPaused(paused)
    }

    AsyncFunction("saveState") { name: String ->
      if (!KrsEmulatorNative.saveState(stateFile(name).absolutePath)) {
        throw CodedException("Couldn't write the save state.")
      }
      if (name != UNDO_STATE) writeThumbnail(name)
    }

    AsyncFunction("captureThumbnail") { name: String, scale: Int? ->
      writeThumbnail(name, scale ?: 1)
    }

    AsyncFunction("saveScreenshot") {
      val bitmap = gameBitmap(SCREENSHOT_SCALE) ?: throw CodedException("There's no picture to save yet.")
      try {
        saveToGallery(bitmap)
      } finally {
        bitmap.recycle()
      }
    }

    AsyncFunction("setCheats") { lines: List<String> ->
      if (!KrsEmulatorNative.setCheats(lines.toTypedArray())) {
        throw CodedException("Couldn't apply the cheats.")
      }
    }

    AsyncFunction("loadState") { name: String ->
      if (!KrsEmulatorNative.loadState(stateFile(name).absolutePath)) {
        throw CodedException("Couldn't load the save state.")
      }
    }

    AsyncFunction("reset") {
      if (!KrsEmulatorNative.reset()) throw CodedException("Couldn't reset the game.")
    }

    Function("getStateTime") { name: String ->
      stateFile(name).takeIf { it.exists() }?.lastModified()?.toDouble()
    }

    Function("getStats") {
      val stats = KrsEmulatorNative.getStats()
      mapOf(
        "fps" to stats[0],
        "frameMs" to stats[1],
        "audioUnderruns" to stats[2],
        "audioOverruns" to stats[3],
        "saveWrites" to stats[4],
        "saveBytes" to stats[5]
      )
    }

    OnActivityEntersBackground {
      KrsEmulatorNative.setBackgrounded(true)
    }

    OnActivityEntersForeground {
      KrsEmulatorNative.setBackgrounded(false)
      installInputHook()
    }

    OnDestroy {
      KrsInput.gameActive = false
      KrsEmulatorNative.stop()
    }

    View(KrsEmulatorView::class) {
      Events("onMenuPress")

      Prop("title") { view: KrsEmulatorView, title: String ->
        view.setTitle(title)
      }

      Prop("stretchVideo") { view: KrsEmulatorView, stretch: Boolean ->
        view.setStretchVideo(stretch)
      }

      Prop("controlLayout") { view: KrsEmulatorView, json: String ->
        view.setControlLayout(json)
      }

      Prop("fastForwardSpeed") { view: KrsEmulatorView, speed: Double ->
        view.setFastForwardSpeed(speed)
      }
    }
  }

  private fun sha256(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

  private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
