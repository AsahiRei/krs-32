import { NavigationBar } from 'expo-navigation-bar';
import { Redirect, type Href, router, useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  BackHandler,
  Easing,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InGameMenu } from '@/components/InGameMenu';
import { SetupButton } from '@/components/SetupCard';
import { activeCheatLines, loadCheats } from '@/lib/cheats';
import {
  getPlayRequest,
  loadGameMeta,
  type PlayRequest,
  recordAutoSave,
  recordPlay,
} from '@/lib/library';
import {
  AUTO_STATE,
  DEFAULT_QUICK_SLOT,
  rememberRomSaveId,
  slotStateName,
  takeLoadedLabel,
  UNDO_STATE,
} from '@/lib/saveStates';
import { loadControlLayout } from '@/lib/controlLayout';
import { loadControllerMapping } from '@/lib/controllerMapping';
import { type GameOrientation, loadSettings, saveSettings } from '@/lib/setup';
import { applyVideoSettings } from '@/lib/video';
import KrsEmulator, { KrsEmulatorView } from '@/modules/krs-emulator';

const TOAST_MS = 2500;
const TOAST_ENTER_MS = 180;
const TOAST_RISE_PX = 10;
const UNDO_TOAST_MS = 6000;

type Toast = { message: string; onUndo?: () => void };

/** A lock applies whatever the phone's auto-rotate switch says; only 'auto' follows it. */
function applyGameOrientation(orientation: GameOrientation) {
  const applied =
    orientation === 'auto'
      ? ScreenOrientation.unlockAsync()
      : ScreenOrientation.lockAsync(
          orientation === 'landscape'
            ? ScreenOrientation.OrientationLock.LANDSCAPE
            : ScreenOrientation.OrientationLock.PORTRAIT_UP
        );
  applied.catch(() => {});
}

