package expo.modules.krsemulator

import android.content.Context
import android.graphics.Rect
import android.view.SurfaceHolder
import android.view.SurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** The full player: the game picture plus the controls laid out around it for the orientation. */
class KrsEmulatorView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), SurfaceHolder.Callback {

  override val shouldUseAndroidLayout: Boolean
    get() = true

  private val onMenuPress by EventDispatcher<Map<String, Any>>()
  private val onSwapScreensPress by EventDispatcher<Map<String, Any>>()
  private val onScreenLayoutPress by EventDispatcher<Map<String, Any>>()
  private val controls = KrsControlsView(
    context,
    onMenuPress = { onMenuPress(emptyMap()) },
    onSwapPress = { onSwapScreensPress(emptyMap()) },
    onScreensPress = { onScreenLayoutPress(emptyMap()) },
    onScreenAreaChange = { requestLayout() },
  )
  private val gameScreen = SurfaceView(context)
  private var stretchVideo = false
  private var system = GameSystem.GBA
  private var dsLayout = DsScreenLayout()
  private var screenRects: FloatArray? = null

  init {
    gameScreen.keepScreenOn = true
    gameScreen.holder.addCallback(this)
    // The controls go on top so they can sit over the picture in landscape.
    addView(gameScreen)
    addView(controls)
  }

  fun setStretchVideo(stretch: Boolean) {
    if (stretch == stretchVideo) return
    stretchVideo = stretch
    requestLayout()
  }

  internal fun setSystem(value: GameSystem) {
    if (value == system) return
    system = value
    controls.setSystem(value)
    requestLayout()
  }

  fun setScreenLayout(json: String) {
    val parsed = DsScreenLayout.parse(json)
    if (parsed == dsLayout) return
    dsLayout = parsed
    requestLayout()
  }

  fun setAutoHideControls(value: Boolean) {
    controls.setAutoHideControls(value)
  }

  fun setTitle(title: String) {
    controls.setTitle(title)
  }

  fun setControlLayout(json: String) {
    controls.setControlLayout(json)
  }

  fun setFastForwardSpeed(speed: Double) {
    controls.setFastForwardSpeed(speed)
  }

  // React Native sets this view's frame without measuring it, so the children are sized here.
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    layoutChild(controls, 0, 0, width, height)
    if (system == GameSystem.NDS) {
      layoutDsScreens(width, height)
    } else {
      screenRects = null
      KrsEmulatorNative.setScreenRects(null)
      val game = gameScreenBounds(width, height, stretchVideo, system)
      layoutChild(gameScreen, game.left, game.top, game.right, game.bottom)
    }
  }

  // The surface covers both screens; the renderer draws each into its own part of it.
  private fun layoutDsScreens(width: Int, height: Int) {
    val box = controls.dsScreenBox(width, height)
    val screens = arrangeDsScreens(box, dsLayout, resources.displayMetrics.density)
    val surface = screens.bounds
    if (surface.isEmpty) surface.set(0, 0, 1, 1)
    layoutChild(gameScreen, surface.left, surface.top, surface.right, surface.bottom)
    controls.setDsScreens(screens)

    fun relative(rect: Rect) = if (rect.isEmpty) {
      floatArrayOf(0f, 0f, 0f, 0f)
    } else {
      floatArrayOf(
        (rect.left - surface.left).toFloat(),
        (rect.top - surface.top).toFloat(),
        rect.width().toFloat(),
        rect.height().toFloat(),
      )
    }
    val rects = relative(screens.main) + relative(screens.touch)
    screenRects = rects
    KrsEmulatorNative.setScreenRects(rects)
  }

  private fun layoutChild(child: android.view.View, left: Int, top: Int, right: Int, bottom: Int) {
    child.measure(
      MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(bottom - top, MeasureSpec.EXACTLY),
    )
    child.layout(left, top, right, bottom)
  }

  override fun surfaceCreated(holder: SurfaceHolder) {
    KrsEmulatorNative.setSurface(holder.surface)
  }

  // Sending the rectangles again redraws a paused game at the surface's new size.
  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    screenRects?.let { KrsEmulatorNative.setScreenRects(it) }
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    KrsEmulatorNative.setSurface(null)
  }
}
