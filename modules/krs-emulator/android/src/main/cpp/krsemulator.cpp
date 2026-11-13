#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <jni.h>
#include <oboe/Oboe.h>

#include <algorithm>
#include <cmath>
#include <atomic>
#include <chrono>
#include <condition_variable>
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

namespace {

using Clock = std::chrono::steady_clock;

// The GBA addresses at most 32 MB of ROM; mGBA ignores anything past that, so slightly
// oversized (padded) dumps still load. Beyond this it's surely not a GBA ROM.
constexpr size_t kMaxRomFileSize = 64 * 1024 * 1024;
constexpr int kTextureSize = 256;
constexpr int kGameWidth = 240;
constexpr int kGameHeight = 160;
constexpr int kSaveCheckFrames = 120;

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
      uniform int uFilter;
      uniform float uStrength;
      void main() {
        vec4 color = texture2D(uTexture, vTexCoord);
        vec2 cell = fract(vTexCoord * 256.0);
        if (uFilter == 2 && (cell.x > 0.75 || cell.y > 0.75)) {
          color.rgb *= 1.0 - uStrength;
        } else if (uFilter == 3 && cell.y > 0.5) {
          color.rgb *= 1.0 - uStrength;
        }
        gl_FragColor = color;
      })"));
    glBindAttribLocation(program_, 0, "aPosition");
    glBindAttribLocation(program_, 1, "aTexCoord");
    glLinkProgram(program_);
    glUseProgram(program_);
    filterUniform_ = glGetUniformLocation(program_, "uFilter");
    strengthUniform_ = glGetUniformLocation(program_, "uStrength");

    glGenTextures(1, &texture_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 2);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, kTextureSize, kTextureSize, 0, GL_RGB,
                 GL_UNSIGNED_SHORT_5_6_5, nullptr);
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
  }

  bool ready() const { return surface_ != EGL_NO_SURFACE; }

  void draw(const void *data, int width, int height) {
    EGLint viewWidth = 0;
    EGLint viewHeight = 0;
    eglQuerySurface(display_, surface_, EGL_WIDTH, &viewWidth);
    eglQuerySurface(display_, surface_, EGL_HEIGHT, &viewHeight);
    glViewport(0, 0, viewWidth, viewHeight);
    glClearColor(0, 0, 0, 1);
    glClear(GL_COLOR_BUFFER_BIT);
    applyPictureViewport(viewWidth, viewHeight);

    const int filter = gVideoFilter.load();
    const GLint sampling = filter == kFilterSmooth ? GL_LINEAR : GL_NEAREST;
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, sampling);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, sampling);
    glUniform1i(filterUniform_, filter == kFilterLcd || filter == kFilterScanlines ? filter : 0);
    glUniform1f(strengthUniform_, gVideoStrength.load());

    // mGBA's frame buffer is always 256 pixels wide, wider than the visible 240.
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, kTextureSize, height, GL_RGB, GL_UNSIGNED_SHORT_5_6_5,
                    data);

    const GLfloat maxU = static_cast<GLfloat>(width) / kTextureSize;
    const GLfloat maxV = static_cast<GLfloat>(height) / kTextureSize;
    const GLfloat vertices[] = {-1, 1, 0, 0, 1, 1, maxU, 0, -1, -1, 0, maxV, 1, -1, maxU, maxV};
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), vertices);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(GLfloat), vertices + 2);
    glEnableVertexAttribArray(1);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    eglSwapBuffers(display_, surface_);
  }

 private:
  // Sets where in the surface the picture goes for the chosen aspect ratio and scaling.
  static void applyPictureViewport(int surfaceWidth, int surfaceHeight) {
    const int aspectMode = gVideoAspect.load();
    if (aspectMode == kAspectStretch) {
      glViewport(0, 0, surfaceWidth, surfaceHeight);
      return;
    }

    const float aspect =
        aspectMode == kAspect4By3 ? 4.0f / 3.0f : static_cast<float>(kGameWidth) / kGameHeight;
    float height = std::min(static_cast<float>(surfaceHeight), surfaceWidth / aspect);
    if (gVideoScaling.load() == kScalingInteger) {
      height = std::max(1.0f, std::floor(height / kGameHeight)) * kGameHeight;
    }
    const float width = height * aspect;
    glViewport(static_cast<GLint>((surfaceWidth - width) / 2),
               static_cast<GLint>((surfaceHeight - height) / 2), static_cast<GLsizei>(width),
               static_cast<GLsizei>(height));
  }

  GLint filterUniform_ = -1;
  GLint strengthUniform_ = -1;
  EGLDisplay display_ = EGL_NO_DISPLAY;
  EGLSurface surface_ = EGL_NO_SURFACE;
  EGLContext context_ = EGL_NO_CONTEXT;
  GLuint program_ = 0;
  GLuint texture_ = 0;
};