function ToastView({ toast }: { toast: Toast }) {
  const [entrance] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: TOAST_ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      className="flex-row items-center gap-4 rounded-[14px] border border-control-border bg-control px-4"
      style={{
        opacity: entrance,
        transform: [
          {
            translateY: entrance.interpolate({
              inputRange: [0, 1],
              outputRange: [TOAST_RISE_PX, 0],
            }),
          },
        ],
      }}>
      <Text className="py-3 font-inter-semibold text-[14px] text-foreground">{toast.message}</Text>
      {toast.onUndo && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={toast.onUndo}
          className="min-h-[44px] justify-center active:opacity-60">
          <Text className="font-inter-semibold text-[14px] text-accent">Undo</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

export default function PlayerRoute() {
  const [request] = useState(getPlayRequest);
  // Only a reload while playing lands here without a game.
  return request ? <Player request={request} /> : <Redirect href="/library" />;
}

function Player({ request: { game, startState } }: { request: PlayRequest }) {
  const { id, uri, title } = game;
  const { width, height } = useWindowDimensions();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickSlot, setQuickSlot] = useState(DEFAULT_QUICK_SLOT);
  const [quickSlotSavedAt, setQuickSlotSavedAt] = useState<number | null>(null);
  const [cheatsOn, setCheatsOn] = useState(0);
  const [playedSeconds, setPlayedSeconds] = useState(game.playSeconds ?? 0);
  const [speed, setSpeed] = useState(() => loadSettings().fastForwardSpeed);
  const [orientation, setOrientation] = useState(() => loadSettings().gameOrientation);
  const [toast, setToast] = useState<Toast | null>(null);
  const [controlLayout, setControlLayout] = useState(loadControlLayout);
  const [stretchVideo, setStretchVideo] = useState(
    () => loadSettings().video.aspect === 'stretch'
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clockStartedAt = useRef<number | null>(null);
  const menuIsOpen = useRef(false);
  const inSubScreen = useRef(false);
  const editingControls = useRef(false);
  const saveId = useRef<string | null>(null);

  const showToast = useCallback((next: Toast, duration = TOAST_MS) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  const startClock = useCallback(() => {
    clockStartedAt.current = Date.now();
  }, []);

  const stopClock = useCallback(async () => {
    const since = clockStartedAt.current;
    if (since === null) return;
    clockStartedAt.current = null;
    const seconds = Math.round((Date.now() - since) / 1000);
    setPlayedSeconds((current) => current + seconds);
    // Play history isn't worth interrupting a game over, so a failed write is simply dropped.
    await recordPlay(id, seconds).catch(() => {});
  }, [id]);

  const refreshMenuData = useCallback(() => {
    const slot = loadGameMeta()[id]?.quickSlot ?? DEFAULT_QUICK_SLOT;
    setQuickSlot(slot);
    setQuickSlotSavedAt(KrsEmulator.getStateTime(slotStateName(slot)));
    setCheatsOn(
      saveId.current ? loadCheats(saveId.current).filter((cheat) => cheat.enabled).length : 0
    );
  }, [id]);

  const openMenu = useCallback(() => {
    if (menuIsOpen.current) return;
    menuIsOpen.current = true;
    KrsEmulator.setPaused(true);
    stopClock();
    refreshMenuData();
    setMenuOpen(true);
  }, [refreshMenuData, stopClock]);

  const closeMenu = useCallback(() => {
    menuIsOpen.current = false;
    setMenuOpen(false);
    KrsEmulator.setPaused(false);
    startClock();
  }, [startClock]);

  useFocusEffect(
    useCallback(() => {
      applyGameOrientation(loadSettings().gameOrientation);
      return () => {
        // The control editor sets its own orientation, and this would run after it.
        if (editingControls.current) return;
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      };
    }, [])
  );

  const showUndoToast = useCallback(
    (label: string) => {
      showToast(
        {
          message: `Loaded ${label}`,
          onUndo: () => {
            setToast(null);
            KrsEmulator.loadState(UNDO_STATE).catch(() =>
              showToast({ message: "Couldn't undo that load." })
            );
          },
        },
        UNDO_TOAST_MS
      );
    },
    [showToast]
  );

  // Coming back from Save states or Cheats: the game is still paused behind them.
  useFocusEffect(
    useCallback(() => {
      if (!inSubScreen.current) return;
      inSubScreen.current = false;
      editingControls.current = false;
      setControlLayout(loadControlLayout());
      setStretchVideo(loadSettings().video.aspect === 'stretch');
      const loadedLabel = takeLoadedLabel();
      if (loadedLabel !== null) {
        closeMenu();
        showUndoToast(loadedLabel);
      } else {
        refreshMenuData();
        setMenuOpen(true);
      }
    }, [closeMenu, refreshMenuData, showUndoToast])
  );

  useFocusEffect(
    useCallback(() => {
      if (!started) return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        openMenu();
        return true;
      });
      return () => subscription.remove();
    }, [started, openMenu])
  );

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const loaded = await KrsEmulator.loadGame(uri);
        saveId.current = loaded.saveId;
        rememberRomSaveId(uri, loaded.saveId);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not start this game.');
        return;
      }
      if (!active) {
        // Left while the ROM was still loading: nothing else will stop it now.
        KrsEmulator.stop();
        return;
      }
      KrsEmulator.setControllerMapping(JSON.stringify(loadControllerMapping()));
      await applyVideoSettings(loadSettings().video).catch(() => {});
      if (saveId.current) {
        await KrsEmulator.setCheats(activeCheatLines(loadCheats(saveId.current))).catch(() =>
          showToast({ message: "Couldn't apply your cheats." })
        );
      }
      if (startState) {
        await KrsEmulator.loadState(startState).catch(() =>
          showToast({ message: "Couldn't restore that save." })
        );
      }
      if (active) setStarted(true);
    }

    boot();
    return () => {
      active = false;
      KrsEmulator.stop();
    };
  }, [uri, startState, showToast]);

  useEffect(() => {
    if (!started) return;

    recordPlay(id, 0).catch(() => {});
    startClock();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stopClock();
      else if (!menuIsOpen.current) startClock();
    });
    return () => {
      subscription.remove();
      stopClock();
    };
  }, [started, id, startClock, stopClock]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  // Shortcuts from a Bluetooth controller.
  useEffect(() => {
    if (!started) return;
    const subscription = KrsEmulator.addListener('onControllerAction', ({ action }) => {
      if (menuIsOpen.current) return;
      if (action === 'MENU') {
        openMenu();
        return;
      }
      if (action === 'SCREENSHOT') {
        KrsEmulator.saveScreenshot()
          .then(() => showToast({ message: 'Screenshot saved to Pictures/KRS32' }))
          .catch(() => showToast({ message: "Couldn't save the screenshot." }));
        return;
      }
      const slot = loadGameMeta()[id]?.quickSlot ?? DEFAULT_QUICK_SLOT;
      const state = slotStateName(slot);
      if (action === 'QUICK_SAVE') {
        KrsEmulator.saveState(state)
          .then(() => showToast({ message: `Saved to slot ${slot}` }))
          .catch(() => showToast({ message: "Couldn't write the save state." }));
      } else if (action === 'QUICK_LOAD' && KrsEmulator.getStateTime(state)) {
        KrsEmulator.saveState(UNDO_STATE)
          .then(() => KrsEmulator.loadState(state))
          .then(() => showUndoToast(`slot ${slot}`))
          .catch(() => showToast({ message: "Couldn't load the save state." }));
      }
    });
    return () => subscription.remove();
  }, [started, id, openMenu, showToast, showUndoToast]);

  function selectSpeed(next: number) {
    setSpeed(next);
    saveSettings({ fastForwardSpeed: next }).catch(() => {});
  }

  function selectOrientation(next: GameOrientation) {
    setOrientation(next);
    applyGameOrientation(next);
    saveSettings({ gameOrientation: next }).catch(() => {});
  }

  function openSubScreen(href: Href) {
    inSubScreen.current = true;
    setMenuOpen(false);
    router.push(href);
  }

  function openControlEditor() {
    editingControls.current = true;
    openSubScreen({
      pathname: '/control-editor',
      params: { orientation: width > height ? 'landscape' : 'portrait' },
    });
  }

  async function quickSave() {
    await KrsEmulator.saveState(slotStateName(quickSlot));
    showToast({ message: `Saved to slot ${quickSlot}` });
  }

  async function quickLoad() {
    await KrsEmulator.saveState(UNDO_STATE);
    await KrsEmulator.loadState(slotStateName(quickSlot));
    showUndoToast(`slot ${quickSlot}`);
  }

  async function saveAndQuit() {
    await KrsEmulator.saveState(AUTO_STATE);
    await stopClock();
    await recordAutoSave(id);
    menuIsOpen.current = false;
    setMenuOpen(false);
    router.back();
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-5 bg-background px-8">
        <StatusBar style="light" />
        <View className="gap-2">
          <Text className="text-center font-inter-semibold text-[18px] text-foreground">
            Couldn&apos;t start this game
          </Text>
          <Text className="text-center font-inter text-[14px] leading-[20px] text-secondary">
            {error}
          </Text>
        </View>
        <View className="self-stretch">
          <SetupButton label="Back to library" variant="secondary" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView className={`flex-1 ${width > height ? 'bg-black' : 'bg-background'}`}>
      <StatusBar hidden />
      <NavigationBar hidden />
      <KrsEmulatorView
        title={title}
        controlLayout={JSON.stringify(controlLayout)}
        stretchVideo={stretchVideo}
        fastForwardSpeed={speed}
        onMenuPress={openMenu}
        style={{ flex: 1 }}
      />

      {toast && (
        <View className="absolute inset-x-0 bottom-3 items-center" pointerEvents="box-none">
          <ToastView key={toast.message} toast={toast} />
        </View>
      )}

      {menuOpen && (
        <InGameMenu
          playedSeconds={playedSeconds}
          quickSlot={quickSlot}
          quickSlotSavedAt={quickSlotSavedAt}
          cheatsOn={cheatsOn}
          onOpenSaveStates={() => openSubScreen('/save-states?inGame=1')}
          onOpenCheats={() => openSubScreen('/cheats?inGame=1')}
          onOpenScreenFilter={() => openSubScreen('/screen-filter?inGame=1')}
          onOpenControls={openControlEditor}
          fastForwardSpeed={speed}
          onSelectSpeed={selectSpeed}
          orientation={orientation}
          onSelectOrientation={selectOrientation}
          onQuickSave={quickSave}
          onQuickLoad={quickLoad}
          onReset={() => KrsEmulator.reset()}
          onSaveAndQuit={saveAndQuit}
          onClose={closeMenu}
        />
      )}
    </SafeAreaView>
  );
}
