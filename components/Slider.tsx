import { useState } from 'react';
import { PanResponder, View } from 'react-native';

import { useLatest } from '@/components/useLatest';

const THUMB_SIZE = 26;
const TOUCH_HEIGHT = 44;

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
  /** Called before the first change of a drag, so it can be undone as one step. */
  onStart?: () => void;
  onComplete?: () => void;
};

export function Slider({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
  onStart,
  onComplete,
}: SliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const latest = useLatest({ min, max, step, trackWidth, onChange, onStart, onComplete });

  const [panHandlers] = useState(() => {
    let startX = 0;
    const update = (x: number) => {
      const current = latest.get();
      const usable = Math.max(1, current.trackWidth - THUMB_SIZE);
      const ratio = Math.min(1, Math.max(0, (x - THUMB_SIZE / 2) / usable));
      const raw = current.min + ratio * (current.max - current.min);
      current.onChange(Math.round(raw / current.step) * current.step);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        startX = event.nativeEvent.locationX;
        latest.get().onStart?.();
        update(startX);
      },
      onPanResponderMove: (_, { dx }) => update(startX + dx),
      onPanResponderRelease: () => latest.get().onComplete?.(),
      onPanResponderTerminate: () => latest.get().onComplete?.(),
    }).panHandlers;
  });

  const ratio = (value - min) / (max - min);
  const thumbLeft = ratio * Math.max(0, trackWidth - THUMB_SIZE);
  const adjust = (direction: number) => {
    onStart?.();
    onChange(Math.min(max, Math.max(min, value + direction * step)));
    onComplete?.();
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: formatValue(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        adjust(event.nativeEvent.actionName === 'increment' ? 1 : -1)
      }
      {...panHandlers}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      className="flex-1 justify-center"
      style={{ height: TOUCH_HEIGHT }}>
      <View pointerEvents="none" className="h-1 rounded-full bg-control-border">
        <View
          className="h-1 rounded-full bg-accent"
          style={{ width: thumbLeft + THUMB_SIZE / 2 }}
        />
      </View>
      <View
        pointerEvents="none"
        className="absolute rounded-full border-2 border-accent bg-foreground"
        style={{ left: thumbLeft, width: THUMB_SIZE, height: THUMB_SIZE }}
      />
    </View>
  );
}
