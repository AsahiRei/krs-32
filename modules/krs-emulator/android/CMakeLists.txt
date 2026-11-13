cmake_minimum_required(VERSION 3.22.1)
project(krsemulator C CXX)

include(ExternalProject)
include(FetchContent)

# Both cores export the same retro_* functions, so neither is linked into the frontend: it opens
# the one a game needs with dlopen (see CoreLibrary in krsemulator.cpp). They still have to be
# built and packaged in the APK, which is what the rest of this file arranges.

# --- mGBA (Game Boy Advance) ----------------------------------------------------------------------

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
  # Fixes libretro cheat handling; see the script for details.
  PATCH_COMMAND ${CMAKE_COMMAND} -DMGBA_SOURCE_DIR=<SOURCE_DIR>
    -P ${CMAKE_CURRENT_LIST_DIR}/patches/mgba-cheats.cmake
)
FetchContent_MakeAvailable(mgba)

# Android only installs native libraries named lib*.so; mGBA strips the prefix by default.
set_target_properties(mgba_libretro PROPERTIES PREFIX "lib")
target_link_options(mgba_libretro PRIVATE "-Wl,-z,max-page-size=16384")

# --- melonDS DS (Nintendo DS) ---------------------------------------------------------------------

# DS emulation is too heavy for 32-bit devices, and melonDS's JIT only exists for these two, so the
# DS core is left out of the other ABIs. The frontend reports that DS games aren't supported there.
if(ANDROID_ABI STREQUAL "arm64-v8a" OR ANDROID_ABI STREQUAL "x86_64")
  set(MELONDS_CORE_FILE "${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/libmelondsds_libretro.so")

  # melonDS DS uses CMAKE_SOURCE_DIR throughout, so it only builds as a top-level project. It's
  # always built optimized: a debug build of an emulator this heavy is unplayably slow.
  ExternalProject_Add(
    melondsds
    URL https://github.com/JesseTG/melonds-ds/archive/refs/tags/v1.4.0.tar.gz
    URL_HASH SHA256=034b3aa856b2a194de1653a55eca74b530b7bd5e2e39dcd23f0d35c8c0410406
    # Short folder names keep the deepest object paths under Windows' 260-character limit.
    PREFIX "${CMAKE_BINARY_DIR}/mds"
    CMAKE_GENERATOR Ninja
    CMAKE_ARGS
      -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
      -DCMAKE_MAKE_PROGRAM=${CMAKE_MAKE_PROGRAM}
      -DANDROID_ABI=${ANDROID_ABI}
      -DANDROID_PLATFORM=${ANDROID_PLATFORM}
      -DANDROID_STL=c++_shared
      -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON
      -DCMAKE_BUILD_TYPE=Release
      "-DCMAKE_MODULE_LINKER_FLAGS=-Wl,-z,max-page-size=16384"
      -DENABLE_JIT=ON
      -DENABLE_OPENGL=OFF
      # melonDS DS 1.4.0 doesn't compile with this off, though nothing here uses Wi-Fi.
      -DENABLE_NETWORKING=ON
      -DBUILD_TESTING=OFF
      # Upstream tracks a branch of its melonDS fork; pin the commit so builds are repeatable.
      -DMELONDS_REPOSITORY_TAG=16f127dbb587a73371827ce79689c5d237c4b59b
    BUILD_COMMAND ${CMAKE_COMMAND} --build <BINARY_DIR> --target melondsds_libretro
    # Android only installs libraries named lib*.so, and melonDS DS names its core without the prefix
    # (with an _android suffix, following RetroArch's convention).
    INSTALL_COMMAND ${CMAKE_COMMAND} -E copy
      <BINARY_DIR>/src/libretro/melondsds_libretro_android.so "${MELONDS_CORE_FILE}"
    BUILD_BYPRODUCTS "${MELONDS_CORE_FILE}"
  )

  # Gradle packages prebuilt libraries that a target links to, so this stub links the DS core
  # purely to get it into the APK. Nothing ever loads the stub.
  add_library(melondsds_core SHARED IMPORTED)
  set_target_properties(melondsds_core PROPERTIES
    IMPORTED_LOCATION "${MELONDS_CORE_FILE}"
    IMPORTED_NO_SONAME TRUE)
  add_dependencies(melondsds_core melondsds)

  add_library(krscorepackage SHARED src/main/cpp/corepackage.c)
  target_link_libraries(krscorepackage PRIVATE melondsds_core)
  target_link_options(krscorepackage PRIVATE "-Wl,-z,max-page-size=16384")
  add_dependencies(krscorepackage melondsds)
endif()

# --- Frontend -------------------------------------------------------------------------------------

find_package(oboe REQUIRED CONFIG)

add_library(krsemulator SHARED src/main/cpp/krsemulator.cpp)
target_include_directories(krsemulator PRIVATE "${mgba_SOURCE_DIR}/src/platform/libretro")
target_link_libraries(krsemulator PRIVATE oboe::oboe android EGL GLESv2 log dl)
target_link_options(krsemulator PRIVATE "-Wl,-z,max-page-size=16384")
# The cores are opened at run time, but they still have to be built alongside the frontend.
add_dependencies(krsemulator mgba_libretro)
if(TARGET krscorepackage)
  add_dependencies(krsemulator krscorepackage)
endif()