Renderer gRenderer;

std::thread gEmuThread;
std::atomic<bool> gRunning{false};
std::atomic<bool> gQuit{false};
std::atomic<bool> gPaused{false};
std::atomic<bool> gBackgrounded{false};
std::atomic<bool> gFastForward{false};
std::atomic<bool> gPadFastForward{false};
std::atomic<double> gFastForwardSpeed{2.0};

bool isFastForwarding() {
  return gFastForward.load(std::memory_order_relaxed) ||
         gPadFastForward.load(std::memory_order_relaxed);
}
std::atomic<uint32_t> gButtons{0};
std::atomic<uint32_t> gPadButtons{0};

std::mutex gStateMutex;
std::condition_variable gStateChanged;
ANativeWindow *gWindow = nullptr;
bool gWindowDirty = false;

std::atomic<double> gFps{0};
std::atomic<double> gFrameMs{0};
std::atomic<uint64_t> gSaveWrites{0};
std::atomic<uint64_t> gSaveBytes{0};

std::string gSavePath;
std::string gSystemDir;
// Set when the ROM's header would make the real BIOS hang, so the core boots the game directly.
bool gSkipBios = false;
std::vector<uint8_t> gLastFrame;
int gLastFrameWidth = 0;
int gLastFrameHeight = 0;

std::mutex gCommandMutex;
std::vector<std::function<void()>> gCommands;
std::vector<uint8_t> gLastSave;
std::vector<uint8_t> gSaveCandidate;

