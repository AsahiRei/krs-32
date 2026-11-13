#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <dlfcn.h>
#include <jni.h>
#include <oboe/Oboe.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "libretro.h"

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "KrsEmulator", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "KrsEmulator", __VA_ARGS__)

// Newer than the libretro.h that ships with mGBA.
#ifndef RETRO_DEVICE_ID_POINTER_IS_OFFSCREEN
#define RETRO_DEVICE_ID_POINTER_IS_OFFSCREEN 15
#endif

namespace {

using Clock = std::chrono::steady_clock;

// Matches the system numbers in KrsEmulatorNative.kt.
enum class System { Gba = 0, Nds = 1 };

// The GBA addresses at most 32 MB of ROM; mGBA ignores anything past that, so slightly
// oversized (padded) dumps still load. Beyond this it's surely not a GBA ROM.
constexpr size_t kMaxGbaRomSize = 64 * 1024 * 1024;
// The largest DS cartridges are 512 MB.
constexpr size_t kMaxNdsRomSize = 512 * 1024 * 1024;
constexpr size_t kNdsHeaderSize = 0x200;
constexpr int kSaveCheckFrames = 120;

// --- Cores ----------------------------------------------------------------------------------------

#define KRS_CORE_FUNCTIONS(X)        \
  X(retro_set_environment)           \
  X(retro_set_video_refresh)         \
  X(retro_set_audio_sample)          \
  X(retro_set_audio_sample_batch)    \
  X(retro_set_input_poll)            \
  X(retro_set_input_state)           \
  X(retro_init)                      \
  X(retro_deinit)                    \
  X(retro_api_version)               \
  X(retro_get_system_info)           \
  X(retro_get_system_av_info)        \
  X(retro_reset)                     \
  X(retro_run)                       \
  X(retro_serialize_size)            \
  X(retro_serialize)                 \
  X(retro_unserialize)               \
  X(retro_cheat_reset)               \
  X(retro_cheat_set)                 \
  X(retro_load_game)                 \
  X(retro_unload_game)               \
  X(retro_get_memory_data)           \
  X(retro_get_memory_size)

// A libretro core opened at run time. Every core exports the same retro_* names, so they can't
// all be linked into this library; each is opened privately and called through these pointers.
struct CoreLibrary {
  void *handle = nullptr;
#define KRS_CORE_MEMBER(name) decltype(&::name) name = nullptr;
  KRS_CORE_FUNCTIONS(KRS_CORE_MEMBER)
#undef KRS_CORE_MEMBER
};

const char *coreFileName(System system) {
  return system == System::Nds ? "libmelondsds_libretro.so" : "libmgba_libretro.so";
}

// Opens the system's core the first time it's needed. Cores stay loaded for the life of the app,
// so the returned pointer never dangles. Null if this device's build doesn't include the core.
const CoreLibrary *loadCore(System system) {
  static std::mutex mutex;
  static CoreLibrary cores[2];
  std::lock_guard<std::mutex> lock(mutex);
  CoreLibrary &core = cores[static_cast<int>(system)];
  if (core.handle) return &core;

  void *handle = dlopen(coreFileName(system), RTLD_NOW | RTLD_LOCAL);
  if (!handle) {
    LOGE("Could not open %s: %s", coreFileName(system), dlerror());
    return nullptr;
  }
  CoreLibrary loaded;
  bool complete = true;
#define KRS_CORE_LOAD(name)                                                      \
  loaded.name = reinterpret_cast<decltype(loaded.name)>(dlsym(handle, #name));   \
  if (!loaded.name) {                                                            \
    LOGE("%s is missing %s", coreFileName(system), #name);                       \
    complete = false;                                                            \
  }
  KRS_CORE_FUNCTIONS(KRS_CORE_LOAD)
#undef KRS_CORE_LOAD
  if (!complete) {
    dlclose(handle);
    return nullptr;
  }
  loaded.handle = handle;
  core = loaded;
  return &core;
}

// The running game's core. Set before the emulator thread starts and cleared after it ends.
const CoreLibrary *gCore = nullptr;
System gSystem = System::Gba;

// --- Audio ----------------------------------------------------------------------------------------

// Single-producer (emulator thread), single-consumer (audio callback) stereo ring buffer.
class AudioRing {
 public:
  static constexpr size_t kCapacity = 4096;

  size_t write(const int16_t *samples, size_t frames) {
    const size_t head = head_.load(std::memory_order_relaxed);
    const size_t tail = tail_.load(std::memory_order_acquire);
    const size_t count = std::min(frames, kCapacity - (head - tail));
    for (size_t i = 0; i < count; i++) {
      const size_t slot = (head + i) & (kCapacity - 1);
      data_[slot * 2] = samples[i * 2];
      data_[slot * 2 + 1] = samples[i * 2 + 1];
    }
    head_.store(head + count, std::memory_order_release);
    return count;
  }

  size_t read(int16_t *samples, size_t frames) {
    const size_t tail = tail_.load(std::memory_order_relaxed);
    const size_t head = head_.load(std::memory_order_acquire);
    const size_t count = std::min(frames, head - tail);
    for (size_t i = 0; i < count; i++) {
      const size_t slot = (tail + i) & (kCapacity - 1);
      samples[i * 2] = data_[slot * 2];
      samples[i * 2 + 1] = data_[slot * 2 + 1];
    }
    tail_.store(tail + count, std::memory_order_release);
    return count;
  }

  size_t fill() const {
    return head_.load(std::memory_order_acquire) - tail_.load(std::memory_order_acquire);
  }

  // Only safe while the audio stream is stopped.
  void clear() { tail_.store(head_.load()); }

 private:
  int16_t data_[kCapacity * 2]{};
  std::atomic<size_t> head_{0};
  std::atomic<size_t> tail_{0};
};

constexpr size_t kAudioTargetFill = AudioRing::kCapacity / 4;

AudioRing gRing;
std::atomic<bool> gAudioPrimed{false};
std::atomic<uint64_t> gUnderruns{0};
std::atomic<uint64_t> gOverruns{0};

class AudioOut final : public oboe::AudioStreamDataCallback,
                       public oboe::AudioStreamErrorCallback {
 public:
  bool open(int sampleRate) {
    std::lock_guard<std::mutex> lock(mutex_);
    sampleRate_ = sampleRate;
    wanted_ = true;
    return openLocked();
  }

  void start() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (stream_) stream_->requestStart();
  }

  void stop() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (stream_) stream_->requestStop();
  }

  void close() {
    std::lock_guard<std::mutex> lock(mutex_);
    wanted_ = false;
    if (stream_) {
      stream_->close();
      stream_.reset();
    }
  }

  oboe::DataCallbackResult onAudioReady(oboe::AudioStream *, void *audioData,
                                        int32_t numFrames) override {
    auto *out = static_cast<int16_t *>(audioData);
    const size_t got = gRing.read(out, static_cast<size_t>(numFrames));
    if (got < static_cast<size_t>(numFrames)) {
      std::memset(out + got * 2, 0, (numFrames - got) * 2 * sizeof(int16_t));
      if (gAudioPrimed.load()) gUnderruns.fetch_add(1);
    }
    return oboe::DataCallbackResult::Continue;
  }

  // The output device changed (for example headphones were unplugged), so reopen on the new one.
  void onErrorAfterClose(oboe::AudioStream *, oboe::Result error) override {
    if (error != oboe::Result::ErrorDisconnected) return;
    std::lock_guard<std::mutex> lock(mutex_);
    if (wanted_ && openLocked()) stream_->requestStart();
  }

 private:
  bool openLocked() {
    oboe::AudioStreamBuilder builder;
    builder.setDirection(oboe::Direction::Output)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setSharingMode(oboe::SharingMode::Shared)
        ->setUsage(oboe::Usage::Game)
        ->setFormat(oboe::AudioFormat::I16)
        ->setFormatConversionAllowed(true)
        ->setChannelCount(oboe::ChannelCount::Stereo)
        ->setChannelConversionAllowed(true)
        ->setSampleRate(sampleRate_)
        ->setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Medium)
        ->setDataCallback(this)
        ->setErrorCallback(this);
    const oboe::Result result = builder.openStream(stream_);
    if (result != oboe::Result::OK) {
      LOGE("Could not open audio stream: %s", oboe::convertToText(result));
      stream_.reset();
      return false;
    }
    return true;
  }

  std::mutex mutex_;
  std::shared_ptr<oboe::AudioStream> stream_;
  int sampleRate_ = 32768;
  bool wanted_ = false;
};

AudioOut gAudio;

// --- Video ----------------------------------------------------------------------------------------

constexpr int kFilterSmooth = 1;
constexpr int kFilterLcd = 2;
constexpr int kFilterScanlines = 3;
constexpr int kAspect4By3 = 1;
constexpr int kAspectStretch = 2;
constexpr int kScalingInteger = 0;

std::atomic<int> gVideoFilter{0};
std::atomic<float> gVideoStrength{0.4f};
std::atomic<int> gVideoAspect{0};
std::atomic<int> gVideoScaling{1};

// Where each of the DS's two screens goes within the surface, in pixels from the top left. The
// core draws them stacked in one frame; index 0 is its top half and 1 its bottom (touch) half. A
// rectangle with no width is hidden. Set from the UI thread, read when drawing.
struct ScreenRect {
  float left = 0;
  float top = 0;
  float width = 0;
  float height = 0;
};

std::mutex gScreenRectsMutex;
ScreenRect gScreenRects[2];
bool gScreenRectsSet = false;

// The pixel format the core asked for. Only the emulator thread touches it.
retro_pixel_format gPixelFormat = RETRO_PIXEL_FORMAT_RGB565;

size_t bytesPerPixel(retro_pixel_format format) {
  return format == RETRO_PIXEL_FORMAT_XRGB8888 ? 4 : 2;
}

// A copy of the latest frame exactly as the core produced it.
struct Frame {
  std::vector<uint8_t> pixels;
  int width = 0;
  int height = 0;
  size_t pitch = 0;
  retro_pixel_format format = RETRO_PIXEL_FORMAT_RGB565;

