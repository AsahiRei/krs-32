import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ImagePlus from 'lucide-react-native/icons/image-plus';
import Play from 'lucide-react-native/icons/play';
import Star from 'lucide-react-native/icons/star';
import { useEffect, useState } from 'react';
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

import { DeleteGameDialog } from '@/components/DeleteGameDialog';
import { GameCover } from '@/components/GameCover';
import { SetupButton } from '@/components/SetupCard';
import { useBottomSheet } from '@/components/useBottomSheet';
import { palette } from '@/constants/palette';
import {
  formatClock,
  formatFileSize,
  formatLastPlayed,
  formatLastPlayedAt,
  formatPlayTime,
  type Game,
} from '@/lib/library';
import { loadCheats } from '@/lib/cheats';
import { chooseCover, downloadCover, hasCoverSearch, removeCover } from '@/lib/covers';
import { countUsedSlots, getRomSaveId, SLOT_COUNT } from '@/lib/saveStates';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1">
      <Text className="font-inter text-[13px] text-secondary">{label}</Text>
      <Text className="font-mono text-[15px] text-foreground" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ActionRow({
  label,
  value,
  danger = false,
  onPress,
}: {
  label: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      className="h-14 flex-row items-center gap-4 border-t border-card-border px-1.5 active:bg-control-pressed">
      <Text
        className={`flex-1 font-inter text-[16px] ${danger ? 'text-danger' : 'text-foreground'}`}>
        {label}
      </Text>
      {value && <Text className="font-mono text-[14px] text-secondary">{value}</Text>}
      {!danger && onPress && <ChevronRight size={18} color={palette.secondary} />}
    </Pressable>
  );
}

type GameSheetProps = {
  game: Game;
  romPath: string;
  onClose: () => void;
  onToggleFavorite: () => void;
  onPlay: (resume: boolean) => void;
  onOpenSaveStates: () => void;
  onOpenCheats: () => void;
  onDelete: (alsoDeleteSave: boolean) => Promise<void>;
};

