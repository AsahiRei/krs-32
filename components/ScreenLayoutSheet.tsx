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
const COMPACT_PREVIEW_HEIGHT = 44;
// Below this window height (landscape phones), the sheet drops descriptions and puts its controls
// side by side, so it fits without scrolling and leaves the screens behind it in view.
const COMPACT_HEIGHT = 520;

type PreviewScreen = { width: number; height: number; touch: boolean };

/** A tiny diagram of the arrangement: the main screen solid, the touchscreen outlined. */
function LayoutPreview({
  mode,
  swapped,
  selected,
  height,
}: {
  mode: ScreenMode;
  swapped: boolean;
  selected: boolean;
  height: number;
}) {
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

  if (mode === 'popup') {
    // The main screen, dimmed, with the other popped up over its middle.
    const [base, popup] = shown;
    return (
      <View className="items-center justify-center rounded-xl bg-background" style={{ height }}>
        <View
          style={{ width: 44 * (height / PREVIEW_HEIGHT), height: 33 * (height / PREVIEW_HEIGHT) }}
          className={`items-center justify-center rounded-[3px] ${
            base.touch ? 'border border-dashed border-secondary' : 'bg-control-border'
          }`}>
          <View
            style={{ width: 30 * (height / PREVIEW_HEIGHT), height: 22 * (height / PREVIEW_HEIGHT) }}
            className={`rounded-[3px] border ${
              selected ? 'border-accent' : 'border-secondary'
            } ${popup.touch ? 'border-dashed bg-background' : selected ? 'bg-accent' : 'bg-secondary'}`}
          />
        </View>
      </View>
    );
  }

  return (
    <View
      className="items-center justify-center rounded-xl bg-background"
      style={{ height }}>
      <View
        className={stacked ? 'items-center gap-1' : 'flex-row items-end gap-1.5'}
        style={{ transform: [{ scale: (stacked ? 0.8 : 1) * (height / PREVIEW_HEIGHT) }] }}>
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
  compact,
  onPress,
}: {
  mode: ScreenMode;
  label: string;
  description: string;
  swapped: boolean;
  selected: boolean;
  width: number;
  /** Short landscape screens: a smaller diagram and no description. */
  compact: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label}. ${description}`}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{ width }}
      className={`rounded-2xl border bg-control p-2.5 active:bg-control-pressed ${
        compact ? 'gap-2' : 'gap-2.5'
      } ${selected ? 'border-accent' : 'border-control-border'}`}>
      <LayoutPreview
        mode={mode}
        swapped={swapped}
        selected={selected}
        height={compact ? COMPACT_PREVIEW_HEIGHT : PREVIEW_HEIGHT}
      />
      <View className={`gap-0.5 px-1 ${compact ? '' : 'pb-1'}`}>
        <View className="flex-row items-center justify-between">
          <Text className="font-inter-semibold text-[15px] text-foreground">{label}</Text>
          {selected && <Check size={16} color={palette.accent.DEFAULT} strokeWidth={2.5} />}
        </View>
        {!compact && (
          <Text className="font-inter text-[12px] leading-[16px] text-secondary" numberOfLines={2}>
            {description}
          </Text>
        )}
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
const COMPACT_MAX_WIDTH = 760;
const SHEET_PADDING = 20;
const CARD_GAP = 8;

export function ScreenLayoutSheet({ orientation, layout, onChange, onClose }: ScreenLayoutSheetProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { translateY, scrimOpacity, close, dragHandlers } = useBottomSheet(onClose);

  const compact = height < COMPACT_HEIGHT;
  const sheetWidth = Math.min(width, compact ? COMPACT_MAX_WIDTH : SHEET_MAX_WIDTH);
  // One row in landscape so the sheet stays short; two or three across in portrait.
  const columns = compact ? SCREEN_MODES.length : sheetWidth >= 520 ? 3 : 2;
  const cardWidth = (sheetWidth - SHEET_PADDING * 2 - CARD_GAP * (columns - 1)) / columns;
  const swapLabels = SWAP_LABELS[layout.mode];
  // Single and Pop-up show one screen at a time, so there's no gap to set.
  const single = layout.mode === 'single' || layout.mode === 'popup';

  const doneButton = (
    <Pressable
      accessibilityRole="button"
      onPress={close}
      className={`items-center justify-center rounded-[14px] bg-accent active:bg-accent-pressed ${
        compact ? 'h-11 px-6' : 'h-[52px]'
      }`}>
      <Text className="font-inter-semibold text-[17px] text-accent-on">Done</Text>
    </Pressable>
  );

  const swapControl = (
    <View className="flex-1 gap-2">
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
        height={compact ? 44 : 52}
      />
    </View>
  );

  // Single shows one screen, so it has no gap. The control stays, dimmed, so nothing jumps.
  const gapControl = (
    <View
      className="flex-1 gap-2"
      style={{ opacity: single ? 0.4 : 1 }}
      pointerEvents={single ? 'none' : 'auto'}>
      <Text className="font-mono-medium text-[12px] tracking-[1.4px] text-secondary">
        GAP · {layout.gap} DP
      </Text>
      <View className="flex-row items-center">
        <Slider
          label="Gap between screens"
          value={layout.gap}
          min={0}
          max={MAX_SCREEN_GAP}
          step={2}
          formatValue={(value) => `${value} dp`}
          onChange={(gap) => onChange({ ...layout, gap })}
        />
      </View>
    </View>
  );

  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={close}>
      {/* Light enough to see the screens move behind it. */}
      <Animated.View
        style={{ opacity: scrimOpacity }}
        className={`absolute inset-0 ${compact ? 'bg-black/20' : 'bg-black/40'}`}>
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
          <View {...dragHandlers} className={`items-center ${compact ? 'py-2' : 'py-3'}`}>
            <View className="h-1 w-9 rounded-full bg-control-border" />
          </View>

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: SHEET_PADDING,
              paddingBottom: insets.bottom + (compact ? 12 : 20),
              gap: compact ? 12 : 18,
            }}>
            <View className="flex-row items-center justify-between gap-4">
              <View
                className={compact ? 'gap-0.5' : 'flex-1 flex-row items-baseline justify-between'}>
                <Text
                  accessibilityRole="header"
                  className="font-inter-bold text-[22px] leading-[28px] text-foreground">
                  Screen layout
                </Text>
                <Text className="font-mono text-[12px] text-secondary">
                  {orientation} · this game
                </Text>
              </View>
              {compact && doneButton}
            </View>

            <View accessibilityRole="radiogroup" className="flex-row flex-wrap" style={{ gap: CARD_GAP }}>
              {SCREEN_MODES.map((option) => (
                <ModeCard
                  key={option.mode}
                  {...option}
                  width={cardWidth}
                  swapped={layout.swapped}
                  selected={layout.mode === option.mode}
                  compact={compact}
                  onPress={() => onChange({ ...layout, mode: option.mode })}
                />
              ))}
            </View>

            {compact ? (
              <View className="flex-row gap-5">
                {swapControl}
                {gapControl}
              </View>
            ) : (
              <>
                {swapControl}
                {gapControl}
                {doneButton}
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
