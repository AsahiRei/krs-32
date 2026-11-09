import Check from 'lucide-react-native/icons/check';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

const SLIDE_MS = 180;

type SegmentedControlProps<T> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  height?: number;
  labelClassName?: string;
};

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  height = 52,
  labelClassName = 'font-inter-semibold text-[14px]',
}: SegmentedControlProps<T>) {
  const index = options.findIndex((option) => option.value === value);
  const [trackWidth, setTrackWidth] = useState(0);
  const [position] = useState(() => new Animated.Value(index));
  const segmentWidth = trackWidth / options.length;

  useEffect(() => {
    Animated.timing(position, {
      toValue: index,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [index, position]);

  return (
    <View className="rounded-[14px] border border-control-border p-1" style={{ height }}>
      <View
        className="flex-1 flex-row"
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}>
        {trackWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            className="absolute inset-y-0 left-0 rounded-[10px] bg-foreground"
            style={{
              width: segmentWidth,
              transform: [{ translateX: Animated.multiply(position, segmentWidth) }],
            }}
          />
        )}
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              className="flex-1 flex-row items-center justify-center gap-1.5">
              {selected && <Check size={15} color={palette.background} strokeWidth={2.5} />}
              <Text
                className={`${labelClassName} ${selected ? 'text-background' : 'text-secondary'}`}
                numberOfLines={1}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
