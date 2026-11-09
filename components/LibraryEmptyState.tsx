import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { SetupButton } from '@/components/SetupCard';
import { palette } from '@/constants/palette';

const FOLDER_PATH =
  'M0.5 16.5A16 16 0 0 1 16.5 0.5H55A16 16 0 0 1 71 16.5H143.5A16 16 0 0 1 159.5 32.5V107.5A16 16 0 0 1 143.5 123.5H16.5A16 16 0 0 1 0.5 107.5Z';

const MARK_CELL = 12;
const MARK_STEP = MARK_CELL + 2;
const MARK_CELLS = [
  [0, 0],
  [1, 0],
  [0, 1],
];

function FolderIllustration() {
  return (
    <Svg width={160} height={124} viewBox="0 0 160 124">
      <Path d={FOLDER_PATH} fill={palette.card.DEFAULT} stroke={palette.card.border} />
      <Rect
        x={31.5}
        y={40.5}
        width={96}
        height={63}
        rx={10}
        fill={palette.background}
        stroke={palette.control.border}
        strokeDasharray="3 3"
      />
      {MARK_CELLS.map(([column, row]) => (
        <Rect
          key={`${column}-${row}`}
          x={66 + column * MARK_STEP}
          y={59 + row * MARK_STEP}
          width={MARK_CELL}
          height={MARK_CELL}
          fill={palette.accent.DEFAULT}
        />
      ))}
    </Svg>
  );
}

type LibraryEmptyStateProps = {
  title: string;
  body: string;
  /** Shown under the buttons, such as the current folder. */
  footer?: string;
  onChooseFolder: () => void;
  /** Omit when there is no folder to rescan. */
  onRescan?: () => void;
};

export function LibraryEmptyState({
  title,
  body,
  footer,
  onChooseFolder,
  onRescan,
}: LibraryEmptyStateProps) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentContainerClassName="grow px-6 pt-4"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      showsVerticalScrollIndicator={false}>
      <View className="flex-1 items-center justify-center py-8">
        <FolderIllustration />
        <Text
          className="mt-7 text-center font-inter-bold text-[22px] leading-[28px] text-foreground"
          accessibilityRole="header">
          {title}
        </Text>
        <Text className="mt-3 px-3 text-center font-inter text-[16px] leading-[24px] text-secondary">
          {body}
        </Text>
        <View className="mt-4 rounded-lg border border-card-border px-3 py-1.5">
          <Text className="font-mono text-[12px] text-secondary">.gba — subfolders included</Text>
        </View>
      </View>

      <View className="gap-3">
        <SetupButton label="Choose ROM folder" onPress={onChooseFolder} />
        {onRescan && (
          <SetupButton label="Rescan current folder" variant="secondary" onPress={onRescan} />
        )}
        {footer && (
          <Text
            className="text-center font-mono text-[12px] leading-[16px] text-secondary"
            numberOfLines={1}
            ellipsizeMode="middle">
            {footer}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}
