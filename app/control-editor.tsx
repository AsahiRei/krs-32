import { NavigationBar } from 'expo-navigation-bar';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import Plus from 'lucide-react-native/icons/plus';
import Trash2 from 'lucide-react-native/icons/trash-2';
import Undo2 from 'lucide-react-native/icons/undo-2';
import X from 'lucide-react-native/icons/x';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  PixelRatio,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, Pattern, Rect } from 'react-native-svg';

import { AddControlDialog } from '@/components/AddControlDialog';
import { SetupButton } from '@/components/SetupCard';
import { Slider } from '@/components/Slider';
import { Toggle } from '@/components/Toggle';
import { useLatest } from '@/components/useLatest';
import { palette } from '@/constants/palette';
import {
  type ControlLayout,
  controlHeight,
  controlName,
  createExtraControls,
  emptyLayout,
  type ExtraBinding,
  extraControls,
  fitControl,
  GRID_DP,
  isTurbo,
  loadControlLayout,
  MAX_EXTRA_CONTROLS,
  type Orientation,
  type OrientationLayout,
  type PlacedControl,
  placedControl,
  saveControlLayout,
  sizeLimits,
  withoutExtra,
} from '@/lib/controlLayout';
import type { GameSystem } from '@/lib/systems';
import { getPlayRequest } from '@/lib/library';
import { getRomSaveId, PREVIEW_THUMBNAIL, readPreviewUri } from '@/lib/saveStates';
import KrsEmulator, { type ControlDefault, type OrientationDefaults } from '@/modules/krs-emulator';

const HEADER_HEIGHT = 72;
const TABS_HEIGHT = 60;
const PANEL_HEIGHT = 178;
const PREVIEW_SHARE = 0.36;
const LANDSCAPE_PANEL_WIDTH = 428;
const LANDSCAPE_PANEL_TOP = 68;
// New buttons appear on whichever side of the floating panel has room, so it can't hide them.
const LANDSCAPE_SPAWN_Y_BELOW_PANEL = 336;
const LANDSCAPE_SPAWN_Y_ABOVE_PANEL = 80;
// The game picture each system produces; the DS's is its two screens stacked.
const PICTURE_SIZE: Record<GameSystem, { width: number; height: number }> = {
  gba: { width: 240, height: 160 },
  nds: { width: 256, height: 384 },
};
const MIN_OPACITY = 0.2;
const OPACITY_STEP = 0.05;
const DOT_SPACING = 24;
const HATCH_SPACING = 8;
const HANDLE_SIZE = 16;
const HANDLE_TOUCH = 40;
const LABEL_INSET = 12;

/** Converts between the player's design units and pixels inside the editing canvas. */
type Canvas = {
  scale: number;
  /** Portrait compresses the spacing vertically so every control fits above the panel. */
  ySquash: number;
  originX: number;
  originY: number;
  defaults: OrientationDefaults;
};

const toCanvasX = (canvas: Canvas, x: number) => canvas.originX + x * canvas.scale;
const toCanvasY = (canvas: Canvas, y: number) =>
  canvas.originY + (y - canvas.defaults.top) * canvas.scale * canvas.ySquash;

function DotGrid() {
  return (
    <Svg pointerEvents="none" style={{ position: 'absolute', width: '100%', height: '100%' }}>
      <Defs>
        <Pattern id="dots" width={DOT_SPACING} height={DOT_SPACING} patternUnits="userSpaceOnUse">
          <Circle cx={DOT_SPACING / 2} cy={DOT_SPACING / 2} r={1} fill={palette.control.border} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#dots)" />
    </Svg>
  );
}