  bool empty() const { return pixels.empty(); }
};

GLuint compileShader(GLenum type, const char *source) {
  const GLuint shader = glCreateShader(type);
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);
  GLint ok = GL_FALSE;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
  if (ok != GL_TRUE) LOGE("Shader failed to compile");
  return shader;
}

class Renderer {
 public:
  bool init(ANativeWindow *window) {
    display_ = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (display_ == EGL_NO_DISPLAY || !eglInitialize(display_, nullptr, nullptr)) return false;

    const EGLint configAttribs[] = {EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_SURFACE_TYPE,
                                    EGL_WINDOW_BIT,      EGL_RED_SIZE,       5,
                                    EGL_GREEN_SIZE,      6,                  EGL_BLUE_SIZE,
                                    5,                   EGL_NONE};
    EGLConfig config;
    EGLint numConfigs = 0;
    if (!eglChooseConfig(display_, configAttribs, &config, 1, &numConfigs) || numConfigs < 1) {
      destroy();
      return false;
    }

    const EGLint contextAttribs[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    context_ = eglCreateContext(display_, config, EGL_NO_CONTEXT, contextAttribs);
    surface_ = eglCreateWindowSurface(display_, config, window, nullptr);
    if (context_ == EGL_NO_CONTEXT || surface_ == EGL_NO_SURFACE ||
        !eglMakeCurrent(display_, surface_, surface_, context_)) {
      destroy();
      return false;
    }

    // The emulator thread sets the pace, so presenting must never block on the display.
    eglSwapInterval(display_, 0);

    program_ = glCreateProgram();
    glAttachShader(program_, compileShader(GL_VERTEX_SHADER, R"(
      attribute vec2 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      void main() {
        vTexCoord = aTexCoord;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      })"));
    glAttachShader(program_, compileShader(GL_FRAGMENT_SHADER, R"(
      precision highp float;
      varying vec2 vTexCoord;
      uniform sampler2D uTexture;
      uniform vec2 uTextureSize;
      uniform int uFilter;
      uniform float uStrength;
      uniform bool uSwapRedBlue;
      void main() {
        vec4 color = texture2D(uTexture, vTexCoord);
        if (uSwapRedBlue) color = color.bgra;
        vec2 cell = fract(vTexCoord * uTextureSize);
        if (uFilter == 2 && (cell.x > 0.75 || cell.y > 0.75)) {
          color.rgb *= 1.0 - uStrength;
        } else if (uFilter == 3 && cell.y > 0.5) {
          color.rgb *= 1.0 - uStrength;
        }
        gl_FragColor = vec4(color.rgb, 1.0);
      })"));
    glBindAttribLocation(program_, 0, "aPosition");
    glBindAttribLocation(program_, 1, "aTexCoord");
    glLinkProgram(program_);
    glUseProgram(program_);
    filterUniform_ = glGetUniformLocation(program_, "uFilter");
    strengthUniform_ = glGetUniformLocation(program_, "uStrength");
    textureSizeUniform_ = glGetUniformLocation(program_, "uTextureSize");
    swapUniform_ = glGetUniformLocation(program_, "uSwapRedBlue");

    glGenTextures(1, &texture_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    textureWidth_ = 0;
    textureHeight_ = 0;
    return true;
  }

  void destroy() {
    if (display_ != EGL_NO_DISPLAY) {
      eglMakeCurrent(display_, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
      if (surface_ != EGL_NO_SURFACE) eglDestroySurface(display_, surface_);
      if (context_ != EGL_NO_CONTEXT) eglDestroyContext(display_, context_);
      eglTerminate(display_);
    }
    display_ = EGL_NO_DISPLAY;
    surface_ = EGL_NO_SURFACE;
    context_ = EGL_NO_CONTEXT;
    program_ = 0;
    texture_ = 0;
    textureWidth_ = 0;
    textureHeight_ = 0;
  }

  bool ready() const { return surface_ != EGL_NO_SURFACE; }

  void draw(const Frame &frame) {
    if (frame.empty()) return;
    EGLint viewWidth = 0;
    EGLint viewHeight = 0;
    eglQuerySurface(display_, surface_, EGL_WIDTH, &viewWidth);
    eglQuerySurface(display_, surface_, EGL_HEIGHT, &viewHeight);
    glViewport(0, 0, viewWidth, viewHeight);
    glClearColor(0, 0, 0, 1);
    glClear(GL_COLOR_BUFFER_BIT);

    const int filter = gVideoFilter.load();
    const GLint sampling = filter == kFilterSmooth ? GL_LINEAR : GL_NEAREST;
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, sampling);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, sampling);
    glUniform1i(filterUniform_, filter == kFilterLcd || filter == kFilterScanlines ? filter : 0);
    glUniform1f(strengthUniform_, gVideoStrength.load());

    // OpenGL ES 2 can't skip row padding, so the texture spans the full pitch and the padding is
    // cropped off with texture coordinates. mGBA's 240-pixel rows are 256 pixels apart, for one.
    const bool wide = frame.format == RETRO_PIXEL_FORMAT_XRGB8888;
    const int textureWidth = static_cast<int>(frame.pitch / bytesPerPixel(frame.format));
    const GLenum format = wide ? GL_RGBA : GL_RGB;
    const GLenum type = wide ? GL_UNSIGNED_BYTE : GL_UNSIGNED_SHORT_5_6_5;
    glPixelStorei(GL_UNPACK_ALIGNMENT, wide ? 4 : 2);
    if (textureWidth != textureWidth_ || frame.height != textureHeight_ || wide != textureWide_) {
      glTexImage2D(GL_TEXTURE_2D, 0, format, textureWidth, frame.height, 0, format, type,
                   frame.pixels.data());
      textureWidth_ = textureWidth;
      textureHeight_ = frame.height;
      textureWide_ = wide;
    } else {
      glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, textureWidth, frame.height, format, type,
                      frame.pixels.data());
    }
    // XRGB8888 is B, G, R, X in memory, which OpenGL ES 2 can only take as RGBA.
    glUniform1i(swapUniform_, wide ? 1 : 0);
    glUniform2f(textureSizeUniform_, static_cast<GLfloat>(textureWidth),
                static_cast<GLfloat>(frame.height));

    const GLfloat maxU = static_cast<GLfloat>(frame.width) / textureWidth;
    ScreenRect screens[2];
    bool split = false;
    if (gSystem == System::Nds) {
      std::lock_guard<std::mutex> lock(gScreenRectsMutex);
      split = gScreenRectsSet;
      screens[0] = gScreenRects[0];
      screens[1] = gScreenRects[1];
    }
    if (split) {
      // Each half of the stacked frame goes into its own rectangle.
      for (int half = 0; half < 2; ++half) {
        const ScreenRect &screen = screens[half];
        if (screen.width <= 0 || screen.height <= 0) continue;
        glViewport(static_cast<GLint>(screen.left),
                   static_cast<GLint>(viewHeight - screen.top - screen.height),
                   static_cast<GLsizei>(screen.width), static_cast<GLsizei>(screen.height));
        drawQuad(maxU, half * 0.5f, half * 0.5f + 0.5f);
      }
    } else {
      applyPictureViewport(viewWidth, viewHeight, frame.width, frame.height);
      drawQuad(maxU, 0, 1);
    }
    eglSwapBuffers(display_, surface_);
  }

 private:
  // Draws the texture's columns up to maxU and rows minV to maxV over the whole viewport.
  static void drawQuad(GLfloat maxU, GLfloat minV, GLfloat maxV) {
    const GLfloat vertices[] = {-1, 1, 0, minV, 1, 1, maxU, minV, -1, -1, 0, maxV, 1, -1, maxU, maxV};
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), vertices);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), vertices + 2);
    glEnableVertexAttribArray(1);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
  }

  // Sets where in the surface the picture goes for the chosen aspect ratio and scaling.
  static void applyPictureViewport(int surfaceWidth, int surfaceHeight, int frameWidth,
                                   int frameHeight) {
    float width = static_cast<float>(surfaceWidth);
    float height = static_cast<float>(surfaceHeight);
    if (gVideoAspect.load() != kAspectStretch) {
      // 4:3 imitates a TV for GBA games; it would only squash the DS's two stacked screens.
      const float aspect = gVideoAspect.load() == kAspect4By3 && gSystem == System::Gba
                               ? 4.0f / 3.0f
                               : static_cast<float>(frameWidth) / frameHeight;
      height = std::min(height, width / aspect);
      if (gVideoScaling.load() == kScalingInteger) {
        height = std::max(1.0f, std::floor(height / frameHeight)) * frameHeight;
      }
      width = height * aspect;
    }
    const float left = std::floor((surfaceWidth - width) / 2);
    const float top = std::floor((surfaceHeight - height) / 2);
    // OpenGL counts from the bottom; the stored rectangle counts from the top like Android does.
    glViewport(static_cast<GLint>(left), static_cast<GLint>(surfaceHeight - top - height),
               static_cast<GLsizei>(width), static_cast<GLsizei>(height));
  }

  GLint filterUniform_ = -1;
  GLint strengthUniform_ = -1;
  GLint textureSizeUniform_ = -1;
  GLint swapUniform_ = -1;
  EGLDisplay display_ = EGL_NO_DISPLAY;
  EGLSurface surface_ = EGL_NO_SURFACE;
  EGLContext context_ = EGL_NO_CONTEXT;
  GLuint program_ = 0;
  GLuint texture_ = 0;
  int textureWidth_ = 0;
  int textureHeight_ = 0;
  bool textureWide_ = false;
};

