package expo.modules.krsemulator

import android.os.Build
import android.view.InputDevice
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MotionEvent
import android.view.Window
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToInt

// Libretro joypad button bits, as in KrsControlsView.
private const val BIT_B = 1 shl 0
private const val BIT_Y = 1 shl 1
private const val BIT_SELECT = 1 shl 2
private const val BIT_START = 1 shl 3
private const val BIT_UP = 1 shl 4
private const val BIT_DOWN = 1 shl 5
private const val BIT_LEFT = 1 shl 6
private const val BIT_RIGHT = 1 shl 7
private const val BIT_A = 1 shl 8
private const val BIT_X = 1 shl 9
private const val BIT_L = 1 shl 10
private const val BIT_R = 1 shl 11

private const val STICK_THRESHOLD = 0.5f
private const val TRIGGER_THRESHOLD = 0.5f

private const val NAME_UP = "DPAD_UP"
private const val NAME_DOWN = "DPAD_DOWN"
private const val NAME_LEFT = "DPAD_LEFT"
private const val NAME_RIGHT = "DPAD_RIGHT"
private const val NAME_R2 = "BUTTON_R2"
private const val NAME_L2 = "BUTTON_L2"
private const val STICK_UP = "STICK_UP"
private const val STICK_DOWN = "STICK_DOWN"
private const val STICK_LEFT = "STICK_LEFT"
private const val STICK_RIGHT = "STICK_RIGHT"

private val DIRECTION_NAMES = setOf(
  NAME_UP, NAME_DOWN, NAME_LEFT, NAME_RIGHT, STICK_UP, STICK_DOWN, STICK_LEFT, STICK_RIGHT,
)

private val BUTTON_BITS = mapOf(
  "A" to BIT_A,
  "B" to BIT_B,
  "X" to BIT_X,
  "Y" to BIT_Y,
  "L" to BIT_L,
  "R" to BIT_R,
  "START" to BIT_START,
  "SELECT" to BIT_SELECT,
)

private val FIRE_ONCE_ACTIONS = listOf("MENU", "QUICK_SAVE", "QUICK_LOAD")

/** Turns Bluetooth controller input into emulator buttons and shortcut actions. */
internal object KrsInput {
  @Volatile var gameActive = false
  var onAction: ((String) -> Unit)? = null
  var onCapture: ((List<String>) -> Unit)? = null

  @Volatile private var mapping: Map<String, List<String>> = emptyMap()
  @Volatile private var capturing = false
  private val captured = linkedSetOf<String>()
  private val pressed = hashSetOf<String>()
  private val activeActions = hashSetOf<String>()
  private var fastForwardHeld = false

  fun setMapping(json: String) {
    val parsed = JSONObject(json)
    mapping = parsed.keys().asSequence().associateWith { action ->
      val keys = parsed.getJSONArray(action)
      List(keys.length()) { keys.getString(it) }
    }
  }

  @Synchronized
  fun startCapture() {
    // Releases aren't tracked outside a game, so anything remembered here could be stale.
    pressed.clear()
    captured.clear()
    capturing = true
  }

  @Synchronized
  fun stopCapture() {
    capturing = false
    captured.clear()
    pressed.clear()
  }

  @Synchronized
  fun reset() {
    pressed.clear()
    activeActions.clear()
    fastForwardHeld = false
    KrsEmulatorNative.setPadButtons(0)
    KrsEmulatorNative.setPadFastForward(false)
  }

  private fun isGamepad(source: Int) =
    source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
      source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK

  private fun isController(source: Int) =
    source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
      source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK ||
      source and InputDevice.SOURCE_DPAD == InputDevice.SOURCE_DPAD

  fun handleKey(event: KeyEvent): Boolean {
    if (!isController(event.source)) return false
    if (!capturing && !gameActive) return false
    if (event.repeatCount > 0) return true

    val name = KeyEvent.keyCodeToString(event.keyCode).removePrefix("KEYCODE_")
    when (event.action) {
      KeyEvent.ACTION_DOWN -> setPressed(name, true)
      KeyEvent.ACTION_UP -> setPressed(name, false)
    }
    return true
  }

