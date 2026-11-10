import Play from 'lucide-react-native/icons/play';
import { useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedControl } from '@/components/SegmentedControl';
import { SetupButton } from '@/components/SetupCard';
import { useBottomSheet } from '@/components/useBottomSheet';
import { palette } from '@/constants/palette';
import { formatClock } from '@/lib/library';
import type { GameOrientation } from '@/lib/setup';

const FAST_FORWARD_OPTIONS = [1.5, 2, 3, 4].map((speed) => ({
  value: speed,
  label: `${speed}×`,
}));

const ORIENTATION_OPTIONS: { value: GameOrientation; label: string }[] = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'auto', label: 'Auto' },
];

function formatElapsed(totalSeconds: number) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(totalSeconds % 60)}`;
}

function QuickAction({
  label,
  detail,
  disabled,
  onPress,
}: {
  label: string;
  detail: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[60px] flex-1 justify-center gap-1 rounded-[14px] border border-control-border bg-control px-4 py-2 active:bg-control-pressed ${
        disabled ? 'opacity-50' : ''
      }`}>
      <Text className="font-inter-semibold text-[16px] text-foreground">{label}</Text>
      <Text className="font-mono text-[12px] text-secondary">{detail}</Text>
    </Pressable>
  );
}

function MenuTile({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      className="h-14 flex-1 flex-row items-center gap-3 rounded-[14px] border border-control-border bg-control px-4 active:bg-control-pressed">
      <Text className="flex-1 font-inter-semibold text-[15px] text-foreground" numberOfLines={1}>
        {label}
      </Text>
      {value && <Text className="font-mono text-[13px] text-secondary">{value}</Text>}
    </Pressable>
  );
}

type InGameMenuProps = {
  playedSeconds: number;
  quickSlot: number;
  quickSlotSavedAt: number | null;
  cheatsOn: number;
  fastForwardSpeed: number;
  onSelectSpeed: (speed: number) => void;
  orientation: GameOrientation;
  onSelectOrientation: (orientation: GameOrientation) => void;
  onOpenSaveStates: () => void;
  onOpenCheats: () => void;
  onOpenControls: () => void;
  onOpenScreenFilter: () => void;
  onQuickSave: () => Promise<void>;
  onQuickLoad: () => Promise<void>;
  onReset: () => Promise<void>;
  onSaveAndQuit: () => Promise<void>;
  onClose: () => void;
};

