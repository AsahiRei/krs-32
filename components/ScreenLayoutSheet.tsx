import Check from 'lucide-react-native/icons/check';
import { Animated, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedControl } from '@/components/SegmentedControl';
import { Slider } from '@/components/Slider';
import { useBottomSheet } from '@/components/useBottomSheet';
import { palette } from '@/constants/palette';
import {
  MAX_SCREEN_GAP,
  SCREEN_MODES,
  type ScreenLayout,
  type ScreenMode,
  type LayoutOrientation,
  SWAP_LABELS,
} from '@/lib/screenLayout';

// The preview's screens, in points. Each is a DS screen's 4:3.
const PREVIEW_HEIGHT = 64;

type PreviewScreen = { width: number; height: number; touch: boolean };

/** A tiny diagram of the arrangement: the main screen solid, the touchscreen outlined. */
function LayoutPreview({ mode, swapped, selected }: { mode: ScreenMode; swapped: boolean; selected: boolean }) {
  const big = { width: 36, height: 27 };
  const screens: PreviewScreen[] =
    mode === 'focus'
      ? [
          { ...big, touch: false },
          { width: 16, height: 12, touch: true },
        ]
      : [
          { ...big, touch: false },
          { ...big, touch: true },
        ];
  // Swapping changes which screen is which, never where the shapes go.
  const shown = swapped ? screens.map((screen) => ({ ...screen, touch: !screen.touch })) : screens;
  const visible = mode === 'single' ? shown.slice(0, 1) : shown;
  const stacked = mode === 'stacked';

  return (
    <View
      className="items-center justify-center rounded-xl bg-background"
      style={{ height: PREVIEW_HEIGHT }}>
      <View
        className={stacked ? 'items-center gap-1' : 'flex-row items-end gap-1.5'}
        style={stacked ? { transform: [{ scale: 0.8 }] } : undefined}>
        {visible.map((screen, index) => (
          <View
            key={index}
            style={{ width: screen.width, height: screen.height }}
            className={`rounded-[3px] ${
              screen.touch
                ? `border border-dashed ${selected ? 'border-accent' : 'border-secondary'}`
                : selected
                  ? 'bg-accent'
                  : 'bg-control-border'
            }`}
          />
        ))}
      </View>
    </View>
  );
}

function ModeCard({
  mode,
  label,
  description,
  swapped,
  selected,
  width,
  onPress,
}: {
  mode: ScreenMode;
  label: string;
  description: string;
  swapped: boolean;
  selected: boolean;
  width: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label}. ${description}`}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{ width }}
      className={`gap-2.5 rounded-2xl border bg-control p-2.5 active:bg-control-pressed ${
        selected ? 'border-accent' : 'border-control-border'
      }`}>
      <LayoutPreview mode={mode} swapped={swapped} selected={selected} />
      <View className="gap-0.5 px-1 pb-1">
        <View className="flex-row items-center justify-between">
          <Text className="font-inter-semibold text-[15px] text-foreground">{label}</Text>
          {selected && <Check size={16} color={palette.accent.DEFAULT} strokeWidth={2.5} />}
        </View>
        <Text className="font-inter text-[12px] leading-[16px] text-secondary" numberOfLines={2}>
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

type ScreenLayoutSheetProps = {
  orientation: LayoutOrientation;
  layout: ScreenLayout;
  /** Called on every change, so the screens behind the sheet show it straight away. */
  onChange: (layout: ScreenLayout) => void;
  onClose: () => void;
};

const SHEET_MAX_WIDTH = 560;
const SHEET_PADDING = 20;
const CARD_GAP = 8;

export function ScreenLayoutSheet({ orientation, layout, onChange, onClose }: ScreenLayoutSheetProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { translateY, scrimOpacity, close, dragHandlers } = useBottomSheet(onClose);

  const sheetWidth = Math.min(width, SHEET_MAX_WIDTH);
  // Four across when there's room for them to stay readable, otherwise two by two.
  const columns = sheetWidth >= 520 ? 4 : 2;
  const cardWidth = (sheetWidth - SHEET_PADDING * 2 - CARD_GAP * (columns - 1)) / columns;
  const swapLabels = SWAP_LABELS[layout.mode];

  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={close}>
      {/* Light enough to see the screens move behind it. */}
      <Animated.View style={{ opacity: scrimOpacity }} className="absolute inset-0 bg-black/40">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close screen layout"
          onPress={close}
          className="flex-1"
        />
      </Animated.View>

      <View className="flex-1 justify-end" pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          style={{ transform: [{ translateY }], maxHeight: height * 0.9, width: sheetWidth }}
          className="self-center rounded-t-3xl border-t border-card-border bg-card">
          <View {...dragHandlers} className="items-center py-3">
            <View className="h-1 w-9 rounded-full bg-control-border" />
          </View>

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SHEET_PADDING, paddingBottom: insets.bottom + 20, gap: 18 }}>
            <View className="flex-row items-baseline justify-between">
              <Text
                accessibilityRole="header"
                className="font-inter-bold text-[22px] leading-[28px] text-foreground">
                Screen layout
              </Text>
              <Text className="font-mono text-[12px] text-secondary">
                {orientation} · this game
              </Text>
            </View>

            <View accessibilityRole="radiogroup" className="flex-row flex-wrap" style={{ gap: CARD_GAP }}>
              {SCREEN_MODES.map((option) => (
                <ModeCard
                  key={option.mode}
                  {...option}
                  width={cardWidth}
                  swapped={layout.swapped}
                  selected={layout.mode === option.mode}
                  onPress={() => onChange({ ...layout, mode: option.mode })}
                />
              ))}
            </View>

            <View className="gap-2.5">
              <Text className="font-mono-medium text-[12px] tracking-[1.4px] text-secondary">
                {swapLabels.title.toUpperCase()}
              </Text>
              <SegmentedControl
                options={[
                  { value: 'normal', label: swapLabels.options[0] },
                  { value: 'swapped', label: swapLabels.options[1] },
                ]}
                value={layout.swapped ? 'swapped' : 'normal'}
                onChange={(value) => onChange({ ...layout, swapped: value === 'swapped' })}
              />
            </View>

            {layout.mode !== 'single' && (
              <View className="flex-row items-center gap-4">
                <Text className="font-inter-semibold text-[15px] text-foreground">Gap</Text>
                <Slider
                  label="Gap between screens"
                  value={layout.gap}
                  min={0}
                  max={MAX_SCREEN_GAP}
                  step={2}
                  formatValue={(value) => `${value} dp`}
                  onChange={(gap) => onChange({ ...layout, gap })}
                />
                <Text className="w-12 text-right font-mono text-[13px] text-foreground">
                  {layout.gap} dp
                </Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={close}
              className="h-[52px] items-center justify-center rounded-[14px] bg-accent active:bg-accent-pressed">
              <Text className="font-inter-semibold text-[17px] text-accent-on">Done</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