Renderer gRenderer;

// --- Emulator state -------------------------------------------------------------------------------

std::thread gEmuThread;
std::atomic<bool> gRunning{false};
std::atomic<bool> gQuit{false};
std::atomic<bool> gPaused{false};
std::atomic<bool> gBackgrounded{false};
std::atomic<bool> gFastForward{false};
std::atomic<bool> gPadFastForward{false};
std::atomic<double> gFastForwardSpeed{2.0};
std::atomic<double> gFrameSeconds{1.0 / 60};

bool isFastForwarding() {
  return gFastForward.load(std::memory_order_relaxed) ||
         gPadFastForward.load(std::memory_order_relaxed);
}
std::atomic<uint32_t> gButtons{0};
std::atomic<uint32_t> gPadButtons{0};

// The touchscreen, packed so a press and its position always change together: bit 32 is set while
// touching, and the low 32 bits hold the libretro x and y coordinates as two int16s.
std::atomic<uint64_t> gPointer{0};

std::mutex gStateMutex;
std::condition_variable gStateChanged;
ANativeWindow *gWindow = nullptr;
bool gWindowDirty = false;

std::atomic<double> gFps{0};
std::atomic<double> gFrameMs{0};
std::atomic<uint64_t> gSaveWrites{0};
std::atomic<uint64_t> gSaveBytes{0};