  fun handleMotion(event: MotionEvent): Boolean {
    if (!isController(event.source) || event.actionMasked != MotionEvent.ACTION_MOVE) return false
    if (!capturing && !gameActive) return false

    val x = event.getAxisValue(MotionEvent.AXIS_X)
    val y = event.getAxisValue(MotionEvent.AXIS_Y)
    val hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X)
    val hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y)
    setPressed(STICK_LEFT, x < -STICK_THRESHOLD)
    setPressed(STICK_RIGHT, x > STICK_THRESHOLD)
    setPressed(STICK_UP, y < -STICK_THRESHOLD)
    setPressed(STICK_DOWN, y > STICK_THRESHOLD)
    // Many pads report their D-pad as a hat axis instead of as key presses.
    setPressed(NAME_LEFT, hatX < -STICK_THRESHOLD)
    setPressed(NAME_RIGHT, hatX > STICK_THRESHOLD)
    setPressed(NAME_UP, hatY < -STICK_THRESHOLD)
    setPressed(NAME_DOWN, hatY > STICK_THRESHOLD)

    val right = maxOf(event.getAxisValue(MotionEvent.AXIS_RTRIGGER), event.getAxisValue(MotionEvent.AXIS_GAS))
    val left = maxOf(event.getAxisValue(MotionEvent.AXIS_LTRIGGER), event.getAxisValue(MotionEvent.AXIS_BRAKE))
    setPressed(NAME_R2, abs(right) > TRIGGER_THRESHOLD)
    setPressed(NAME_L2, abs(left) > TRIGGER_THRESHOLD)
    return true
  }

  @Synchronized
  private fun setPressed(name: String, down: Boolean) {
    val changed = if (down) pressed.add(name) else pressed.remove(name)
    if (!changed) return

    if (capturing) {
      // Directions are fixed to the D-pad row, so they can't be assigned elsewhere.
      if (name !in DIRECTION_NAMES) {
        if (down) {
          captured.add(name)
        } else if (name in captured) {
          // Finishing on the first release lets a held combination be recorded together.
          capturing = false
          val keys = captured.toList()
          captured.clear()
          onCapture?.invoke(keys)
        }
      }
      return
    }
    applyMapping()
  }

  private fun isBound(action: String): Boolean {
    val keys = mapping[action].orEmpty()
    return keys.isNotEmpty() && pressed.containsAll(keys)
  }

  private fun applyMapping() {
    var buttons = 0
    for ((action, bit) in BUTTON_BITS) {
      if (isBound(action)) buttons = buttons or bit
    }
    if (NAME_UP in pressed || STICK_UP in pressed) buttons = buttons or BIT_UP
    if (NAME_DOWN in pressed || STICK_DOWN in pressed) buttons = buttons or BIT_DOWN
    if (NAME_LEFT in pressed || STICK_LEFT in pressed) buttons = buttons or BIT_LEFT
    if (NAME_RIGHT in pressed || STICK_RIGHT in pressed) buttons = buttons or BIT_RIGHT
    KrsEmulatorNative.setPadButtons(buttons)

    val holdFastForward = isBound("FAST_FORWARD")
    if (holdFastForward != fastForwardHeld) {
      fastForwardHeld = holdFastForward
      KrsEmulatorNative.setPadFastForward(holdFastForward)
    }

    for (action in FIRE_ONCE_ACTIONS) {
      if (isBound(action)) {
        if (activeActions.add(action)) onAction?.invoke(action)
      } else {
        activeActions.remove(action)
      }
    }
  }

  fun connectedControllers(): List<Map<String, Any?>> =
    InputDevice.getDeviceIds().toList().mapNotNull { InputDevice.getDevice(it) }
      .filter { !it.isVirtual && isGamepad(it.sources) }
      .map { device -> mapOf("name" to device.name, "battery" to batteryPercent(device)) }

  private fun batteryPercent(device: InputDevice): Int? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
    val battery = device.batteryState
    if (!battery.isPresent || battery.capacity.isNaN()) return null
    return (battery.capacity * 100).roundToInt()
  }
}

/** Sees controller input before the app, whichever view has focus. */
internal class KrsWindowCallback(private val base: Window.Callback) : Window.Callback by base {
  override fun dispatchKeyEvent(event: KeyEvent): Boolean =
    KrsInput.handleKey(event) || base.dispatchKeyEvent(event)

  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean =
    KrsInput.handleMotion(event) || base.dispatchGenericMotionEvent(event)

  override fun onProvideKeyboardShortcuts(
    data: MutableList<KeyboardShortcutGroup>?,
    menu: Menu?,
    deviceId: Int,
  ) = base.onProvideKeyboardShortcuts(data, menu, deviceId)

  override fun onPointerCaptureChanged(hasCapture: Boolean) =
    base.onPointerCaptureChanged(hasCapture)
}