function Hatching({ id }: { id: string }) {
  return (
    <Svg pointerEvents="none" style={{ position: 'absolute', width: '100%', height: '100%' }}>
      <Defs>
        <Pattern
          id={id}
          width={HATCH_SPACING}
          height={HATCH_SPACING}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)">
          <Line x1={0} y1={0} x2={0} y2={HATCH_SPACING} stroke={palette.danger} strokeWidth={2} opacity={0.35} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

function ResizeHandle({
  horizontal,
  vertical,
  onGrant,
  onMove,
  onRelease,
}: {
  horizontal: 'left' | 'right';
  vertical: 'top' | 'bottom';
  onGrant: () => void;
  onMove: (dx: number, dy: number) => void;
  onRelease: () => void;
}) {
  const latest = useLatest({ onGrant, onMove, onRelease });
  const [panHandlers] = useState(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => latest.get().onGrant(),
        onPanResponderMove: (_, { dx, dy }) => latest.get().onMove(dx, dy),
        onPanResponderRelease: () => latest.get().onRelease(),
        onPanResponderTerminate: () => latest.get().onRelease(),
      }).panHandlers
  );
  const offset = -HANDLE_TOUCH / 2;

  return (
    <View
      {...panHandlers}
      className="absolute items-center justify-center"
      style={{
        width: HANDLE_TOUCH,
        height: HANDLE_TOUCH,
        [horizontal]: offset,
        [vertical]: offset,
      }}>
      <View
        pointerEvents="none"
        className="rounded-[3px] border-2 border-accent bg-foreground"
        style={{ width: HANDLE_SIZE, height: HANDLE_SIZE }}
      />
    </View>
  );
}

class DragOrigin {
  constructor(public value: PlacedControl) {}
}