std::string gSavePath;
std::string gSaveDir;
std::string gSystemDir;
// Set when the ROM's header would make the real GBA BIOS hang, so the core boots the game directly.
bool gSkipBios = false;
Frame gLastFrame;

std::mutex gCommandMutex;
std::vector<std::function<void()>> gCommands;
std::vector<uint8_t> gLastSave;
std::vector<uint8_t> gSaveCandidate;

// Writes save memory to disk. Unless forced, a change must be identical across two checks so a
// save the game is still in the middle of writing never replaces the last good file.
void flushSave(bool force) {
  auto *memory = static_cast<const uint8_t *>(gCore->retro_get_memory_data(RETRO_MEMORY_SAVE_RAM));
  const size_t size = gCore->retro_get_memory_size(RETRO_MEMORY_SAVE_RAM);
  if (!memory || size == 0) return;

  if (gLastSave.size() == size && std::memcmp(gLastSave.data(), memory, size) == 0) {
    gSaveCandidate.clear();
    return;
  }
  const bool stable =
      gSaveCandidate.size() == size && std::memcmp(gSaveCandidate.data(), memory, size) == 0;
  if (!force && !stable) {
    gSaveCandidate.assign(memory, memory + size);
    return;
  }

  const std::string tempPath = gSavePath + ".tmp";
  FILE *file = std::fopen(tempPath.c_str(), "wb");
  if (!file) {
    LOGE("Could not open save file for writing");
    return;
  }
  const bool written = std::fwrite(memory, 1, size, file) == size;
  const bool closed = std::fclose(file) == 0;
  if (!written || !closed || std::rename(tempPath.c_str(), gSavePath.c_str()) != 0) {
    LOGE("Could not write save file");
    std::remove(tempPath.c_str());
    return;
  }
  gLastSave.assign(memory, memory + size);
  gSaveCandidate.clear();
  gSaveWrites.fetch_add(1);
  gSaveBytes.store(size);
}

void loadSave() {
  auto *memory = static_cast<uint8_t *>(gCore->retro_get_memory_data(RETRO_MEMORY_SAVE_RAM));
  const size_t size = gCore->retro_get_memory_size(RETRO_MEMORY_SAVE_RAM);
  gSaveCandidate.clear();
  gLastSave.clear();
  if (!memory || size == 0) return;

  if (FILE *file = std::fopen(gSavePath.c_str(), "rb")) {
    const size_t read = std::fread(memory, 1, size, file);
    std::fclose(file);
    gSaveBytes.store(read);
    LOGI("Restored %zu bytes of save data", read);
  }
  gLastSave.assign(memory, memory + size);
}

// --- libretro callbacks ---------------------------------------------------------------------------

struct CoreVariable {
  const char *key;
  const char *value;
};

// melonDS DS settings that suit a phone. Anything not listed keeps the core's own default.
constexpr CoreVariable kMelonDsVariables[] = {
    // The player lays its controls out around one picture with the screens stacked, and maps
    // touches onto the bottom half, so the layout must stay fixed.
    {"melonds_number_of_screen_layouts", "1"},
    {"melonds_screen_layout1", "top-bottom"},
    {"melonds_screen_gap", "0"},
    // Touches come from the real touchscreen, so there's no need for a cursor.
    {"melonds_touch_mode", "touch"},
    {"melonds_show_cursor", "disabled"},
    // Real BIOS and firmware are used when they're in the system folder, and melonDS's own
    // replacements otherwise.
    {"melonds_sysfile_mode", "native"},
    {"melonds_console_mode", "ds"},
};

const char *coreVariable(const char *key) {
  if (!key) return nullptr;
  if (gSystem == System::Gba) {
    if (gSkipBios && std::strcmp(key, "mgba_skip_bios") == 0) return "ON";
    return nullptr;
  }
  for (const auto &variable : kMelonDsVariables) {
    if (std::strcmp(key, variable.key) == 0) return variable.value;
  }
  return nullptr;
}

void coreLog(retro_log_level level, const char *format, ...) {
  // Debug output from melonDS is far too chatty to keep.
  if (level == RETRO_LOG_DEBUG) return;
  char message[1024];
  va_list args;
  va_start(args, format);
  std::vsnprintf(message, sizeof(message), format, args);
  va_end(args);
  const int priority = level == RETRO_LOG_ERROR  ? ANDROID_LOG_ERROR
                       : level == RETRO_LOG_WARN ? ANDROID_LOG_WARN
                                                 : ANDROID_LOG_INFO;
  __android_log_print(priority, "KrsCore", "%s", message);
}

