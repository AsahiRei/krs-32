import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable } from 'react-native';

import { palette } from '@/constants/palette';

const SLIDE_MS = 150;
const THUMB_TRAVEL = 20;

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  const [progress] = useState(() => new Animated.Value(value ? 1 : 0));

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      // Colors can't run on the native driver.
      useNativeDriver: false,
    }).start();
  }, [progress, value]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={8}
      onPress={onChange}>
      <Animated.View
        className="h-8 w-[52px] justify-center rounded-full border px-1"
        style={{
          backgroundColor: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [palette.control.DEFAULT, palette.accent.DEFAULT],
          }),
          borderColor: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [palette.secondary, palette.accent.DEFAULT],
          }),
        }}>
        <Animated.View
          className="h-[22px] w-[22px] rounded-full"
          style={{
            backgroundColor: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [palette.secondary, palette.accent.on],
            }),
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, THUMB_TRAVEL],
                }),
              },
            ],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