function EditableControl({
  control,
  placed,
  canvas,
  opacity,
  selected,
  onSelect,
  onBegin,
  onChange,
  onEnd,
}: {
  control: ControlDefault;
  placed: PlacedControl;
  canvas: Canvas;
  opacity: number;
  selected: boolean;
  onSelect: () => void;
  onBegin: () => void;
  onChange: (next: PlacedControl) => void;
  onEnd: () => void;
}) {
  const latest = useLatest({ placed, canvas, onSelect, onBegin, onChange, onEnd });
  // Where the control was when the current drag began.
  const [dragOrigin] = useState(() => new DragOrigin(placed));

  const [panHandlers] = useState(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragOrigin.value = latest.get().placed;
          latest.get().onSelect();
          latest.get().onBegin();
        },
        onPanResponderMove: (_, { dx, dy }) => {
          const { canvas: current, onChange: change } = latest.get();
          change({
            ...dragOrigin.value,
            x: dragOrigin.value.x + dx / current.scale,
            y: dragOrigin.value.y + dy / (current.scale * current.ySquash),
          });
        },
        onPanResponderRelease: () => latest.get().onEnd(),
        onPanResponderTerminate: () => latest.get().onEnd(),
      }).panHandlers
  );

  const width = placed.size * canvas.scale;
  const height = controlHeight(control, placed.size) * canvas.scale;
  const centerX = toCanvasX(canvas, placed.x);
  const centerY = toCanvasY(canvas, placed.y);

  const resize = (signX: number, signY: number) => ({
    onGrant: () => {
      dragOrigin.value = latest.get().placed;
      latest.get().onBegin();
    },
    onMove: (dx: number, dy: number) => {
      // Pulling a corner outward grows the control around its center on both sides.
      const growth = Math.max(signX * dx, signY * dy) * 2;
      onChange({ ...dragOrigin.value, size: dragOrigin.value.size + growth / canvas.scale });
    },
    onRelease: onEnd,
  });

  const radius =
    control.kind === 'round' || control.kind === 'pill'
      ? height / 2
      : control.kind === 'rect'
        ? 14 * canvas.scale
        : 0;
  const armWidth = width / 3;
  const turbo = isTurbo(control);
  const surface = selected
    ? 'border-accent bg-accent/15'
    : `border-dashed bg-control ${turbo ? 'border-danger' : 'border-secondary'}`;

  return (
    <View
      {...panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${controlName(control)}, ${Math.round(placed.size)} dp`}
      accessibilityState={{ selected }}
      style={{ position: 'absolute', left: centerX - width / 2, top: centerY - height / 2, width, height }}>
      <View className="flex-1 items-center justify-center" style={{ opacity }}>
        {control.kind === 'cross' ? (
          <>
            <View
              className="absolute bg-control-pressed"
              style={{ left: (width - armWidth) / 2, top: 0, width: armWidth, height }}
            />
            <View
              className="absolute bg-control-pressed"
              style={{ left: 0, top: (height - armWidth) / 2, width, height: armWidth }}
            />
          </>
        ) : (
          <View
            className={`absolute inset-0 border ${surface}`}
            style={{ borderRadius: radius }}
          />
        )}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          className={`font-inter-bold ${turbo ? 'text-danger' : 'text-foreground'} ${
            control.kind === 'cross' ? 'text-[13px]' : 'text-[16px]'
          }`}
          style={{ maxWidth: width - LABEL_INSET }}>
          {control.label}
        </Text>
      </View>

      {selected && control.kind === 'cross' && (
        <View
          pointerEvents="none"
          className="absolute inset-0 rounded-xl border border-accent bg-accent/15"
        />
      )}
      {selected && (
        <>
          <ResizeHandle horizontal="left" vertical="top" {...resize(-1, -1)} />
          <ResizeHandle horizontal="right" vertical="top" {...resize(1, -1)} />
          <ResizeHandle horizontal="left" vertical="bottom" {...resize(-1, 1)} />
          <ResizeHandle horizontal="right" vertical="bottom" {...resize(1, 1)} />
          <View
            pointerEvents="none"
            className="absolute items-center self-center rounded-md bg-accent px-2 py-0.5"
            style={{ top: height + 12 }}>
            <Text className="font-mono text-[12px] text-accent-on">
              {Math.round(placed.size)} dp · drag
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

class PanelOrigin {
  constructor(
    public left: number,
    public top: number
  ) {}
}

/** Drags from any part of the panel that isn't a control; those take their own touches first. */
function FloatingPanel({
  left,
  top,
  width,
  onDrag,
  onHeight,
  children,
}: {
  left: number;
  top: number;
  width: number;
  onDrag: (left: number, top: number) => void;
  onHeight: (height: number) => void;
  children: ReactNode;
}) {
  const latest = useLatest({ left, top, onDrag });
  const [origin] = useState(() => new PanelOrigin(left, top));
  const [panHandlers] = useState(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          origin.left = latest.get().left;
          origin.top = latest.get().top;
        },
        onPanResponderMove: (_, { dx, dy }) =>
          latest.get().onDrag(origin.left + dx, origin.top + dy),
      }).panHandlers
  );

  return (
    <View
      {...panHandlers}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
      className="absolute gap-1 rounded-[18px] border border-control-border bg-card px-3 pb-3 pt-2"
      style={{ left, top, width }}>
      <View className="h-1 w-10 self-center rounded-full bg-control-border" />
      {children}
    </View>
  );
}

function OrientationTab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`h-11 flex-1 items-center justify-center rounded-[11px] ${
        selected ? 'bg-foreground' : ''
      }`}>
      <Text
        className={`font-inter-semibold text-[15px] ${
          selected ? 'text-background' : 'text-secondary'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

function IconAction({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-12 w-12 items-center justify-center rounded-[14px] active:bg-control-pressed ${
        disabled ? 'opacity-40' : ''
      }`}>
      {children}
    </Pressable>
  );
}

function DeleteControlButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <IconAction label={`Delete ${label}`} onPress={onPress}>
      <Trash2 size={20} color={palette.danger} />
    </IconAction>
  );
}

function DoneButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="h-12 justify-center rounded-[14px] bg-accent px-4 active:bg-accent-pressed">
      <Text className="font-inter-semibold text-[15px] text-accent-on">Done</Text>
    </Pressable>
  );
}

function ResetButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="h-12 justify-center rounded-[14px] border border-danger px-4 active:opacity-70">
      <Text className="font-inter-semibold text-[15px] text-danger">Reset…</Text>
    </Pressable>
  );
}

export default function ControlEditorScreen() {
  const params = useLocalSearchParams<{ orientation?: string; system?: string }>();
  // Opened from Settings there's no game, so it edits the GBA layout.
  const system: GameSystem = params.system === 'nds' ? 'nds' : 'gba';
  const picture = PICTURE_SIZE[system];
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [orientation, setOrientation] = useState<Orientation>(
    params.orientation === 'landscape' ? 'landscape' : 'portrait'
  );
  const [defaults] = useState(() => KrsEmulator.getControlDefaults(system));
  const [layout, setLayout] = useState<ControlLayout>(() => loadControlLayout(system));
  const [history, setHistory] = useState<ControlLayout[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [adding, setAdding] = useState(false);
  const [panelSpot, setPanelSpot] = useState<{ left: number; top: number } | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [failed, setFailed] = useState(false);
  const beforeGesture = useRef<ControlLayout | null>(null);

  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.lockAsync(
        orientation === 'landscape'
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT_UP
      ).catch(() => {});
      return () => {
        // Opened from Settings, which is portrait-only. The Player manages rotation itself.
        if (!params.orientation) {
          ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
            () => {}
          );
        }
      };
    }, [orientation, params.orientation])
  );

  useEffect(() => {
    const game = getPlayRequest()?.game;
    if (!game) return;
    let active = true;
    (async () => {
      const saveId = await getRomSaveId(game.uri);
      await KrsEmulator.captureThumbnail(PREVIEW_THUMBNAIL);
      if (active) setPreviewUri(readPreviewUri(saveId));
    })().catch(() => {
      // The dimmed picture is only a backdrop; the editor works without it.
    });
    return () => {
      active = false;
    };
  }, []);

  const current: OrientationLayout = layout[orientation];
  const orientationDefaults = defaults[orientation];
  const extras = extraControls(current);
  const allControls = [...orientationDefaults.controls, ...extras];
  const selected = allControls.find((control) => control.id === selectedId);
  const selectedExtra = extras.find((control) => control.id === selectedId);
  const isLandscape = orientation === 'landscape';

  const availableWidth = width - insets.left - insets.right;
  const availableHeight = height - insets.top - insets.bottom;
  const scale = Math.min(
    availableWidth / orientationDefaults.width,
    availableHeight / orientationDefaults.height
  );
  const portraitRemaining = availableHeight - HEADER_HEIGHT - TABS_HEIGHT - PANEL_HEIGHT;
  const fullPreviewHeight =
    (orientationDefaults.game.bottom - orientationDefaults.game.top) * scale;
  const previewHeight = Math.min(fullPreviewHeight, portraitRemaining * PREVIEW_SHARE);
  const portraitCanvasHeight = portraitRemaining - previewHeight;
  const editableHeight = (orientationDefaults.height - orientationDefaults.top) * scale;

  const canvas: Canvas = isLandscape
    ? {
        scale,
        ySquash: 1,
        originX: (availableWidth - orientationDefaults.width * scale) / 2,
        originY: (availableHeight - orientationDefaults.height * scale) / 2,
        defaults: orientationDefaults,
      }
    : {
        scale,
        ySquash: Math.min(1, portraitCanvasHeight / editableHeight),
        originX: (availableWidth - orientationDefaults.width * scale) / 2,
        originY: 0,
        defaults: orientationDefaults,
      };

  const gameScale = (
    ((orientationDefaults.game.right - orientationDefaults.game.left) *
      scale *
      PixelRatio.get()) /
    picture.width
  ).toFixed(1);

  const panelWidth = Math.min(availableWidth - 16, LANDSCAPE_PANEL_WIDTH * scale);
  // Clamped here so the panel stays on screen when it grows, as well as while dragging.
  const panelLeft = Math.min(
    Math.max(0, availableWidth - panelWidth),
    Math.max(0, panelSpot?.left ?? (availableWidth - panelWidth) / 2)
  );
  const panelTop = Math.min(
    Math.max(0, availableHeight - panelHeight),
    Math.max(0, panelSpot?.top ?? canvas.originY + LANDSCAPE_PANEL_TOP * scale)
  );

  function beginChange() {
    beforeGesture.current = layout;
  }

  function endChange() {
    const before = beforeGesture.current;
    beforeGesture.current = null;
    if (before && before !== layout) setHistory((past) => [...past, before]);
  }

  function updateOrientation(next: OrientationLayout) {
    setLayout((previous) => ({ ...previous, [orientation]: next }));
  }

  function placeControl(control: ControlDefault, next: PlacedControl) {
    updateOrientation({
      ...current,
      controls: {
        ...current.controls,
        [control.id]: fitControl(control, orientationDefaults, next, snapToGrid),
      },
    });
  }

  function addExtras(bindings: ExtraBinding[]) {
    const panelInLowerHalf = panelTop + panelHeight / 2 > availableHeight / 2;
    const landscapeSpawnY = panelInLowerHalf
      ? LANDSCAPE_SPAWN_Y_ABOVE_PANEL
      : LANDSCAPE_SPAWN_Y_BELOW_PANEL;
    const spawnY = isLandscape
      ? landscapeSpawnY
      : (orientationDefaults.top + orientationDefaults.height) / 2;
    const added = createExtraControls(bindings, orientationDefaults, extras.length, spawnY);
    setHistory((past) => [...past, layout]);
    updateOrientation({ ...current, extras: [...extras, ...added] });
    setSelectedId(added[added.length - 1]?.id ?? null);
    setAdding(false);
  }

  function deleteExtra(id: string) {
    setHistory((past) => [...past, layout]);
    updateOrientation(withoutExtra(current, id));
    setSelectedId(null);
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setLayout(previous);
    setHistory(history.slice(0, -1));
  }

  function selectOrientation(next: Orientation) {
    setSelectedId(null);
    setOrientation(next);
  }

  function reset() {
    setHistory((past) => [...past, layout]);
    updateOrientation(emptyLayout(system)[orientation]);
    setSelectedId(null);
    setConfirmingReset(false);
  }

  async function done() {
    setFailed(false);
    try {
      await saveControlLayout(layout, system);
      router.back();
    } catch {
      setFailed(true);
    }
  }

  const controls = allControls.map((control) => (
    <EditableControl
      key={control.id}
      control={control}
      placed={placedControl(control, current)}
      canvas={canvas}
      opacity={current.opacity}
      selected={control.id === selectedId}
      onSelect={() => setSelectedId(control.id)}
      onBegin={beginChange}
      onChange={(next) => placeControl(control, next)}
      onEnd={endChange}
    />
  ));

  const opacitySlider = (
    <Slider
      label="Opacity"
      value={current.opacity}
      min={MIN_OPACITY}
      max={1}
      step={OPACITY_STEP}
      formatValue={(value) => `${Math.round(value * 100)}%`}
      onChange={(opacity) => updateOrientation({ ...current, opacity })}
      onStart={beginChange}
      onComplete={endChange}
    />
  );
  const opacityValue = (
    <Text className="w-14 text-right font-mono text-[14px] text-secondary">
      {Math.round(current.opacity * 100)}%
    </Text>
  );
  const failureMessage = failed && (
    <Text
      accessibilityLiveRegion="polite"
      className="font-inter text-[13px] leading-[18px] text-danger">
      Couldn’t save your layout. Try again.
    </Text>
  );

  const resetDialog = confirmingReset && (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={() => setConfirmingReset(false)}>
      <View className="flex-1 justify-center bg-black/80 px-6">
        <View
          accessibilityViewIsModal
          className="w-full max-w-[420px] gap-5 self-center rounded-3xl border border-control-border bg-control p-6">
          <View className="gap-3">
            <Text
              className="font-inter-bold text-[22px] leading-[28px] text-foreground"
              accessibilityRole="header">
              Reset {orientation} layout?
            </Text>
            <Text className="font-inter text-[15px] leading-[22px] text-secondary">
              Every control in {orientation} goes back to its default place and size, and buttons
              you added are removed.
            </Text>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <SetupButton
                label="Cancel"
                variant="secondary"
                onPress={() => setConfirmingReset(false)}
              />
            </View>
            <View className="flex-1">
              <SetupButton label="Reset" variant="danger" onPress={reset} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );

  const addButton = (
    <IconAction
      label="Add a button"
      disabled={extras.length >= MAX_EXTRA_CONTROLS}
      onPress={() => setAdding(true)}>
      <Plus size={22} color={palette.accent.DEFAULT} />
    </IconAction>
  );
  const addDialog = adding && (
    <AddControlDialog onAdd={addExtras} onClose={() => setAdding(false)} />
  );

  if (isLandscape) {
    const pictureWidth = Math.min(availableWidth, availableHeight * (picture.width / picture.height));
    const pictureHeight = pictureWidth * (picture.height / picture.width);

    return (
      <View className="flex-1 bg-black">
        <StatusBar hidden />
        <NavigationBar hidden />
        {insets.left > 0 && (
          <View className="absolute inset-y-0 left-0 items-center justify-center" style={{ width: insets.left }}>
            <Hatching id="hatch-left" />
            <Text
              className="w-[140px] text-center font-mono text-[10px] text-danger"
              style={{ transform: [{ rotate: '-90deg' }] }}>
              CUTOUT SAFE AREA
            </Text>
          </View>
        )}
        {insets.right > 0 && (
          <View className="absolute inset-y-0 right-0" style={{ width: insets.right }}>
            <Hatching id="hatch-right" />
          </View>
        )}
        {insets.bottom > 0 && (
          <View
            className="absolute inset-x-0 bottom-0 items-center justify-center"
            style={{ height: insets.bottom }}>
            <Hatching id="hatch-bottom" />
            <Text className="font-mono text-[10px] text-danger">
              GESTURE AREA · CONTROLS CAN&apos;T BE DROPPED HERE
            </Text>
          </View>
        )}

        <View
          className="absolute"
          style={{
            left: insets.left,
            top: insets.top,
            width: availableWidth,
            height: availableHeight,
          }}
          onStartShouldSetResponder={() => true}
          onResponderRelease={() => setSelectedId(null)}>
          <DotGrid />
          {previewUri ? (
            <Image
              source={{ uri: previewUri }}
              resizeMode="cover"
              className="absolute opacity-40"
              style={{
                left: (availableWidth - pictureWidth) / 2,
                top: (availableHeight - pictureHeight) / 2,
                width: pictureWidth,
                height: pictureHeight,
              }}
            />
          ) : null}
          {controls}

          <FloatingPanel
            left={panelLeft}
            top={panelTop}
            width={panelWidth}
            onDrag={(left, top) => setPanelSpot({ left, top })}
            onHeight={setPanelHeight}>
            <View className="flex-row items-center gap-2">
              <IconAction label="Close" onPress={() => router.back()}>
                <X size={20} color={palette.secondary} />
              </IconAction>
              <View className="flex-1 flex-row rounded-[14px] border border-control-border p-0.5">
                <OrientationTab
                  label="Portrait"
                  selected={false}
                  onPress={() => selectOrientation('portrait')}
                />
                <OrientationTab
                  label="Landscape"
                  selected
                  onPress={() => selectOrientation('landscape')}
                />
              </View>
              <DoneButton onPress={done} />
            </View>
            <View className="flex-row items-center gap-3 px-1">
              <Text className="font-inter-semibold text-[14px] text-foreground">Opacity</Text>
              {opacitySlider}
              {opacityValue}
            </View>
            <View className="flex-row items-center gap-2 px-1">
              <Toggle
                label="Snap to grid"
                value={snapToGrid}
                onChange={() => setSnapToGrid(!snapToGrid)}
              />
              <Text className="flex-1 font-inter-semibold text-[14px] text-foreground">
                Snap to grid
              </Text>
              {addButton}
              <IconAction label="Undo" disabled={history.length === 0} onPress={undo}>
                <Undo2 size={20} color={palette.secondary} />
              </IconAction>
              <ResetButton onPress={() => setConfirmingReset(true)} />
            </View>
            {selectedExtra && (
              <View className="flex-row items-center gap-3 px-1">
                <Text
                  className="flex-1 font-inter-semibold text-[14px] text-foreground"
                  numberOfLines={1}>
                  {controlName(selectedExtra)}
                </Text>
                <DeleteControlButton
                  label={controlName(selectedExtra)}
                  onPress={() => deleteExtra(selectedExtra.id)}
                />
              </View>
            )}
            {failureMessage}
          </FloatingPanel>
        </View>
        {resetDialog}
        {addDialog}
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <StatusBar hidden />
      <NavigationBar hidden />
      <View className="flex-row items-center gap-3 px-3" style={{ height: HEADER_HEIGHT }}>
        <IconAction label="Close" onPress={() => router.back()}>
          <X size={22} color={palette.secondary} />
        </IconAction>
        <Text
          className="flex-1 font-inter-bold text-[20px] leading-[26px] text-foreground"
          accessibilityRole="header">
          Edit controls
        </Text>
        <IconAction label="Undo" disabled={history.length === 0} onPress={undo}>
          <Undo2 size={22} color={palette.secondary} />
        </IconAction>
        <DoneButton onPress={done} />
      </View>

      <View className="px-5" style={{ height: TABS_HEIGHT }}>
        <View className="flex-row rounded-[14px] border border-control-border p-0.5">
          <OrientationTab
            label="Portrait"
            selected
            onPress={() => selectOrientation('portrait')}
          />
          <OrientationTab
            label="Landscape"
            selected={false}
            onPress={() => selectOrientation('landscape')}
          />
        </View>
      </View>

      <View style={{ height: previewHeight }} className="items-center justify-center">
        <View
          className="overflow-hidden rounded-md bg-card"
          style={{ height: previewHeight, aspectRatio: picture.width / picture.height }}>
          {previewUri ? (
            <Image
              source={{ uri: previewUri }}
              resizeMode="cover"
              className="h-full w-full opacity-40"
            />
          ) : null}
          <View className="absolute left-2 top-2 rounded-md bg-background/80 px-2 py-1">
            <Text className="font-mono text-[12px] text-secondary">
              screen locked · {gameScale}×
            </Text>
          </View>
        </View>
      </View>

      <View
        style={{ height: portraitCanvasHeight }}
        onStartShouldSetResponder={() => true}
        onResponderRelease={() => setSelectedId(null)}>
        <DotGrid />
        {controls}
      </View>

      <View
        className="justify-between rounded-t-3xl border-t border-card-border bg-card px-5 py-2"
        style={{ height: PANEL_HEIGHT }}>
        <View className="h-12 flex-row items-center gap-3">
          {selected ? (
            <>
              <Text
                className="w-20 font-inter-semibold text-[15px] text-foreground"
                numberOfLines={1}>
                {controlName(selected)} size
              </Text>
              <Slider
                key={selected.id}
                label={`${controlName(selected)} size`}
                value={placedControl(selected, current).size}
                {...sizeLimits(selected)}
                step={snapToGrid ? GRID_DP : 1}
                formatValue={(value) => `${Math.round(value)} dp`}
                onChange={(size) =>
                  placeControl(selected, { ...placedControl(selected, current), size })
                }
                onStart={beginChange}
                onComplete={endChange}
              />
              <Text className="w-14 text-right font-mono text-[14px] text-secondary">
                {Math.round(placedControl(selected, current).size)} dp
              </Text>
              {selectedExtra && (
                <DeleteControlButton
                  label={controlName(selectedExtra)}
                  onPress={() => deleteExtra(selectedExtra.id)}
                />
              )}
            </>
          ) : (
            <Text className="font-inter text-[14px] text-secondary">
              Tap a control to move or resize it.
            </Text>
          )}
        </View>
        <View className="h-12 flex-row items-center gap-3">
          <Text className="w-20 font-inter-semibold text-[15px] text-foreground">Opacity</Text>
          {opacitySlider}
          {opacityValue}
        </View>
        <View className="h-12 flex-row items-center gap-2">
          <Toggle
            label="Snap to grid"
            value={snapToGrid}
            onChange={() => setSnapToGrid(!snapToGrid)}
          />
          <Text className="flex-1 font-inter-semibold text-[15px] text-foreground">
            Snap to grid
          </Text>
          {addButton}
          <ResetButton onPress={() => setConfirmingReset(true)} />
        </View>
        {failureMessage}
      </View>
      {resetDialog}
      {addDialog}
    </View>
  );
}