bool environment(unsigned command, void *data) {
  switch (command) {
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
      const auto format = *static_cast<const retro_pixel_format *>(data);
      if (format != RETRO_PIXEL_FORMAT_RGB565 && format != RETRO_PIXEL_FORMAT_XRGB8888) {
        return false;
      }
      gPixelFormat = format;
      return true;
    }
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
      *static_cast<const char **>(data) = gSystemDir.c_str();
      return true;
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
      *static_cast<const char **>(data) = gSaveDir.c_str();
      return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
      auto *variable = static_cast<retro_variable *>(data);
      variable->value = coreVariable(variable->key);
      return variable->value != nullptr;
    }
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
      static_cast<retro_log_callback *>(data)->log = coreLog;
      return true;
    case RETRO_ENVIRONMENT_SET_MESSAGE:
      if (const auto *message = static_cast<const retro_message *>(data); message->msg) {
        LOGI("Core message: %s", message->msg);
      }
      return true;
    case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: {
      // The picture's size comes with each frame, so only the timing matters here.
      const auto *av = static_cast<const retro_system_av_info *>(data);
      if (av->timing.fps > 0) gFrameSeconds.store(1.0 / av->timing.fps);
      return true;
    }
    case RETRO_ENVIRONMENT_SET_GEOMETRY:
      return true;
    default:
      return false;
  }
}

void videoRefresh(const void *data, unsigned width, unsigned height, size_t pitch) {
  if (!data || width == 0 || height == 0 || pitch < width * bytesPerPixel(gPixelFormat)) return;
  const auto *pixels = static_cast<const uint8_t *>(data);
  gLastFrame.pixels.assign(pixels, pixels + pitch * height);
  gLastFrame.width = static_cast<int>(width);
  gLastFrame.height = static_cast<int>(height);
  gLastFrame.pitch = pitch;
  gLastFrame.format = gPixelFormat;
  if (gRenderer.ready()) gRenderer.draw(gLastFrame);
}

size_t audioBatch(const int16_t *samples, size_t frames) {
  // Audio can't keep up at double speed, so fast-forward runs silent instead of crackling.
  if (isFastForwarding()) return frames;
  const size_t written = gRing.write(samples, frames);
  if (written < frames) gOverruns.fetch_add(1);
  if (gRing.fill() >= kAudioTargetFill) gAudioPrimed.store(true);
  return frames;
}

void audioSample(int16_t left, int16_t right) {
  const int16_t samples[2] = {left, right};
  audioBatch(samples, 1);
}

void inputPoll() {}

int16_t inputState(unsigned port, unsigned device, unsigned index, unsigned id) {
  if (port != 0) return 0;
  if (device == RETRO_DEVICE_JOYPAD) {
    if (id >= 16) return 0;
    const uint32_t held = gButtons.load(std::memory_order_relaxed) |
                          gPadButtons.load(std::memory_order_relaxed);
    return static_cast<int16_t>((held >> id) & 1);
  }
  if (device == RETRO_DEVICE_POINTER && index == 0) {
    const uint64_t pointer = gPointer.load(std::memory_order_relaxed);
    const bool pressed = (pointer >> 32) & 1;
    switch (id) {
      case RETRO_DEVICE_ID_POINTER_X:
        return static_cast<int16_t>(pointer & 0xFFFF);
      case RETRO_DEVICE_ID_POINTER_Y:
        return static_cast<int16_t>((pointer >> 16) & 0xFFFF);
      case RETRO_DEVICE_ID_POINTER_PRESSED:
        return pressed ? 1 : 0;
      case RETRO_DEVICE_ID_POINTER_IS_OFFSCREEN:
        return pressed ? 0 : 1;
      default:
        return 0;
    }
  }
  return 0;
}

// --- Emulator thread ------------------------------------------------------------------------------

// GL state belongs to the emulator thread, so surface changes are applied here.
void applySurfaceChange() {
  std::lock_guard<std::mutex> lock(gStateMutex);
  if (!gWindowDirty) return;
  gRenderer.destroy();
  if (gWindow && !gRenderer.init(gWindow)) LOGE("Could not initialise the renderer");
  // A new surface starts black, which would blank the picture behind the pause menu.
  if (gRenderer.ready()) gRenderer.draw(gLastFrame);
  gWindowDirty = false;
  gStateChanged.notify_all();
}

bool isHalted() { return gPaused.load() || gBackgrounded.load(); }

void drainCommands() {
  std::vector<std::function<void()>> commands;
  {
    std::lock_guard<std::mutex> lock(gCommandMutex);
    commands.swap(gCommands);
  }
  for (const auto &command : commands) command();
}

// libretro calls must all come from the emulator thread, so other threads queue work for it.
bool runOnEmulatorThread(std::function<bool()> work) {
  if (!gRunning.load()) return false;
  auto promise = std::make_shared<std::promise<bool>>();
  std::future<bool> result = promise->get_future();
  {
    std::lock_guard<std::mutex> lock(gCommandMutex);
    gCommands.emplace_back([work = std::move(work), promise] { promise->set_value(work()); });
  }
  gStateChanged.notify_all();
  if (result.wait_for(std::chrono::seconds(5)) != std::future_status::ready) return false;
  return result.get();
}

bool writeStateFile(const std::string &path) {
  const size_t size = gCore->retro_serialize_size();
  if (size == 0) return false;
  std::vector<uint8_t> state(size);
  if (!gCore->retro_serialize(state.data(), size)) return false;

  const std::string tempPath = path + ".tmp";
  FILE *file = std::fopen(tempPath.c_str(), "wb");
  if (!file) return false;
  const bool written = std::fwrite(state.data(), 1, size, file) == size;
  const bool closed = std::fclose(file) == 0;
  if (written && closed && std::rename(tempPath.c_str(), path.c_str()) == 0) return true;
  std::remove(tempPath.c_str());
  return false;
}

bool readStateFile(const std::string &path) {
  FILE *file = std::fopen(path.c_str(), "rb");
  if (!file) return false;
  std::fseek(file, 0, SEEK_END);
  const long size = std::ftell(file);
  std::rewind(file);
  std::vector<uint8_t> state(size > 0 ? static_cast<size_t>(size) : 0);
  const bool read = !state.empty() && std::fread(state.data(), 1, state.size(), file) == state.size();
  std::fclose(file);
  return read && gCore->retro_unserialize(state.data(), state.size());
}

void waitWhilePaused() {
  flushSave(true);
  gAudio.stop();
  while (isHalted() && !gQuit.load()) {
    applySurfaceChange();
    drainCommands();
    std::unique_lock<std::mutex> lock(gStateMutex);
    gStateChanged.wait_for(lock, std::chrono::milliseconds(50));
  }
  gRing.clear();
  gAudioPrimed.store(false);
  gAudio.start();
}

