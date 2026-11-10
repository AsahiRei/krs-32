package expo.modules.krsemulator

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextUtils
import android.view.MotionEvent
import android.view.View
import com.facebook.react.common.assets.ReactFontManager
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.roundToInt

// Libretro joypad button ids.
private const val B = 0
private const val SELECT = 2
private const val START = 3
private const val UP = 4
private const val DOWN = 5
private const val LEFT = 6
private const val RIGHT = 7
private const val A = 8
private const val L = 10
private const val R = 11

// Controls with no joypad button, tracked in the same mask for their pressed look.
private const val MENU = 20
private const val FAST_FORWARD = 21
private const val JOYPAD_MASK = 0xFFFF

private const val DPAD_HALF_LENGTH = 95.75f
private const val DPAD_HALF_WIDTH = 31.75f
private const val DPAD_CORNER = 14f
private const val DPAD_TOUCH_RADIUS = 120f
private const val DPAD_DEAD_ZONE = 28f
private const val CHEVRON_DISTANCE = 63f
private const val CHEVRON_SIZE = 6f
private const val TOUCH_SLOP = 8f
private const val FACE_TOUCH_MARGIN = 12f
private const val TRACK_MARGIN = 9f
private const val TRACK_MAX_SPREAD = 1.5f
private const val TITLE_MAX_WIDTH = 216f
private const val STATS_INTERVAL_MS = 1000L
private const val PICTURE_ASPECT = 1.5f
private const val MAX_EXTRAS = 16
private const val ACTION_FAST_FORWARD = "FAST_FORWARD"
private const val TURBO_RING_WIDTH = 2f
private const val EXTRA_LABEL_HEIGHT_SHARE = 1f / 3f
private const val EXTRA_LABEL_WIDTH_SHARE = 0.8f

// Half a turbo cycle: ten presses a second, each spanning several frames so games register it.
private const val TURBO_HALF_PERIOD_MS = 50L

private val EXTRA_BUTTON_IDS = mapOf(
  "A" to A,
  "B" to B,
  "L" to L,
  "R" to R,
  "START" to START,
  "SELECT" to SELECT,
  "UP" to UP,
  "DOWN" to DOWN,
  "LEFT" to LEFT,
  "RIGHT" to RIGHT,
)

private val FILL = Color.parseColor("#1B1B20")
private val BORDER = Color.parseColor("#33333B")
private val TRACK = Color.parseColor("#141418")
private val FRAME = Color.parseColor("#2A2A31")
private val ACCENT = Color.parseColor("#5BC0FF")
private val ON_ACCENT = Color.parseColor("#0B0B0E")
private val FOREGROUND = Color.parseColor("#F3EFE7")
private val SECONDARY = Color.parseColor("#BDB9B0")
private val DOT = Color.parseColor("#3A3A42")
private val TURBO = Color.parseColor("#FF7A7A")

/** A button the player added in the control editor. */
private class ExtraButton(
  val rect: RectF,
  val label: String,
  val buttons: Int,
  val turbo: Boolean,
  val action: String?,
)

/** Positions in design units; the view scales the whole layout to fit its size. */
private class PlayerLayout(
  val width: Float,
  val height: Float,
  val game: RectF,
  val frame: RectF?,
  val shoulderL: RectF,
  val shoulderR: RectF,
  val select: RectF,
  val start: RectF,
  val menu: RectF,
  val fastForward: RectF,
  val dpad: PointF,
  val buttonA: PointF,
  val buttonB: PointF,
  val radiusA: Float,
  val radiusB: Float,
  val titleCenter: PointF?,
  val editableTop: Float,
  val dpadScale: Float = 1f,
  val opacity: Float = 1f,
  val extras: List<ExtraButton> = emptyList(),
) {
  val isPortrait: Boolean get() = frame != null
}