export function InGameMenu({
  playedSeconds,
  quickSlot,
  quickSlotSavedAt,
  cheatsOn,
  fastForwardSpeed,
  onSelectSpeed,
  orientation,
  onSelectOrientation,
  onOpenSaveStates,
  onOpenCheats,
  onOpenControls,
  onOpenScreenFilter,
  onQuickSave,
  onQuickLoad,
  onReset,
  onSaveAndQuit,
  onClose,
}: InGameMenuProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { translateY, scrimOpacity, close, dragHandlers } = useBottomSheet(onClose);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  async function run(action: () => Promise<void>, closeAfter = true) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      if (closeAfter) close();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That didn’t work. Try again.');
      setConfirmingReset(false);
    } finally {
      setBusy(false);
    }
  }

  const quickLoadDetail = quickSlotSavedAt
    ? `slot ${quickSlot} · ${formatClock(quickSlotSavedAt)}`
    : `slot ${quickSlot} · empty`;

  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={confirmingReset ? () => setConfirmingReset(false) : close}>
      <Animated.View style={{ opacity: scrimOpacity }} className="absolute inset-0 bg-black/70">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume"
          disabled={confirmingReset || busy}
          onPress={close}
          className="flex-1"
        />
      </Animated.View>

      {confirmingReset ? (
        <View className="flex-1 justify-center px-6" pointerEvents="box-none">
          <View
            accessibilityViewIsModal
            className="w-full max-w-[420px] gap-5 self-center rounded-3xl border border-control-border bg-control p-6">
            <View className="gap-3">
              <Text
                className="font-inter-bold text-[22px] leading-[28px] text-foreground"
                accessibilityRole="header">
                Reset this game?
              </Text>
              <Text className="font-inter text-[15px] leading-[22px] text-secondary">
                The game restarts from its boot screen. Anything since your last save is lost.
              </Text>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <SetupButton
                  label="Cancel"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setConfirmingReset(false)}
                />
              </View>
              <View className="flex-1">
                <SetupButton
                  label="Reset"
                  variant="danger"
                  disabled={busy}
                  onPress={() => run(onReset)}
                />
              </View>
            </View>
          </View>
        </View>
      ) : (
        <View className="flex-1 justify-end" pointerEvents="box-none">
          {height > width && (
            <View className="flex-1 items-center justify-center" pointerEvents="none">
              <Animated.View
                style={{ opacity: scrimOpacity }}
                className="flex-row items-center gap-3 rounded-2xl border border-control-border bg-background/90 px-4 py-3">
                <Text className="font-inter-semibold text-[15px] text-foreground">Paused</Text>
                <Text className="font-mono text-[13px] text-secondary">
                  {formatElapsed(playedSeconds)}
                </Text>
              </Animated.View>
            </View>
          )}

          <Animated.View
            accessibilityViewIsModal
            style={{ transform: [{ translateY }], maxHeight: height * 0.9 }}
            className="w-full max-w-[520px] self-center rounded-t-3xl border-t border-card-border bg-card">
            <View {...dragHandlers} className="items-center py-3">
              <View className="h-1 w-9 rounded-full bg-control-border" />
            </View>

            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerClassName="gap-4 px-5"
              contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={close}
                className="h-[52px] flex-row items-center justify-center gap-3 rounded-[14px] bg-accent active:bg-accent-pressed">
                <Play size={18} color={palette.accent.on} fill={palette.accent.on} />
                <Text className="font-inter-semibold text-[17px] text-accent-on">Resume</Text>
              </Pressable>

              <View className="flex-row gap-3">
                <QuickAction
                  label="Quick save"
                  detail={`→ slot ${quickSlot}`}
                  disabled={busy}
                  onPress={() => run(onQuickSave)}
                />
                <QuickAction
                  label="Quick load"
                  detail={quickLoadDetail}
                  disabled={busy || !quickSlotSavedAt}
                  onPress={() => run(onQuickLoad)}
                />
              </View>

              <View className="gap-2.5">
                <View className="flex-row items-center justify-between">
                  <Text className="font-mono-medium text-[12px] tracking-[1.4px] text-secondary">
                    FAST-FORWARD SPEED
                  </Text>
                  <Text className="font-inter text-[12px] text-secondary">used by ▸▸</Text>
                </View>
                <SegmentedControl
                  options={FAST_FORWARD_OPTIONS}
                  value={fastForwardSpeed}
                  onChange={onSelectSpeed}
                  height={56}
                  labelClassName="font-mono text-[15px]"
                />
              </View>

              <View className="gap-2.5">
                <Text className="font-mono-medium text-[12px] tracking-[1.4px] text-secondary">
                  SCREEN ORIENTATION
                </Text>
                <SegmentedControl
                  options={ORIENTATION_OPTIONS}
                  value={orientation}
                  onChange={onSelectOrientation}
                />
              </View>

              <View className="gap-2">
                <View className="flex-row gap-2">
                  <MenuTile label="Save state" onPress={onOpenSaveStates} />
                  <MenuTile label="Load state" onPress={onOpenSaveStates} />
                </View>
                <View className="flex-row gap-2">
                  <MenuTile label="Cheats" value={`${cheatsOn} on`} onPress={onOpenCheats} />
                  <MenuTile label="Screen filter" onPress={onOpenScreenFilter} />
                </View>
                <View className="flex-row gap-2">
                  <MenuTile label="Audio" />
                  <MenuTile label="Controls" onPress={onOpenControls} />
                </View>
              </View>

              {failure && (
                <Text
                  accessibilityLiveRegion="polite"
                  className="font-inter text-[13px] leading-[18px] text-danger">
                  {failure}
                </Text>
              )}

              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => setConfirmingReset(true)}
                  className="h-[52px] flex-1 flex-row items-center justify-center gap-2.5 rounded-[14px] border border-danger active:opacity-70">
                  <Text className="font-inter-semibold text-[16px] text-danger">Reset…</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => run(onSaveAndQuit, false)}
                  className="h-[52px] flex-1 flex-row items-center justify-center gap-2.5 rounded-[14px] border border-control-border active:bg-control-pressed">
                  <Text className="font-inter-semibold text-[16px] text-foreground">
                    Save &amp; quit
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      )}
    </Modal>
  );
}
