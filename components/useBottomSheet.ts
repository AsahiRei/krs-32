import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, PanResponder, useWindowDimensions } from 'react-native';

const OPEN_MS = 240;
const CLOSE_MS = 180;
const DRAG_START_PX = 6;
const DRAG_CLOSE_PX = 96;
const DRAG_CLOSE_VELOCITY = 0.8;

/** Slide-up, drag-to-dismiss behavior shared by the app's bottom sheets. */
export function useBottomSheet(onClose: () => void) {
  const { height } = useWindowDimensions();
  const [translateY] = useState(() => new Animated.Value(height));

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: 0,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [translateY]);

  const close = useCallback(() => {
    Animated.timing(translateY, {
      toValue: height,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onClose());
  }, [height, onClose, translateY]);

  const dragHandlers = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          dy > DRAG_START_PX && Math.abs(dy) > Math.abs(dx),
        onPanResponderMove: (_, { dy }) => translateY.setValue(Math.max(0, dy)),
        onPanResponderRelease: (_, { dy, vy }) => {
          if (dy > DRAG_CLOSE_PX || vy > DRAG_CLOSE_VELOCITY) {
            close();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              bounciness: 0,
              useNativeDriver: true,
            }).start();
          }
        },
      }).panHandlers,
    [close, translateY]
  );

  const scrimOpacity = translateY.interpolate({
    inputRange: [0, height],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return { translateY, scrimOpacity, close, dragHandlers };
}