void emulatorMain(std::vector<uint8_t> rom, std::promise<std::string> result) {
  gPixelFormat = RETRO_PIXEL_FORMAT_RGB565;
  gCore->retro_set_environment(environment);
  gCore->retro_set_video_refresh(videoRefresh);
  gCore->retro_set_audio_sample(audioSample);
  gCore->retro_set_audio_sample_batch(audioBatch);
  gCore->retro_set_input_poll(inputPoll);
  gCore->retro_set_input_state(inputState);
  gCore->retro_init();
  gLastFrame = Frame();

  retro_game_info game{};
  game.data = rom.data();
  game.size = rom.size();
  if (!gCore->retro_load_game(&game)) {
    gCore->retro_deinit();
    gRunning.store(false);
    result.set_value("The emulator could not load this ROM.");
    return;
  }
  // The core keeps its own copy, and DS ROMs can be hundreds of megabytes.
  std::vector<uint8_t>().swap(rom);
  loadSave();

  retro_system_av_info av{};
  gCore->retro_get_system_av_info(&av);
  gFrameSeconds.store(1.0 / av.timing.fps);
  LOGI("Core ready: %.4f fps, %.0f Hz", av.timing.fps, av.timing.sample_rate);

  gRing.clear();
  gAudioPrimed.store(false);
  const bool audioOpen = gAudio.open(static_cast<int>(av.timing.sample_rate));
  if (audioOpen) gAudio.start();
  result.set_value("");

  auto nextFrame = Clock::now();
  auto windowStart = nextFrame;
  int windowFrames = 0;
  double windowCost = 0;
  int framesSinceSaveCheck = 0;

  while (!gQuit.load()) {
    applySurfaceChange();
    drainCommands();

    if (isHalted()) {
      waitWhilePaused();
      nextFrame = Clock::now();
      windowStart = nextFrame;
      windowFrames = 0;
      windowCost = 0;
      continue;
    }

    const auto frameStart = Clock::now();
    gCore->retro_run();
    const auto frameEnd = Clock::now();
    windowCost += std::chrono::duration<double, std::milli>(frameEnd - frameStart).count();
    windowFrames++;

    if (++framesSinceSaveCheck >= kSaveCheckFrames) {
      framesSinceSaveCheck = 0;
      flushSave(false);
    }

    if (frameEnd - windowStart >= std::chrono::seconds(1)) {
      const double seconds = std::chrono::duration<double>(frameEnd - windowStart).count();
      gFps.store(windowFrames / seconds);
      gFrameMs.store(windowCost / windowFrames);
      windowStart = frameEnd;
      windowFrames = 0;
      windowCost = 0;
    }

    // Nudge the frame rate by up to 1% to keep the audio buffer near its target without crackle.
    const double frameSeconds = gFrameSeconds.load();
    const double fillRatio = static_cast<double>(gRing.fill()) / AudioRing::kCapacity;
    const double correction = 1.0 + 0.01 * (fillRatio - 0.25);
    const double frameTime = isFastForwarding() ? frameSeconds / gFastForwardSpeed.load()
                                               : frameSeconds * correction;
    nextFrame +=
        std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(frameTime));

    const auto now = Clock::now();
    if (now > nextFrame + std::chrono::milliseconds(100)) {
      nextFrame = now;
    } else {
      std::this_thread::sleep_until(nextFrame);
    }
  }

  drainCommands();
  flushSave(true);
  gAudio.close();
  {
    std::lock_guard<std::mutex> lock(gStateMutex);
    gRenderer.destroy();
    gWindowDirty = true;
    gStateChanged.notify_all();
  }
  gCore->retro_unload_game();
  gCore->retro_deinit();
  gRunning.store(false);
}

void stopEmulator() {
  gQuit.store(true);
  gStateChanged.notify_all();
  if (gEmuThread.joinable()) gEmuThread.join();
  gQuit.store(false);
}

// --- ROM checks -----------------------------------------------------------------------------------

size_t maxRomSize(System system) {
  return system == System::Nds ? kMaxNdsRomSize : kMaxGbaRomSize;
}

const char *systemName(System system) { return system == System::Nds ? "DS" : "GBA"; }

// Reads the whole ROM from a file descriptor. It's read here rather than handed over from Kotlin
// so a large DS ROM never has to fit in the Java heap. Returns an error message, or "" on success.
std::string readRom(int fd, System system, std::vector<uint8_t> &rom) {
  const size_t limit = maxRomSize(system);
  struct stat info {};
  if (fstat(fd, &info) == 0 && info.st_size > 0) {
    if (static_cast<uint64_t>(info.st_size) > limit) {
      return std::string("This file is not a valid ") + systemName(system) + " ROM (too large).";
    }
    rom.reserve(static_cast<size_t>(info.st_size));
  }

  // Some document providers hand out pipes, so read until the end instead of trusting the size.
  constexpr size_t kChunk = 1024 * 1024;
  while (true) {
    const size_t used = rom.size();
    if (used >= limit + 1) {
      return std::string("This file is not a valid ") + systemName(system) + " ROM (too large).";
    }
    const size_t want = std::min(kChunk, limit + 1 - used);
    rom.resize(used + want);
    const ssize_t got = read(fd, rom.data() + used, want);
    if (got < 0 && errno == EINTR) {
      rom.resize(used);
      continue;
    }
    if (got < 0) return "Could not read this file.";
    rom.resize(used + static_cast<size_t>(got));
    if (got == 0) break;
  }
  if (rom.size() > limit) {
    return std::string("This file is not a valid ") + systemName(system) + " ROM (too large).";
  }
  return "";
}

// Only rejects files that can't be a ROM at all. The core itself decides whether it can run the
// rest: GBA ROM hacks and translations often ship with a stale header checksum or a cleared fixed
// byte, and mGBA plays those fine (only the real BIOS refuses them, see gbaHeaderIsValid).
std::string validateRom(const std::vector<uint8_t> &rom, System system) {
  if (system == System::Nds) {
    if (rom.size() < kNdsHeaderSize) return "This file is not a valid DS ROM (too small).";
    return "";
  }
  if (rom.size() < 0xC0) return "This file is not a valid GBA ROM (too small).";
  return "";
}

// Whether the real GBA BIOS would accept this header. It locks up on a bad one.
bool gbaHeaderIsValid(const std::vector<uint8_t> &rom) {
  if (rom[0xB2] != 0x96) return false;
  int checksum = 0;
  for (size_t i = 0xA0; i <= 0xBC; i++) checksum -= rom[i];
  checksum = (checksum - 0x19) & 0xFF;
  return checksum == rom[0xBD];
}

