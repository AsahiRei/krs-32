# Replaces mGBA's libretro cheat entry points (src/platform/libretro/libretro.c, mGBA 0.10.5).
#
# Upstream problems this fixes:
# - retro_cheat_reset frees the cheat sets without restoring ROM bytes the cheats patched, so a
#   bad or removed code keeps corrupting the game (white screen, crashes) until it's restarted.
# - retro_cheat_set puts every code into one shared set, so one cheat's decryption state
#   (detected GameShark/Action Replay version, seed changes, unfinished multi-line codes, master
#   codes) garbles the codes of every cheat after it.
#
# Run as: cmake -DMGBA_SOURCE_DIR=<dir> -P mgba-cheats.cmake. Safe to run more than once.

set(target "${MGBA_SOURCE_DIR}/src/platform/libretro/libretro.c")
file(READ "${target}" source)

set(marker "/* KRS32 cheat handling */")
string(FIND "${source}" "${marker}" alreadyPatched)
if(NOT alreadyPatched EQUAL -1)
  return()
endif()

set(resetSignature "void retro_cheat_reset(void) {")
set(setSignature "void retro_cheat_set(unsigned index, bool enabled, const char* code) {")
foreach(signature IN ITEMS "${resetSignature}" "${setSignature}")
  string(FIND "${source}" "${signature}" found)
  if(found EQUAL -1)
    message(FATAL_ERROR "mgba-cheats.cmake: '${signature}' not found; update the patch for this mGBA version.")
  endif()
endforeach()

# Keep the upstream bodies but take them out of use; the replacements are appended below.
string(REPLACE "${resetSignature}"
  "static __attribute__((unused)) void _upstreamCheatReset(void) {" source "${source}")
string(REPLACE "${setSignature}"
  "static __attribute__((unused)) void _upstreamCheatSet(unsigned index, bool enabled, const char* code) {"
  source "${source}")

string(APPEND source [==[

/* KRS32 cheat handling */
#ifdef M_CORE_GBA
#include <mgba/internal/gba/cheats.h>
#endif

void retro_cheat_reset(void) {
	if (!core) {
		return;
	}
	struct mCheatDevice* device = core->cheatDevice(core);
	size_t i;
	for (i = mCheatSetsSize(&device->cheats); i--;) {
		struct mCheatSet* set = *mCheatSetsGetPointer(&device->cheats, i);
		// Refreshing a disabled set puts back every ROM byte it patched.
		set->enabled = false;
		mCheatRefresh(device, set);
		mCheatRemoveSet(device, set);
		mCheatSetDeinit(set);
	}
}

// One set per call, so each cheat keeps its own code type and decryption state.
void retro_cheat_set(unsigned index, bool enabled, const char* code) {
	UNUSED(index);
	if (!core || !code) {
		return;
	}
	struct mCheatDevice* device = core->cheatDevice(core);
	struct mCheatSet* cheatSet = device->createSet(device, NULL);
	bool added = false;
#ifdef M_CORE_GBA
	if (core->platform(core) == mPLATFORM_GBA) {
		// Codes are "XXXXXXXX YYYYYYYY" or "XXXXXXXX YYYY", separated by '+' or whitespace.
		char realCode[] = "XXXXXXXX XXXXXXXX";
		size_t len = strlen(code) + 1;
		size_t i, pos;
		for (i = 0, pos = 0; i < len; ++i) {
			if (isspace((int) code[i]) || code[i] == '+') {
				realCode[pos] = ' ';
			} else {
				realCode[pos] = code[i];
			}
			if ((pos == 13 && (realCode[pos] == ' ' || !realCode[pos])) || pos == 17) {
				realCode[pos] = '\0';
				if (mCheatAddLine(cheatSet, realCode, 0)) {
					added = true;
				}
				pos = 0;
				continue;
			}
			++pos;
		}
		// A master code only names where real hardware hooks in. Through libretro its breakpoint
		// is never installed, which would leave the whole cheat inert, so the cheat runs every
		// frame instead, as most emulators do.
		struct GBACheatSet* gbaSet = (struct GBACheatSet*) cheatSet;
		if (gbaSet->hook) {
			--gbaSet->hook->refs;
			if (gbaSet->hook->refs == 0) {
				free(gbaSet->hook);
			}
			gbaSet->hook = NULL;
		}
	}
#endif
	if (!added) {
		mCheatSetDeinit(cheatSet);
		return;
	}
	cheatSet->enabled = enabled;
	mCheatAddSet(device, cheatSet);
}
]==])

file(WRITE "${target}" "${source}")
