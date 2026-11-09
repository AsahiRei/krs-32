import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import { useEffect, useState } from 'react';
import { Animated, Easing, FlatList, Pressable, Text, View } from 'react-native';

import { COVER_RATIO, GameGridCard } from '@/components/GameGridCard';
import { palette } from '@/constants/palette';
import type { Rom, ScanProgress } from '@/lib/library';
import { formatRomPath } from '@/lib/setup';

const SPIN_MS = 1000;
const MAX_PLACEHOLDERS = 8;
const PLACEHOLDERS_WHILE_LISTING = 6;
const LABEL_WIDTHS = ['80%', '60%', '70%', '50%'] as const;

function SpinningIcon() {
  const [turn] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spin.start();
    return () => spin.stop();
  }, [turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <RotateCcw size={20} color={palette.accent.DEFAULT} />
    </Animated.View>
  );
}

function PlaceholderCard({
  width,
  index,
  reading,
}: {
  width: number;
  index: number;
  reading: boolean;
}) {
  return (
    <View style={{ width }} className="mb-5">
      <View
        style={{ height: width * COVER_RATIO }}
        className="items-center justify-center rounded-xl border border-card-border bg-control">
        {reading && <Text className="font-mono text-[12px] text-secondary">reading…</Text>}
      </View>
      <View
        style={{ width: LABEL_WIDTHS[index % LABEL_WIDTHS.length] }}
        className="mt-2 h-3 rounded-full bg-control"
      />
    </View>
  );
}

type ScanningViewProps = {
  progress: ScanProgress;
  folderUri: string | null;
  cardWidth: number;
  columns: number;
  columnGap: number;
  sidePadding: number;
  onCancel: () => void;
};

export function ScanningView({
  progress: { found, total, path },
  folderUri,
  cardWidth,
  columns,
  columnGap,
  sidePadding,
  onCancel,
}: ScanningViewProps) {
  const placeholderCount = total
    ? Math.min(total - found.length, MAX_PLACEHOLDERS)
    : PLACEHOLDERS_WHILE_LISTING;
  const placeholders = Array.from({ length: placeholderCount }, (_, index) => index);
  const items: (Rom | number)[] = [...found, ...placeholders];
  const percent = total ? Math.round((found.length / total) * 100) : 0;

  return (
    <FlatList
      data={items}
      numColumns={columns}
      keyExtractor={(item) => (typeof item === 'number' ? `placeholder-${item}` : item.id)}
      columnWrapperStyle={{ gap: columnGap, paddingHorizontal: sidePadding }}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View className="gap-5 px-6 pb-4">
          <View
            accessibilityLiveRegion="polite"
            className="gap-3 rounded-[18px] border border-card-border bg-card p-4">
            <View className="flex-row items-center gap-3">
              <SpinningIcon />
              <Text className="flex-1 font-inter-semibold text-[17px] text-foreground">
                Scanning ROM folder…
              </Text>
              {total > 0 && (
                <Text className="font-mono text-[14px] text-foreground">
                  {found.length} / {total}
                </Text>
              )}
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: percent }}
              className="h-2 overflow-hidden rounded-full bg-control">
              <View style={{ width: `${percent}%` }} className="h-full rounded-full bg-accent" />
            </View>
            <Text
              className="font-mono text-[13px] text-secondary"
              numberOfLines={1}
              ellipsizeMode="middle">
              {path && folderUri ? formatRomPath(folderUri, path) : 'Looking for games…'}
            </Text>
            <View className="flex-row items-center justify-between">
              <Text className="font-inter text-[14px] text-secondary">
                Reading titles and file sizes
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={12}
                onPress={onCancel}
                className="active:opacity-60">
                <Text className="font-inter-semibold text-[15px] text-foreground underline">
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
          <Text className="font-mono-medium text-[12px] tracking-[1.4px] text-secondary">
            FOUND SO FAR
          </Text>
        </View>
      }
      renderItem={({ item }) =>
        typeof item === 'number' ? (
          <PlaceholderCard width={cardWidth} index={item} reading={item === 0 && total > 0} />
        ) : (
          <GameGridCard game={item} width={cardWidth} showLastPlayed={false} />
        )
      }
    />
  );
}
