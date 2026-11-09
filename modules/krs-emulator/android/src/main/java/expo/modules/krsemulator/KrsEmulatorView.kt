package expo.modules.krsemulator

import android.content.Context
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
  private val controls = KrsControlsView(context) { onMenuPress(emptyMap()) }
  private val gameScreen = SurfaceView(context)
  private var stretchVideo = false

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
    val game = gameScreenBounds(width, height, stretchVideo)
    layoutChild(gameScreen, game.left, game.top, game.right, game.bottom)
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

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    KrsEmulatorNative.setSurface(null)
  }
}
