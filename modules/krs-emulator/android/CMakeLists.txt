cmake_minimum_required(VERSION 3.22.1)
project(krsemulator C CXX)

include(FetchContent)

# mGBA build options: the GBA libretro core only, with no frontends or optional dependencies.
set(BUILD_LIBRETRO ON CACHE BOOL "" FORCE)
set(SKIP_LIBRARY ON CACHE BOOL "" FORCE)
set(DISABLE_FRONTENDS ON CACHE BOOL "" FORCE)
set(DISABLE_DEPS ON CACHE BOOL "" FORCE)
set(BUILD_QT OFF CACHE BOOL "" FORCE)
set(BUILD_SDL OFF CACHE BOOL "" FORCE)
set(BUILD_GL OFF CACHE BOOL "" FORCE)
set(BUILD_GLES2 OFF CACHE BOOL "" FORCE)
set(BUILD_GLES3 OFF CACHE BOOL "" FORCE)
set(ENABLE_SCRIPTING OFF CACHE BOOL "" FORCE)
set(M_CORE_GB OFF CACHE BOOL "" FORCE)
set(M_CORE_GBA ON CACHE BOOL "" FORCE)

FetchContent_Declare(
  mgba
  URL https://github.com/mgba-emu/mgba/archive/refs/tags/0.10.5.tar.gz
  URL_HASH SHA256=91d6fbd32abcbdf030d58d3f562de25ebbc9d56040d513ff8e5c19bee9dacf14
)
FetchContent_MakeAvailable(mgba)

# Android only installs native libraries named lib*.so; mGBA strips the prefix by default.
set_target_properties(mgba_libretro PROPERTIES PREFIX "lib")
target_link_options(mgba_libretro PRIVATE "-Wl,-z,max-page-size=16384")

find_package(oboe REQUIRED CONFIG)

add_library(krsemulator SHARED src/main/cpp/krsemulator.cpp)
target_include_directories(krsemulator PRIVATE "${mgba_SOURCE_DIR}/src/platform/libretro")
target_link_libraries(krsemulator PRIVATE mgba_libretro oboe::oboe android EGL GLESv2 log)
target_link_options(krsemulator PRIVATE "-Wl,-z,max-page-size=16384")