/** Moves and resizes a rectangle to a saved center and width, keeping its proportions. */
private fun RectF.placed(saved: JSONObject?): RectF {
  if (saved == null) return this
  val newWidth = saved.getDouble("size").toFloat()
  val newHeight = height() * newWidth / width()
  val x = saved.getDouble("x").toFloat()
  val y = saved.getDouble("y").toFloat()
  return RectF(x - newWidth / 2, y - newHeight / 2, x + newWidth / 2, y + newHeight / 2)
}

private fun PointF.placed(saved: JSONObject?): PointF =
  if (saved == null) this else PointF(saved.getDouble("x").toFloat(), saved.getDouble("y").toFloat())

private fun JSONObject?.radius(fallback: Float): Float =
  if (this == null) fallback else getDouble("size").toFloat() / 2

private fun parseExtras(saved: JSONObject): List<ExtraButton> {
  val list = saved.optJSONArray("extras") ?: return emptyList()
  val moved = saved.optJSONObject("controls")
  return List(min(list.length(), MAX_EXTRAS)) { index ->
    val item = list.getJSONObject(index)
    val x = item.getDouble("x").toFloat()
    val y = item.getDouble("y").toFloat()
    val halfWidth = item.getDouble("size").toFloat() / 2
    val halfHeight = halfWidth / item.getDouble("aspect").toFloat()
    val names = item.getJSONArray("buttons")
    var buttons = 0
    for (name in 0 until names.length()) {
      EXTRA_BUTTON_IDS[names.getString(name)]?.let { buttons = buttons or (1 shl it) }
    }
    ExtraButton(
      rect = RectF(x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight)
        .placed(moved?.optJSONObject(item.getString("id"))),
      label = item.getString("label"),
      buttons = buttons,
      turbo = item.getBoolean("turbo"),
      action = item.optString("action").takeIf { it.isNotEmpty() },
    )
  }
}

private fun PlayerLayout.withSaved(saved: JSONObject?): PlayerLayout {
  if (saved == null) return this
  val controls = saved.optJSONObject("controls")
  fun control(id: String) = controls?.optJSONObject(id)
  return PlayerLayout(
    width = width,
    height = height,
    game = game,
    frame = frame,
    shoulderL = shoulderL.placed(control("L")),
    shoulderR = shoulderR.placed(control("R")),
    select = select.placed(control("SELECT")),
    start = start.placed(control("START")),
    menu = menu.placed(control("MENU")),
    fastForward = fastForward.placed(control("FF")),
    dpad = dpad.placed(control("DPAD")),
    buttonA = buttonA.placed(control("A")),
    buttonB = buttonB.placed(control("B")),
    radiusA = control("A").radius(radiusA),
    radiusB = control("B").radius(radiusB),
    titleCenter = titleCenter,
    editableTop = editableTop,
    dpadScale = control("DPAD")?.let { it.getDouble("size").toFloat() / (DPAD_HALF_LENGTH * 2) } ?: 1f,
    opacity = saved.optDouble("opacity", opacity.toDouble()).toFloat(),
    extras = parseExtras(saved),
  )
}

private fun describe(rect: RectF, id: String, label: String, kind: String) = mapOf(
  "id" to id,
  "label" to label,
  "kind" to kind,
  "x" to rect.centerX(),
  "y" to rect.centerY(),
  "size" to rect.width(),
  "aspect" to rect.width() / rect.height(),
)

private fun describe(center: PointF, size: Float, id: String, label: String, kind: String) = mapOf(
  "id" to id,
  "label" to label,
  "kind" to kind,
  "x" to center.x,
  "y" to center.y,
  "size" to size,
  "aspect" to 1f,
)