std::string toString(JNIEnv *env, jstring value) {
  const char *chars = env->GetStringUTFChars(value, nullptr);
  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

bool systemInfo(jint system, retro_system_info &info) {
  const CoreLibrary *core = loadCore(system == 1 ? System::Nds : System::Gba);
  if (!core) return false;
  core->retro_get_system_info(&info);
  return true;
}

// Converts the core's pixels to tightly packed RGBA8888, the layout of an ARGB_8888 Bitmap.
std::vector<uint8_t> toRgba(const Frame &frame) {
  std::vector<uint8_t> rgba(static_cast<size_t>(frame.width) * frame.height * 4);
  uint8_t *out = rgba.data();
  for (int row = 0; row < frame.height; row++) {
    const uint8_t *line = frame.pixels.data() + row * frame.pitch;
    for (int column = 0; column < frame.width; column++) {
      if (frame.format == RETRO_PIXEL_FORMAT_XRGB8888) {
        uint32_t pixel;
        std::memcpy(&pixel, line + column * 4, 4);
        *out++ = (pixel >> 16) & 0xFF;
        *out++ = (pixel >> 8) & 0xFF;
        *out++ = pixel & 0xFF;
      } else {
        uint16_t pixel;
        std::memcpy(&pixel, line + column * 2, 2);
        const uint8_t red = (pixel >> 11) & 0x1F;
        const uint8_t green = (pixel >> 5) & 0x3F;
        const uint8_t blue = pixel & 0x1F;
        *out++ = static_cast<uint8_t>((red << 3) | (red >> 2));
        *out++ = static_cast<uint8_t>((green << 2) | (green >> 4));
        *out++ = static_cast<uint8_t>((blue << 3) | (blue >> 2));
      }
      *out++ = 0xFF;
    }
  }
  return rgba;
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_coreName(JNIEnv *env, jobject, jint system) {
  retro_system_info info{};
  return systemInfo(system, info) ? env->NewStringUTF(info.library_name) : nullptr;
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_coreVersion(JNIEnv *env, jobject, jint system) {
  retro_system_info info{};
  return systemInfo(system, info) ? env->NewStringUTF(info.library_version) : nullptr;
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_validExtensions(JNIEnv *env, jobject,
                                                                jint system) {
  retro_system_info info{};
  return systemInfo(system, info) ? env->NewStringUTF(info.valid_extensions) : nullptr;
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_libretroApiVersion(JNIEnv *, jobject,
                                                                   jint system) {
  const CoreLibrary *core = loadCore(system == 1 ? System::Nds : System::Gba);
  return core ? static_cast<jint>(core->retro_api_version()) : 0;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_isAAudioRecommended(JNIEnv *, jobject) {
  return oboe::AudioStreamBuilder::isAAudioRecommended() ? JNI_TRUE : JNI_FALSE;
}

// Reads the ROM from romFd (which stays the caller's to close) and starts it on the system's core.
// Returns null on success, or a message describing why the game could not start.
extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_start(JNIEnv *env, jobject, jint romFd,
                                                      jint systemId, jstring savePath,
                                                      jstring saveDir, jstring systemDir) {
  const System system = systemId == 1 ? System::Nds : System::Gba;
  const CoreLibrary *core = loadCore(system);
  if (!core) {
    return env->NewStringUTF(system == System::Nds
                                 ? "DS games need a 64-bit device."
                                 : "The emulator is missing from this build of the app.");
  }

  std::vector<uint8_t> rom;
  std::string invalid = readRom(romFd, system, rom);
  if (invalid.empty()) invalid = validateRom(rom, system);
  if (!invalid.empty()) return env->NewStringUTF(invalid.c_str());

  stopEmulator();
  gCore = core;
  gSystem = system;
  gSkipBios = system == System::Gba && !gbaHeaderIsValid(rom);
  if (gSkipBios) LOGI("ROM header fails the BIOS check; booting without the BIOS intro");
  gSavePath = toString(env, savePath);
  gSaveDir = toString(env, saveDir);
  gSystemDir = toString(env, systemDir);
  gPaused.store(false);
  gBackgrounded.store(false);
  gFastForward.store(false);
  gPadFastForward.store(false);
  gButtons.store(0);
  gPadButtons.store(0);
  gPointer.store(0);
  gUnderruns.store(0);
  gOverruns.store(0);
  gSaveWrites.store(0);
  gSaveBytes.store(0);
  gFps.store(0);
  gFrameMs.store(0);
  {
    std::lock_guard<std::mutex> lock(gStateMutex);
    gWindowDirty = true;
  }

  std::promise<std::string> promise;
  std::future<std::string> future = promise.get_future();
  gRunning.store(true);
  gEmuThread = std::thread(emulatorMain, std::move(rom), std::move(promise));

  const std::string error = future.get();
  if (error.empty()) return nullptr;
  gEmuThread.join();
  return env->NewStringUTF(error.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_stop(JNIEnv *, jobject) {
  stopEmulator();
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setPaused(JNIEnv *, jobject, jboolean paused) {
  gPaused.store(paused == JNI_TRUE);
  gStateChanged.notify_all();
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setButtons(JNIEnv *, jobject, jint buttons) {
  gButtons.store(static_cast<uint32_t>(buttons), std::memory_order_relaxed);
}

// A touch on the DS touchscreen, as fractions of its width and height from its top left. Touches
// outside it count as lifting the stylus.
extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setPointer(JNIEnv *, jobject, jboolean pressed,
                                                           jfloat x, jfloat y) {
  const float u = x;
  // The core stacks the screens with the touchscreen in the bottom half and reads the pointer
  // across the whole frame.
  const float v = 0.5f + y * 0.5f;
  const uint64_t previous = gPointer.load(std::memory_order_relaxed);
  if (pressed != JNI_TRUE || u < 0 || u > 1 || y < 0 || y > 1) {
    // Keep the last position: some games read it again on the frame the stylus lifts.
    gPointer.store(previous & 0xFFFFFFFFull, std::memory_order_relaxed);
    return;
  }
  // libretro spans the picture from -0x7FFF to 0x7FFF on both axes.
  const auto toAxis = [](float position) {
    return static_cast<uint16_t>(static_cast<int16_t>(std::lround((position * 2 - 1) * 0x7FFF)));
  };
  const uint64_t packed =
      (1ull << 32) | (static_cast<uint64_t>(toAxis(v)) << 16) | static_cast<uint64_t>(toAxis(u));
  gPointer.store(packed, std::memory_order_relaxed);
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setPadFastForward(JNIEnv *, jobject,
                                                                  jboolean enabled) {
  gPadFastForward.store(enabled == JNI_TRUE);
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setPadButtons(JNIEnv *, jobject, jint buttons) {
  gPadButtons.store(static_cast<uint32_t>(buttons), std::memory_order_relaxed);
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setVideoSettings(JNIEnv *, jobject, jint filter,
                                                                 jfloat strength, jint aspect,
                                                                 jint scaling) {
  gVideoFilter.store(filter);
  gVideoStrength.store(strength);
  gVideoAspect.store(aspect);
  gVideoScaling.store(scaling);
  // The game may be paused, so the picture has to be redrawn for the change to show.
  runOnEmulatorThread([] {
    if (gRenderer.ready()) gRenderer.draw(gLastFrame);
    return true;
  });
}

// Where the DS's top and bottom screens go in the surface: left, top, width and height in pixels
// for each, top screen first. A zero width hides that screen. Null goes back to one picture.
extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setScreenRects(JNIEnv *env, jobject,
                                                               jfloatArray rects) {
  {
    std::lock_guard<std::mutex> lock(gScreenRectsMutex);
    gScreenRectsSet = rects != nullptr && env->GetArrayLength(rects) >= 8;
    if (gScreenRectsSet) {
      float values[8];
      env->GetFloatArrayRegion(rects, 0, 8, values);
      for (int screen = 0; screen < 2; ++screen) {
        gScreenRects[screen] = {values[screen * 4], values[screen * 4 + 1],
                                values[screen * 4 + 2], values[screen * 4 + 3]};
      }
    }
  }
  if (!gRunning.load()) return;
  // Called during layout on the UI thread, so the redraw is queued rather than waited for. A
  // paused game wouldn't otherwise show the new arrangement.
  {
    std::lock_guard<std::mutex> lock(gCommandMutex);
    gCommands.emplace_back([] {
      if (gRenderer.ready()) gRenderer.draw(gLastFrame);
    });
  }
  gStateChanged.notify_all();
}

// The current picture as tightly packed RGBA8888, or null if nothing has been drawn yet. Its
// width and height are written to size[0] and size[1].
extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_getLastFrame(JNIEnv *env, jobject,
                                                             jintArray size) {
  auto frame = std::make_shared<std::vector<uint8_t>>();
  auto dimensions = std::make_shared<std::pair<int, int>>();
  const bool copied = runOnEmulatorThread([frame, dimensions] {
    if (gLastFrame.empty()) return false;
    *frame = toRgba(gLastFrame);
    *dimensions = {gLastFrame.width, gLastFrame.height};
    return true;
  });
  if (!copied || env->GetArrayLength(size) < 2) return nullptr;
  const jint sizeValues[] = {dimensions->first, dimensions->second};
  env->SetIntArrayRegion(size, 0, 2, sizeValues);
  jbyteArray result = env->NewByteArray(static_cast<jsize>(frame->size()));
  env->SetByteArrayRegion(result, 0, static_cast<jsize>(frame->size()),
                          reinterpret_cast<const jbyte *>(frame->data()));
  return result;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setCheats(JNIEnv *env, jobject,
                                                          jobjectArray lines) {
  if (lines == nullptr) return JNI_FALSE;
  std::vector<std::string> codes;
  const jsize count = env->GetArrayLength(lines);
  codes.reserve(static_cast<size_t>(count));
  for (jsize i = 0; i < count; i++) {
    auto line = static_cast<jstring>(env->GetObjectArrayElement(lines, i));
    if (line == nullptr) continue;
    const char *chars = env->GetStringUTFChars(line, nullptr);
    if (chars != nullptr) {
      // One entry per cheat: up to 256 lines of at most 17 characters, joined with '+'.
      std::string code(chars);
      if (!code.empty() && code.size() <= 256 * 18) codes.push_back(std::move(code));
      env->ReleaseStringUTFChars(line, chars);
    }
    env->DeleteLocalRef(line);
    if (env->ExceptionCheck()) {
      env->ExceptionClear();
      return JNI_FALSE;
    }
  }
  const bool applied = runOnEmulatorThread([codes = std::move(codes)] {
    gCore->retro_cheat_reset();
    for (size_t i = 0; i < codes.size(); i++) {
      gCore->retro_cheat_set(static_cast<unsigned>(i), true, codes[i].c_str());
    }
    return true;
  });
  return applied ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setBackgrounded(JNIEnv *, jobject,
                                                                jboolean backgrounded) {
  gBackgrounded.store(backgrounded == JNI_TRUE);
  gStateChanged.notify_all();
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setFastForwardSpeed(JNIEnv *, jobject,
                                                                    jdouble speed) {
  gFastForwardSpeed.store(speed);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_saveState(JNIEnv *env, jobject, jstring path) {
  const std::string file = toString(env, path);
  return runOnEmulatorThread([file] { return writeStateFile(file); }) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_loadState(JNIEnv *env, jobject, jstring path) {
  const std::string file = toString(env, path);
  return runOnEmulatorThread([file] { return readStateFile(file); }) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_reset(JNIEnv *, jobject) {
  const bool done = runOnEmulatorThread([] {
    gCore->retro_reset();
    return true;
  });
  return done ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setFastForward(JNIEnv *, jobject,
                                                               jboolean enabled) {
  gFastForward.store(enabled == JNI_TRUE);
}

// Blocks until the emulator thread has let go of the old surface, as Android requires.
extern "C" JNIEXPORT void JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_setSurface(JNIEnv *env, jobject, jobject surface) {
  std::unique_lock<std::mutex> lock(gStateMutex);
  if (gWindow) ANativeWindow_release(gWindow);
  gWindow = surface ? ANativeWindow_fromSurface(env, surface) : nullptr;
  gWindowDirty = true;
  gStateChanged.notify_all();
  if (gRunning.load()) {
    gStateChanged.wait_for(lock, std::chrono::seconds(1),
                           [] { return !gWindowDirty || !gRunning.load(); });
  }
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_getStats(JNIEnv *env, jobject) {
  const jdouble values[] = {gFps.load(),
                            gFrameMs.load(),
                            static_cast<jdouble>(gUnderruns.load()),
                            static_cast<jdouble>(gOverruns.load()),
                            static_cast<jdouble>(gSaveWrites.load()),
                            static_cast<jdouble>(gSaveBytes.load())};
  jdoubleArray result = env->NewDoubleArray(6);
  env->SetDoubleArrayRegion(result, 0, 6, values);
  return result;
}
