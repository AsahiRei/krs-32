import Check from 'lucide-react-native/icons/check';
import { useEffect, useState } from 'react';
import { Animated, BackHandler, Easing, Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { SORT_OPTIONS, type SortMode } from '@/lib/library';

const OPEN_MS = 140;
const CLOSED_SCALE = 0.96;

type SortMenuProps = {
  /** Distance from the top of the parent to the top of the menu. */
  top: number;
  value: SortMode;
  onSelect: (mode: SortMode) => void;
  onClose: () => void;
};

/** A dropdown that fills its parent, so a tap anywhere outside the menu closes it. */
export function SortMenu({ top, value, onSelect, onClose }: SortMenuProps) {
  const [entrance] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  return (
    <View className="absolute inset-0">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close sort menu"
        onPress={onClose}
        className="absolute inset-0"
      />
      <Animated.View
        accessibilityRole="menu"
        style={{
          top,
          elevation: 12,
          opacity: entrance,
          transform: [
            {
              scale: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [CLOSED_SCALE, 1],
              }),
            },
          ],
        }}
        className="absolute right-6 w-[236px] rounded-[18px] border border-control-border bg-control py-2">
        <Text className="px-4 pb-1 pt-2 font-mono-medium text-[12px] tracking-[1.4px] text-secondary">
          SORT BY
        </Text>
        {SORT_OPTIONS.map(({ mode, label }) => {
          const selected = mode === value;
          return (
            <Pressable
              key={mode}
              accessibilityRole="menuitem"
              accessibilityState={{ selected }}
              onPress={() => onSelect(mode)}
              className="h-12 flex-row items-center gap-2 px-4 active:bg-control-pressed">
              <View className="w-5">
                {selected && <Check size={16} color={palette.accent.DEFAULT} strokeWidth={2.5} />}
              </View>
              <Text
                className={`font-inter-semibold text-[15px] ${
                  selected ? 'text-accent' : 'text-foreground'
                }`}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}