// Writes save memory to disk. Unless forced, a change must be identical across two checks so a
// save the game is still in the middle of writing never replaces the last good file.
void flushSave(bool force) {
  auto *memory = static_cast<const uint8_t *>(retro_get_memory_data(RETRO_MEMORY_SAVE_RAM));
  const size_t size = retro_get_memory_size(RETRO_MEMORY_SAVE_RAM);
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
  auto *memory = static_cast<uint8_t *>(retro_get_memory_data(RETRO_MEMORY_SAVE_RAM));
  const size_t size = retro_get_memory_size(RETRO_MEMORY_SAVE_RAM);
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

bool environment(unsigned command, void *data) {
  if (command == RETRO_ENVIRONMENT_SET_PIXEL_FORMAT) {
    return *static_cast<const retro_pixel_format *>(data) == RETRO_PIXEL_FORMAT_RGB565;
  }
  if (command == RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY) {
    *static_cast<const char **>(data) = gSystemDir.c_str();
    return true;
  }
  if (command == RETRO_ENVIRONMENT_GET_VARIABLE) {
    auto *variable = static_cast<retro_variable *>(data);
    if (gSkipBios && variable->key && std::strcmp(variable->key, "mgba_skip_bios") == 0) {
      variable->value = "ON";
      return true;
    }
    variable->value = nullptr;
    return false;
  }
  return false;
}

void videoRefresh(const void *data, unsigned width, unsigned height, size_t pitch) {
  if (!data || pitch != kTextureSize * sizeof(uint16_t)) return;
  const auto *pixels = static_cast<const uint8_t *>(data);
  gLastFrame.assign(pixels, pixels + pitch * height);
  gLastFrameWidth = static_cast<int>(width);
  gLastFrameHeight = static_cast<int>(height);
  if (gRenderer.ready()) gRenderer.draw(data, gLastFrameWidth, gLastFrameHeight);
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

int16_t inputState(unsigned port, unsigned device, unsigned, unsigned id) {
  if (port != 0 || device != RETRO_DEVICE_JOYPAD || id >= 16) return 0;
  const uint32_t held = gButtons.load(std::memory_order_relaxed) |
                        gPadButtons.load(std::memory_order_relaxed);
  return static_cast<int16_t>((held >> id) & 1);
}

// GL state belongs to the emulator thread, so surface changes are applied here.
void applySurfaceChange() {
  std::lock_guard<std::mutex> lock(gStateMutex);
  if (!gWindowDirty) return;
  gRenderer.destroy();
  if (gWindow && !gRenderer.init(gWindow)) LOGE("Could not initialise the renderer");
  // A new surface starts black, which would blank the picture behind the pause menu.
  if (gRenderer.ready() && !gLastFrame.empty()) {
    gRenderer.draw(gLastFrame.data(), gLastFrameWidth, gLastFrameHeight);
  }
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
  const size_t size = retro_serialize_size();
  if (size == 0) return false;
  std::vector<uint8_t> state(size);
  if (!retro_serialize(state.data(), size)) return false;

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
  return read && retro_unserialize(state.data(), state.size());
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
  retro_set_environment(environment);
  retro_set_video_refresh(videoRefresh);
  retro_set_audio_sample(audioSample);
  retro_set_audio_sample_batch(audioBatch);
  retro_set_input_poll(inputPoll);
  retro_set_input_state(inputState);
  retro_init();
  gLastFrame.clear();

  retro_game_info game{};
  game.data = rom.data();
  game.size = rom.size();
  if (!retro_load_game(&game)) {
    retro_deinit();
    gRunning.store(false);
    result.set_value("The emulator could not load this ROM.");
    return;
  }
  std::vector<uint8_t>().swap(rom);
  loadSave();

  retro_system_av_info av{};
  retro_get_system_av_info(&av);
  const double frameSeconds = 1.0 / av.timing.fps;
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
    retro_run();
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
  retro_unload_game();
  retro_deinit();
  gRunning.store(false);
}

void stopEmulator() {
  gQuit.store(true);
  gStateChanged.notify_all();
  if (gEmuThread.joinable()) gEmuThread.join();
  gQuit.store(false);
}

// Only rejects files that can't be a GBA ROM at all. mGBA itself decides whether it can run the
// rest: ROM hacks and translations often ship with a stale header checksum or a cleared fixed
// byte, and mGBA plays those fine (only the real BIOS refuses them, see headerIsValid).
std::string validateRom(const std::vector<uint8_t> &rom) {
  if (rom.size() < 0xC0) return "This file is not a valid GBA ROM (too small).";
  if (rom.size() > kMaxRomFileSize) return "This file is not a valid GBA ROM (too large).";
  return "";
}

// Whether the real GBA BIOS would accept this header. It locks up on a bad one.
bool headerIsValid(const std::vector<uint8_t> &rom) {
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

retro_system_info systemInfo() {
  retro_system_info info{};
  retro_get_system_info(&info);
  return info;
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_coreName(JNIEnv *env, jobject) {
  return env->NewStringUTF(systemInfo().library_name);
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_coreVersion(JNIEnv *env, jobject) {
  return env->NewStringUTF(systemInfo().library_version);
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_validExtensions(JNIEnv *env, jobject) {
  return env->NewStringUTF(systemInfo().valid_extensions);
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_libretroApiVersion(JNIEnv *, jobject) {
  return static_cast<jint>(retro_api_version());
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_isAAudioRecommended(JNIEnv *, jobject) {
  return oboe::AudioStreamBuilder::isAAudioRecommended() ? JNI_TRUE : JNI_FALSE;
}

// Returns null on success, or a message describing why the game could not start.
extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_start(JNIEnv *env, jobject, jbyteArray romBytes,
                                                      jstring savePath, jstring systemDir) {
  std::vector<uint8_t> rom(static_cast<size_t>(env->GetArrayLength(romBytes)));
  env->GetByteArrayRegion(romBytes, 0, static_cast<jsize>(rom.size()),
                          reinterpret_cast<jbyte *>(rom.data()));

  const std::string invalid = validateRom(rom);
  if (!invalid.empty()) return env->NewStringUTF(invalid.c_str());

  stopEmulator();
  gSkipBios = !headerIsValid(rom);
  if (gSkipBios) LOGI("ROM header fails the BIOS check; booting without the BIOS intro");
  gSavePath = toString(env, savePath);
  gSystemDir = toString(env, systemDir);
  gPaused.store(false);
  gBackgrounded.store(false);
  gFastForward.store(false);
  gPadFastForward.store(false);
  gButtons.store(0);
  gPadButtons.store(0);
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
    if (gRenderer.ready() && !gLastFrame.empty()) {
      gRenderer.draw(gLastFrame.data(), gLastFrameWidth, gLastFrameHeight);
    }
    return true;
  });
}

// The current picture as 240x160 RGB565, or null if nothing has been drawn yet.
extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_krsemulator_KrsEmulatorNative_getLastFrame(JNIEnv *env, jobject) {
  auto frame = std::make_shared<std::vector<uint8_t>>();
  const bool copied = runOnEmulatorThread([frame] {
    if (gLastFrameWidth != kGameWidth || gLastFrameHeight != kGameHeight) return false;
    const size_t sourcePitch = kTextureSize * sizeof(uint16_t);
    const size_t rowBytes = kGameWidth * sizeof(uint16_t);
    frame->resize(rowBytes * kGameHeight);
    for (size_t row = 0; row < kGameHeight; row++) {
      std::memcpy(frame->data() + row * rowBytes, gLastFrame.data() + row * sourcePitch, rowBytes);
    }
    return true;
  });
  if (!copied) return nullptr;
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
    retro_cheat_reset();
    for (size_t i = 0; i < codes.size(); i++) {
      retro_cheat_set(static_cast<unsigned>(i), true, codes[i].c_str());
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
    retro_reset();
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