export function GameSheet({
  game,
  romPath,
  onClose,
  onToggleFavorite,
  onPlay,
  onOpenSaveStates,
  onOpenCheats,
  onDelete,
}: GameSheetProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { translateY, scrimOpacity, close, dragHandlers } = useBottomSheet(onClose);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [usedSlots, setUsedSlots] = useState(0);
  const [cheatsOn, setCheatsOn] = useState(0);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  async function updateCover(action: () => Promise<unknown>) {
    if (coverBusy) return;
    setCoverBusy(true);
    setCoverError(null);
    try {
      await action();
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : 'Couldn’t use that image.');
    } finally {
      setCoverBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    getRomSaveId(game.uri)
      .then((saveId) => {
        if (!active) return;
        setUsedSlots(countUsedSlots(saveId));
        setCheatsOn(loadCheats(saveId).filter((cheat) => cheat.enabled).length);
      })
      // The counts are only a summary; the rows still open if the ROM can't be read here.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [game.uri]);

  const autoSaveAt = game.lastAutoSaveAt;

  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={confirmingDelete ? () => setConfirmingDelete(false) : close}>
      <Animated.View style={{ opacity: scrimOpacity }} className="absolute inset-0 bg-black/70">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          disabled={confirmingDelete}
          onPress={close}
          className="flex-1"
        />
      </Animated.View>

      {confirmingDelete ? (
        <View className="flex-1 justify-center px-6" pointerEvents="box-none">
          <DeleteGameDialog
            game={game}
            romPath={romPath}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={onDelete}
          />
        </View>
      ) : (
        <View className="flex-1 justify-end" pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal
            style={{ transform: [{ translateY }], maxHeight: height * 0.9 }}
            className="rounded-t-3xl border-t border-card-border bg-card">
            <View {...dragHandlers}>
              <View className="items-center py-3">
                <View className="h-1 w-9 rounded-full bg-control-border" />
              </View>

              <View className="flex-row gap-4 px-6 pb-5">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={game.coverFile ? 'Change cover image' : 'Add cover image'}
                  onPress={() => updateCover(() => chooseCover(game.id))}
                  className="active:opacity-70">
                  <GameCover game={game} width={96} height={128} />
                  <View className="absolute bottom-1.5 right-1.5 h-7 w-7 items-center justify-center rounded-full bg-background">
                    <ImagePlus size={14} color={palette.foreground} />
                  </View>
                </Pressable>
                <View className="flex-1 gap-2.5">
                  <View className="min-h-12 flex-row items-start gap-2">
                    <Text
                      className="flex-1 font-inter-bold text-[22px] leading-[28px] text-foreground"
                      accessibilityRole="header"
                      numberOfLines={2}>
                      {game.title}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        game.favorite ? 'Remove from favorites' : 'Add to favorites'
                      }
                      accessibilityState={{ selected: !!game.favorite }}
                      onPress={onToggleFavorite}
                      className="h-12 w-12 items-center justify-center rounded-[14px] border border-control-border active:bg-control-pressed">
                      <Star
                        size={20}
                        color={game.favorite ? palette.accent.DEFAULT : palette.foreground}
                        fill={game.favorite ? palette.accent.DEFAULT : 'none'}
                      />
                    </Pressable>
                  </View>
                  <Text
                    className="font-mono text-[12px] text-secondary"
                    numberOfLines={1}
                    ellipsizeMode="middle">
                    {game.fileName} · {formatFileSize(game.sizeBytes)}
                  </Text>
                  <View className="flex-row gap-5">
                    <Stat label="Play time" value={formatPlayTime(game.playSeconds)} />
                    <Stat label="Last played" value={formatLastPlayedAt(game.lastPlayedAt)} />
                  </View>
                </View>
              </View>
            </View>

            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerClassName="px-6"
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
              <View className="gap-3 pb-4">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onPlay(!!autoSaveAt)}
                  className="min-h-[60px] items-center justify-center rounded-[14px] bg-accent px-4 py-2 active:bg-accent-pressed">
                  <View className="flex-row items-center gap-3">
                    <Play size={18} color={palette.accent.on} fill={palette.accent.on} />
                    <Text className="font-inter-semibold text-[17px] text-accent-on">
                      {autoSaveAt ? 'Continue' : 'Play'}
                    </Text>
                  </View>
                  {autoSaveAt && (
                    <Text className="font-mono text-[12px] text-accent-on">
                      from auto-save · {formatLastPlayed(autoSaveAt).toLowerCase()}{' '}
                      {formatClock(autoSaveAt)}
                    </Text>
                  )}
                </Pressable>
                {autoSaveAt && (
                  <SetupButton
                    label="Start fresh"
                    variant="secondary"
                    onPress={() => onPlay(false)}
                  />
                )}
              </View>

              <ActionRow
                label="Save states"
                value={`${usedSlots} / ${SLOT_COUNT}`}
                onPress={onOpenSaveStates}
              />
              {/* The Player only applies cheats to GBA games so far. */}
              {game.system === 'nds' ? (
                <ActionRow label="Cheats" value="GBA only" />
              ) : (
                <ActionRow label="Cheats" value={`${cheatsOn} on`} onPress={onOpenCheats} />
              )}
              <ActionRow
                label={game.coverFile ? 'Change cover image' : 'Add cover image'}
                onPress={() => updateCover(() => chooseCover(game.id))}
              />
              {hasCoverSearch && (
                <ActionRow
                  label={coverBusy ? 'Searching for cover…' : 'Find cover online'}
                  onPress={() =>
                    updateCover(async () => {
                      if (!(await downloadCover(game))) {
                        throw new Error(`No box art found for “${game.title}”.`);
                      }
                    })
                  }
                />
              )}
              {game.coverFile && (
                <ActionRow
                  label="Remove cover image"
                  danger
                  onPress={() => updateCover(() => removeCover(game.id))}
                />
              )}
              {coverError && (
                <Text
                  accessibilityLiveRegion="polite"
                  className="pb-3 font-inter text-[13px] leading-[18px] text-danger">
                  {coverError}
                </Text>
              )}
              <ActionRow
                label="Delete game…"
                danger
                onPress={() => setConfirmingDelete(true)}
              />
            </ScrollView>
          </Animated.View>
        </View>
      )}
    </Modal>
  );
}