private fun describe(layout: PlayerLayout): Map<String, Any> {
  val controls = mutableListOf(
    describe(layout.shoulderL, "L", "L", "rect"),
    describe(layout.shoulderR, "R", "R", "rect"),
    describe(layout.dpad, DPAD_HALF_LENGTH * 2, "DPAD", "D-PAD", "cross"),
    describe(layout.buttonA, layout.radiusA * 2, "A", "A", "round"),
    describe(layout.buttonB, layout.radiusB * 2, "B", "B", "round"),
    describe(layout.select, "SELECT", "SELECT", "pill"),
    describe(layout.start, "START", "START", "pill"),
  )
  // The portrait menu and fast-forward buttons live in the fixed row beside the title.
  if (!layout.isPortrait) {
    controls += describe(layout.fastForward, "FF", "2×", "pill")
    controls += describe(layout.menu, "MENU", "≡", "pill")
  }
  return mapOf(
    "width" to layout.width,
    "height" to layout.height,
    "top" to layout.editableTop,
    "game" to mapOf(
      "left" to layout.game.left,
      "top" to layout.game.top,
      "right" to layout.game.right,
      "bottom" to layout.game.bottom,
    ),
    "controls" to controls,
  )
}

/** The default layouts, so the control editor always matches what the player draws. */
internal fun controlDefaults(): Map<String, Any> =
  mapOf("portrait" to describe(PORTRAIT), "landscape" to describe(LANDSCAPE))

private val PORTRAIT = PlayerLayout(
  width = 412f,
  height = 772f,
  game = RectF(23f, 20f, 389f, 264f),
  frame = RectF(16f, 12.5f, 396f, 271.5f),
  shoulderL = RectF(12f, 408f, 108f, 456f),
  shoulderR = RectF(304f, 408f, 400f, 456f),
  select = RectF(108f, 716f, 196f, 760f),
  start = RectF(216f, 716f, 304f, 760f),
  menu = RectF(23.5f, 284f, 71f, 332f),
  fastForward = RectF(301f, 284f, 389f, 332f),
  dpad = PointF(108f, 588f),
  buttonA = PointF(358f, 540f),
  buttonB = PointF(280f, 604f),
  radiusA = 36f,
  radiusB = 38f,
  titleCenter = PointF(186f, 308f),
  editableTop = 340f,
)

private val LANDSCAPE = PlayerLayout(
  width = 917f,
  height = 412f,
  game = RectF(229f, 52.5f, 688f, 358.5f),
  frame = null,
  shoulderL = RectF(4f, 4f, 128f, 56f),
  shoulderR = RectF(789f, 4f, 913f, 56f),
  // Select and Start sit in the strip below the picture, so they don't cover the game.
  select = RectF(373f, 362f, 453f, 402f),
  start = RectF(464f, 362f, 544f, 402f),
  menu = RectF(466.5f, 6f, 538.5f, 54f),
  fastForward = RectF(378.5f, 6f, 450.5f, 54f),
  dpad = PointF(100f, 306f),
  buttonA = PointF(832f, 362f),
  buttonB = PointF(704f, 362f),
  radiusA = 38f,
  radiusB = 38f,
  titleCenter = null,
  editableTop = 0f,
  opacity = 0.7f,
)

private fun layoutFor(width: Int, height: Int) = if (width > height) LANDSCAPE else PORTRAIT

private fun scaleFor(layout: PlayerLayout, width: Int, height: Int) =
  min(width / layout.width, height / layout.height)

private fun offsetX(layout: PlayerLayout, width: Int, scale: Float) =
  (width - layout.width * scale) / 2

// Portrait hangs from the top like the design; landscape sits centered between the screen edges.
private fun offsetY(layout: PlayerLayout, height: Int, scale: Float) =
  if (layout.isPortrait) 0f else (height - layout.height * scale) / 2

/** Where the game picture belongs, in pixels, for a player of the given size. */
internal fun gameScreenBounds(width: Int, height: Int, stretch: Boolean): Rect {
  val layout = layoutFor(width, height)
  // Landscape gives the picture all the height it can use, with the controls floating over it.
  if (!layout.isPortrait) {
    if (stretch) return Rect(0, 0, width, height)
    val pictureWidth = min(width.toFloat(), height * PICTURE_ASPECT).roundToInt()
    val pictureHeight = (pictureWidth / PICTURE_ASPECT).roundToInt()
    val left = (width - pictureWidth) / 2
    val top = (height - pictureHeight) / 2
    return Rect(left, top, left + pictureWidth, top + pictureHeight)
  }
  val scale = scaleFor(layout, width, height)
  val x = offsetX(layout, width, scale)
  val y = offsetY(layout, height, scale)
  return Rect(
    (x + layout.game.left * scale).roundToInt(),
    (y + layout.game.top * scale).roundToInt(),
    (x + layout.game.right * scale).roundToInt(),
    (y + layout.game.bottom * scale).roundToInt(),
  )
}

/** Multi-touch GBA controls. Touches go straight to the emulator without passing through JS. */
internal class KrsControlsView(context: Context, private val onMenuPress: () -> Unit) : View(context) {
  private var layout = PORTRAIT
  private var savedLayouts: JSONObject? = null
  private var scale = 1f
  private var originX = 0f
  private var originY = 0f
  private var mask = 0
  private var extrasDown = 0
  private var sentButtons = 0
  private var turboRunning = false
  private var turboPressed = false
  private var fastForward = false
  private var fastForwardLabel = "2×"
  private var title = ""
  private var displayTitle = ""
  private var fps = 0.0

  private val shape = Paint(Paint.ANTI_ALIAS_FLAG)
  private val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val glyph = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textAlign = Paint.Align.CENTER
    isSubpixelText = true
  }
  private val fontBold = loadFont("Inter_700Bold")
  private val fontSemiBold = loadFont("Inter_600SemiBold")
  private val fontMono = loadFont("JetBrainsMono_400Regular")
  private val path = Path()

  private val dpadHalfLength get() = DPAD_HALF_LENGTH * layout.dpadScale
  private val dpadHalfWidth get() = DPAD_HALF_WIDTH * layout.dpadScale
  private val dpadCorner get() = DPAD_CORNER * layout.dpadScale
  private val dpadTouchRadius get() = DPAD_TOUCH_RADIUS * layout.dpadScale
  private val dpadDeadZone get() = DPAD_DEAD_ZONE * layout.dpadScale
  private val chevronDistance get() = CHEVRON_DISTANCE * layout.dpadScale
  private val chevronSize get() = CHEVRON_SIZE * layout.dpadScale

  private val statsTicker = object : Runnable {
    override fun run() {
      fps = KrsEmulatorNative.getStats()[0]
      invalidate()
      postDelayed(this, STATS_INTERVAL_MS)
    }
  }

  private val turboTicker = object : Runnable {
    override fun run() {
      turboPressed = !turboPressed
      sendButtons()
      postDelayed(this, TURBO_HALF_PERIOD_MS)
    }
  }

  init {
    contentDescription = "Game controls"
  }

  private fun loadFont(family: String): Typeface =
    ReactFontManager.getInstance().getTypeface(family, Typeface.NORMAL, context.assets)

  fun setTitle(value: String) {
    title = value
    updateDisplayTitle()
    invalidate()
  }

  fun setControlLayout(json: String) {
    savedLayouts = if (json.isEmpty()) null else JSONObject(json)
    if (width > 0) applyLayout(width, height)
    invalidate()
  }

  private fun applyLayout(w: Int, h: Int) {
    val base = layoutFor(w, h)
    // Held bits index the old list of added buttons, so they can't carry over to a new one.
    if (extrasDown != 0) {
      extrasDown = 0
      updateTurbo()
      sendButtons()
    }
    layout = base.withSaved(savedLayouts?.optJSONObject(if (base.isPortrait) "portrait" else "landscape"))
    scale = scaleFor(base, w, h)
    originX = offsetX(base, w, scale)
    originY = offsetY(base, h, scale)
  }

  fun setFastForwardSpeed(speed: Double) {
    KrsEmulatorNative.setFastForwardSpeed(speed)
    val number = if (speed % 1.0 == 0.0) speed.toInt().toString() else speed.toString()
    fastForwardLabel = "$number×"
    invalidate()
  }

  private fun updateDisplayTitle() {
    text.typeface = fontSemiBold
    text.textSize = 16.5f
    displayTitle =
      TextUtils.ellipsize(title, android.text.TextPaint(text), TITLE_MAX_WIDTH, TextUtils.TruncateAt.END)
        .toString()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    post(statsTicker)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    removeCallbacks(statsTicker)
    removeCallbacks(turboTicker)
    turboRunning = false
    turboPressed = false
    // Fast-forward stays as it is: this also runs when a screen opens on top of the Player.
    // Starting a game is what resets it.
    mask = 0
    extrasDown = 0
    sentButtons = 0
    KrsEmulatorNative.setButtons(0)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    applyLayout(w, h)
  }

  private fun isDown(id: Int) = mask and (1 shl id) != 0

  override fun onDraw(canvas: Canvas) {
    canvas.save()
    canvas.translate(originX, originY)
    canvas.scale(scale, scale)

    layout.frame?.let { frame ->
      outline.color = FRAME
      outline.strokeWidth = 1f
      canvas.drawRoundRect(frame, 18f, 18f, outline)
    }

    canvas.saveLayerAlpha(0f, 0f, layout.width, layout.height, (layout.opacity * 255).roundToInt())
    drawDpad(canvas)
    drawFaceButtons(canvas)
    drawLabelled(canvas, layout.shoulderL, 14f, "L", 20f, L)
    drawLabelled(canvas, layout.shoulderR, 14f, "R", 20f, R)
    drawLabelled(canvas, layout.select, 24f, "SELECT", 13f, SELECT, spaced = true)
    drawLabelled(canvas, layout.start, 24f, "START", 13f, START, spaced = true)
    if (!layout.isPortrait) {
      drawMenuButton(canvas)
      drawFastForward(canvas)
    }
    layout.extras.forEachIndexed { index, extra ->
      val latched = extra.action == ACTION_FAST_FORWARD && fastForward
      drawExtra(canvas, extra, isExtraDown(index) || latched)
    }
    canvas.restore()

    if (layout.isPortrait) {
      drawMenuButton(canvas)
      drawFastForward(canvas)
    }
    drawTitle(canvas)

    canvas.restore()
  }

  private fun drawPanel(canvas: Canvas, rect: RectF, corner: Float, pressed: Boolean) {
    shape.color = if (pressed) ACCENT else FILL
    canvas.drawRoundRect(rect, corner, corner, shape)
    if (!pressed) {
      outline.color = BORDER
      outline.strokeWidth = 1f
      canvas.drawRoundRect(rect, corner, corner, outline)
    }
  }

  private fun drawCenteredText(canvas: Canvas, value: String, x: Float, centerY: Float) {
    canvas.drawText(value, x, centerY - (text.ascent() + text.descent()) / 2, text)
  }

  private fun drawLabelled(
    canvas: Canvas,
    rect: RectF,
    corner: Float,
    label: String,
    size: Float,
    id: Int,
    spaced: Boolean = false,
  ) {
    val pressed = isDown(id)
    drawPanel(canvas, rect, corner, pressed)
    text.typeface = fontBold
    text.textSize = size
    text.letterSpacing = if (spaced) 0.1f else 0f
    text.color = if (pressed) ON_ACCENT else FOREGROUND
    drawCenteredText(canvas, label, rect.centerX(), rect.centerY())
    text.letterSpacing = 0f
  }

  private fun drawDpad(canvas: Canvas) {
    val center = layout.dpad
    val vertical = RectF(
      center.x - dpadHalfWidth,
      center.y - dpadHalfLength,
      center.x + dpadHalfWidth,
      center.y + dpadHalfLength,
    )
    val horizontal = RectF(
      center.x - dpadHalfLength,
      center.y - dpadHalfWidth,
      center.x + dpadHalfLength,
      center.y + dpadHalfWidth,
    )

    path.reset()
    path.addRoundRect(vertical, dpadCorner, dpadCorner, Path.Direction.CW)
    val crossBar = Path().apply {
      addRoundRect(horizontal, dpadCorner, dpadCorner, Path.Direction.CW)
    }
    path.op(crossBar, Path.Op.UNION)
    shape.color = FILL
    canvas.drawPath(path, shape)
    outline.color = BORDER
    outline.strokeWidth = 1f
    canvas.drawPath(path, outline)

    val inner = dpadHalfWidth
    val outer = dpadHalfLength
    drawArm(canvas, UP, vertical, center.x - inner, center.y - outer, center.x + inner, center.y - inner)
    drawArm(canvas, DOWN, vertical, center.x - inner, center.y + inner, center.x + inner, center.y + outer)
    drawArm(canvas, LEFT, horizontal, center.x - outer, center.y - inner, center.x - inner, center.y + inner)
    drawArm(canvas, RIGHT, horizontal, center.x + inner, center.y - inner, center.x + outer, center.y + inner)

    drawChevron(canvas, UP, 0f, -1f)
    drawChevron(canvas, DOWN, 0f, 1f)
    drawChevron(canvas, LEFT, -1f, 0f)
    drawChevron(canvas, RIGHT, 1f, 0f)

    if (layout.isPortrait) {
      shape.color = Color.parseColor("#26262D")
      canvas.drawCircle(center.x, center.y, 8f, shape)
      shape.color = DOT
      for (x in listOf(-1f, 1f)) {
        for (y in listOf(-1f, 1f)) {
          canvas.drawCircle(center.x + x * chevronDistance, center.y + y * chevronDistance, 3f, shape)
        }
      }
    }
  }

  private fun drawArm(
    canvas: Canvas,
    id: Int,
    bar: RectF,
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
  ) {
    if (!isDown(id)) return
    canvas.save()
    canvas.clipRect(left, top, right, bottom)
    shape.color = ACCENT
    canvas.drawRoundRect(bar, dpadCorner, dpadCorner, shape)
    canvas.restore()
  }

  private fun drawChevron(canvas: Canvas, id: Int, dx: Float, dy: Float) {
    val tipX = layout.dpad.x + dx * (chevronDistance + chevronSize / 2)
    val tipY = layout.dpad.y + dy * (chevronDistance + chevronSize / 2)
    val backX = tipX - dx * chevronSize
    val backY = tipY - dy * chevronSize
    path.reset()
    path.moveTo(backX + dy * chevronSize * 1.6f, backY + dx * chevronSize * 1.6f)
    path.lineTo(tipX, tipY)
    path.lineTo(backX - dy * chevronSize * 1.6f, backY - dx * chevronSize * 1.6f)
    glyph.color = if (isDown(id)) ON_ACCENT else FOREGROUND
    glyph.strokeWidth = 2f
    canvas.drawPath(path, glyph)
  }

  private fun drawFaceButtons(canvas: Canvas) {
    val a = layout.buttonA
    val b = layout.buttonB
    val trackRadius = maxOf(layout.radiusA, layout.radiusB) + TRACK_MARGIN

    // The joining track only makes sense while the two buttons still sit together.
    if (hypot(a.x - b.x, a.y - b.y) < (layout.radiusA + layout.radiusB) * TRACK_MAX_SPREAD) {
      glyph.strokeWidth = (trackRadius + 0.75f) * 2
      glyph.color = FRAME
      canvas.drawLine(a.x, a.y, b.x, b.y, glyph)
      glyph.strokeWidth = trackRadius * 2
      glyph.color = TRACK
      canvas.drawLine(a.x, a.y, b.x, b.y, glyph)
    }

    drawFaceButton(canvas, a, layout.radiusA, "A", A)
    drawFaceButton(canvas, b, layout.radiusB, "B", B)
  }

  private fun drawFaceButton(canvas: Canvas, center: PointF, radius: Float, label: String, id: Int) {
    val pressed = isDown(id)
    shape.color = if (pressed) ACCENT else FILL
    canvas.drawCircle(center.x, center.y, radius, shape)
    if (!pressed) {
      outline.color = BORDER
      outline.strokeWidth = 1f
      canvas.drawCircle(center.x, center.y, radius, outline)
    }
    text.typeface = fontBold
    text.textSize = 24f
    text.color = if (pressed) ON_ACCENT else FOREGROUND
    drawCenteredText(canvas, label, center.x, center.y)
  }

  private fun drawExtra(canvas: Canvas, extra: ExtraButton, pressed: Boolean) {
    val rect = extra.rect
    val corner = rect.height() / 2
    drawPanel(canvas, rect, corner, pressed)
    if (extra.turbo && !pressed) {
      outline.color = TURBO
      outline.strokeWidth = TURBO_RING_WIDTH
      canvas.drawRoundRect(rect, corner, corner, outline)
    }
    text.typeface = fontBold
    text.textSize = rect.height() * EXTRA_LABEL_HEIGHT_SHARE
    val available = rect.width() * EXTRA_LABEL_WIDTH_SHARE
    val measured = text.measureText(extra.label)
    if (measured > available) text.textSize *= available / measured
    text.color = if (pressed) ON_ACCENT else if (extra.turbo) TURBO else FOREGROUND
    drawCenteredText(canvas, extra.label, rect.centerX(), rect.centerY())
  }

  private fun drawMenuButton(canvas: Canvas) {
    val rect = layout.menu
    val pressed = isDown(MENU)
    drawPanel(canvas, rect, if (layout.isPortrait) 14f else 24f, pressed)
    glyph.color = if (pressed) ON_ACCENT else FOREGROUND
    glyph.strokeWidth = 2f
    for (row in -1..1) {
      val y = rect.centerY() + row * 6.5f
      canvas.drawLine(rect.centerX() - 8f, y, rect.centerX() + 8f, y, glyph)
    }
  }

  private fun drawFastForward(canvas: Canvas) {
    val rect = layout.fastForward
    val lit = fastForward || isDown(FAST_FORWARD)
    drawPanel(canvas, rect, if (layout.isPortrait) 14f else 24f, lit)
    val color = if (lit) ON_ACCENT else FOREGROUND
    val iconLeft = rect.centerX() - 22f
    val halfHeight = 7f

    glyph.color = color
    glyph.strokeWidth = 1.75f
    for (start in listOf(iconLeft, iconLeft + 9f)) {
      path.reset()
      path.moveTo(start, rect.centerY() - halfHeight)
      path.lineTo(start + 9f, rect.centerY())
      path.lineTo(start, rect.centerY() + halfHeight)
      path.close()
      canvas.drawPath(path, glyph)
    }

    text.typeface = fontMono
    text.textSize = 15f
    text.color = color
    drawCenteredText(canvas, fastForwardLabel, rect.centerX() + 13f, rect.centerY())
  }

  private fun drawTitle(canvas: Canvas) {
    val center = layout.titleCenter ?: return
    text.typeface = fontSemiBold
    text.textSize = 16.5f
    text.color = FOREGROUND
    drawCenteredText(canvas, displayTitle, center.x, center.y - 10f)

    text.typeface = fontMono
    text.textSize = 12.5f
    text.color = SECONDARY
    val rate = if (fps > 0) fps.roundToInt().toString() else "--"
    drawCenteredText(canvas, "$rate fps", center.x, center.y + 11f)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    parent?.requestDisallowInterceptTouchEvent(true)

    var next = 0
    var nextExtras = 0
    val action = event.actionMasked
    if (action != MotionEvent.ACTION_UP && action != MotionEvent.ACTION_CANCEL) {
      val lifted = if (action == MotionEvent.ACTION_POINTER_UP) event.actionIndex else -1
      for (index in 0 until event.pointerCount) {
        if (index == lifted) continue
        val x = designX(event, index)
        val y = designY(event, index)
        val extra = extraAt(x, y)
        if (extra >= 0) nextExtras = nextExtras or (1 shl extra) else next = next or hitTest(x, y)
      }
    }

    if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {
      val index = event.actionIndex
      val x = designX(event, index)
      val y = designY(event, index)
      val extra = extraAt(x, y)
      if (extra >= 0) {
        val extraAction = layout.extras[extra].action
        if (extraAction == ACTION_FAST_FORWARD) {
          toggleFastForward()
        } else if (extraAction != null) {
          KrsInput.onAction?.invoke(extraAction)
        }
      } else if (inButton(layout.fastForward, x, y)) {
        toggleFastForward()
      } else if (inButton(layout.menu, x, y)) {
        onMenuPress()
      }
    }

    if (next != mask || nextExtras != extrasDown) {
      mask = next
      extrasDown = nextExtras
      updateTurbo()
      sendButtons()
      invalidate()
    } else if (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_POINTER_DOWN) {
      invalidate()
    }
    return true
  }

  private fun toggleFastForward() {
    fastForward = !fastForward
    KrsEmulatorNative.setFastForward(fastForward)
  }

  private fun isExtraDown(index: Int) = extrasDown and (1 shl index) != 0

  /** The topmost added button under a point, or -1. They draw last, so they take the touch first. */
  private fun extraAt(x: Float, y: Float): Int {
    for (index in layout.extras.indices.reversed()) {
      if (inButton(layout.extras[index].rect, x, y)) return index
    }
    return -1
  }

  private fun updateTurbo() {
    var held = false
    layout.extras.forEachIndexed { index, extra -> if (extra.turbo && isExtraDown(index)) held = true }
    if (held == turboRunning) return
    turboRunning = held
    removeCallbacks(turboTicker)
    turboPressed = held
    if (held) postDelayed(turboTicker, TURBO_HALF_PERIOD_MS)
  }

  private fun sendButtons() {
    var buttons = mask and JOYPAD_MASK
    layout.extras.forEachIndexed { index, extra ->
      if (isExtraDown(index) && (!extra.turbo || turboPressed)) buttons = buttons or extra.buttons
    }
    if (buttons != sentButtons) {
      sentButtons = buttons
      KrsEmulatorNative.setButtons(buttons)
    }
  }

  private fun designX(event: MotionEvent, index: Int) = (event.getX(index) - originX) / scale

  private fun designY(event: MotionEvent, index: Int) = (event.getY(index) - originY) / scale

  private fun inButton(rect: RectF, x: Float, y: Float) =
    x >= rect.left - TOUCH_SLOP && x <= rect.right + TOUCH_SLOP &&
      y >= rect.top - TOUCH_SLOP && y <= rect.bottom + TOUCH_SLOP

  private fun hitTest(x: Float, y: Float): Int {
    val dx = x - layout.dpad.x
    val dy = y - layout.dpad.y
    if (hypot(dx, dy) <= dpadTouchRadius) {
      var result = 0
      if (abs(dx) > dpadDeadZone) result = result or (1 shl (if (dx < 0) LEFT else RIGHT))
      if (abs(dy) > dpadDeadZone) result = result or (1 shl (if (dy < 0) UP else DOWN))
      return result
    }

    // The two touch areas overlap slightly, so one thumb between them presses A and B together.
    var face = 0
    if (hypot(x - layout.buttonA.x, y - layout.buttonA.y) <= layout.radiusA + FACE_TOUCH_MARGIN) {
      face = face or (1 shl A)
    }
    if (hypot(x - layout.buttonB.x, y - layout.buttonB.y) <= layout.radiusB + FACE_TOUCH_MARGIN) {
      face = face or (1 shl B)
    }
    if (face != 0) return face

    return when {
      inButton(layout.shoulderL, x, y) -> 1 shl L
      inButton(layout.shoulderR, x, y) -> 1 shl R
      inButton(layout.select, x, y) -> 1 shl SELECT
      inButton(layout.start, x, y) -> 1 shl START
      inButton(layout.menu, x, y) -> 1 shl MENU
      inButton(layout.fastForward, x, y) -> 1 shl FAST_FORWARD
      else -> 0
    }
  }
}
