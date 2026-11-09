import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import Save from 'lucide-react-native/icons/save';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { useCallback, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SetupButton } from '@/components/SetupCard';
import { palette } from '@/constants/palette';
import { formatClock, type Game, getPlayRequest, loadGameMeta, requestPlay, setQuickSlot } from '@/lib/library';
import {
  AUTO_STATE,
  DEFAULT_QUICK_SLOT,
  deleteSlot,
  formatSavedAt,
  getRomSaveId,
  markStateLoaded,
  PREVIEW_THUMBNAIL,
  readPreviewUri,
  readSlot,
  readSlots,
  slotStateName,
  SLOT_COUNT,
  type StateSlot,
  UNDO_STATE,
} from '@/lib/saveStates';
import KrsEmulator from '@/modules/krs-emulator';

const THUMBNAIL = 'h-16 w-24 rounded-lg';

type Dialog =
  | {
      kind: 'overwrite';
      slot: number;
      current: StateSlot;
      previewUri: string | null;
      capturedAt: number;
    }
  | { kind: 'delete'; slot: number };

export default function SaveStatesRoute() {
  const [request] = useState(getPlayRequest);
  const { inGame } = useLocalSearchParams<{ inGame?: string }>();
  return request ? (
    <SaveStatesScreen game={request.game} inGame={inGame === '1'} />
  ) : (
    <Redirect href="/library" />
  );
}

function Thumbnail({ uri, className }: { uri: string | null; className: string }) {
  return uri ? (
    <Image source={{ uri }} className={className} resizeMode="cover" />
  ) : (
    <View className={`${className} bg-control`} />
  );
}

function SaveStatesScreen({ game, inGame }: { game: Game; inGame: boolean }) {
  const [saveId, setSaveId] = useState<string | null>(null);
  const [auto, setAuto] = useState<StateSlot | null>(null);
  const [slots, setSlots] = useState<StateSlot[]>([]);
  const [quickSlot, setQuickSlotState] = useState(
    () => loadGameMeta()[game.id]?.quickSlot ?? DEFAULT_QUICK_SLOT
  );
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback((id: string) => {
    setAuto(readSlot(id, AUTO_STATE));
    setSlots(readSlots(id));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getRomSaveId(game.uri)
        .then((id) => {
          if (!active) return;
          setSaveId(id);
          refresh(id);
        })
        .catch(() => {
          if (active) setFailure('Couldn’t read this game’s saves. Check the ROM is still there.');
        });
      return () => {
        active = false;
      };
    }, [game.uri, refresh])
  );

  async function attempt(action: () => Promise<void>, message: string) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch {
      setFailure(message);
    } finally {
      setBusy(false);
    }
  }

  function loadSlot(slot: StateSlot, slotNumber: number | null) {
    if (!inGame) {
      requestPlay({ game, startState: slot.name });
      router.replace('/player');
      return;
    }
    attempt(async () => {
      await KrsEmulator.saveState(UNDO_STATE);
      await KrsEmulator.loadState(slot.name);
      markStateLoaded(slotNumber === null ? 'auto-save' : `slot ${slotNumber}`);
      router.back();
    }, 'Couldn’t load that save state.');
  }

  function saveToEmptySlot(slot: number) {
    if (!saveId) return;
    attempt(async () => {
      await KrsEmulator.saveState(slotStateName(slot));
      refresh(saveId);
    }, 'Couldn’t write the save state.');
  }

  function askToOverwrite(slot: number, current: StateSlot) {
    if (!saveId) return;
    attempt(async () => {
      await KrsEmulator.captureThumbnail(PREVIEW_THUMBNAIL);
      setDialog({
        kind: 'overwrite',
        slot,
        current,
        previewUri: readPreviewUri(saveId),
        capturedAt: Date.now(),
      });
    }, 'Couldn’t prepare the save state.');
  }

  function confirmDialog() {
    if (!dialog || !saveId) return;
    const { kind, slot } = dialog;
    attempt(
      async () => {
        if (kind === 'overwrite') await KrsEmulator.saveState(slotStateName(slot));
        else deleteSlot(saveId, slotStateName(slot));
        refresh(saveId);
        setDialog(null);
      },
      kind === 'overwrite' ? 'Couldn’t write the save state.' : 'Couldn’t delete that save state.'
    );
  }

  function chooseQuickSlot(slot: number) {
    setQuickSlotState(slot);
    setQuickSlot(game.id, slot).catch(() => setFailure('Couldn’t save the quick slot.'));
  }

  const used = slots.filter((slot) => slot.savedAt !== null).length;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <StatusBar style="light" />
      <ScreenHeader title="Save states" subtitle={`${game.fileName} · ${used} of ${SLOT_COUNT} used`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-2 px-4 pb-6">
        {failure && (
          <Text
            accessibilityLiveRegion="polite"
            className="pb-2 font-inter text-[13px] leading-[18px] text-danger">
            {failure}
          </Text>
        )}

        {auto && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              auto.savedAt ? `Auto save, ${formatSavedAt(auto.savedAt)}. Load` : 'Auto save, empty'
            }
            accessibilityState={{ disabled: busy || !auto.savedAt }}
            disabled={busy || !auto.savedAt}
            onPress={() => loadSlot(auto, null)}
            className="flex-row items-center gap-3 rounded-2xl border border-card-border bg-card p-1.5 active:bg-control-pressed">
            <Thumbnail uri={auto.thumbnailUri} className={THUMBNAIL} />
            <View className="flex-1 gap-1">
              <View className="flex-row items-center gap-2">
                <Text className="font-mono-medium text-[15px] text-foreground">AUTO</Text>
                <View className="rounded-md border border-control-border px-1.5 py-0.5">
                  <Text className="font-mono text-[11px] text-secondary">on quit</Text>
                </View>
              </View>
              <Text className="font-mono text-[13px] text-secondary">
                {auto.savedAt ? formatSavedAt(auto.savedAt) : 'Empty'}
              </Text>
            </View>
            <Text className="pr-3 font-inter text-[13px] text-secondary">Load only</Text>
          </Pressable>
        )}

        {slots.map((slot, index) => {
          const number = index + 1;
          const isQuick = number === quickSlot;
          const quickBadge = isQuick && (
            <View className="rounded-md bg-accent px-1.5 py-0.5">
              <Text className="font-mono text-[11px] text-accent-on">QUICK</Text>
            </View>
          );

          if (slot.savedAt === null) {
            return (
              <Pressable
                key={slot.name}
                accessibilityLabel={`Slot ${number}, empty`}
                accessibilityHint="Long press to set as the quick slot"
                onLongPress={() => chooseQuickSlot(number)}
                className={`flex-row items-center gap-3 rounded-2xl border border-dashed p-1.5 ${
                  isQuick ? 'border-accent' : 'border-control-border'
                }`}>
                <View className={`${THUMBNAIL} border border-dashed border-control-border`} />
                <View className="flex-1 gap-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-mono-medium text-[15px] text-foreground">
                      SLOT {number}
                    </Text>
                    {quickBadge}
                  </View>
                  <Text className="font-mono text-[13px] text-secondary">Empty</Text>
                </View>
                {inGame && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Save here, slot ${number}`}
                    disabled={busy}
                    onPress={() => saveToEmptySlot(number)}
                    className="mr-1 h-12 justify-center rounded-[14px] border border-control-border px-3.5 active:bg-control-pressed">
                    <Text className="font-inter-semibold text-[14px] text-foreground">Save here</Text>
                  </Pressable>
                )}
              </Pressable>
            );
          }

          return (
            <Pressable
              key={slot.name}
              accessibilityRole="button"
              accessibilityLabel={`Slot ${number}, ${formatSavedAt(slot.savedAt)}. Load`}
              accessibilityHint="Long press to set as the quick slot"
              disabled={busy}
              onPress={() => loadSlot(slot, number)}
              onLongPress={() => chooseQuickSlot(number)}
              className={`flex-row items-center gap-3 rounded-2xl border bg-card p-1.5 active:bg-control-pressed ${
                isQuick ? 'border-accent' : 'border-card-border'
              }`}>
              <Thumbnail uri={slot.thumbnailUri} className={THUMBNAIL} />
              <View className="flex-1 gap-1">
                <View className="flex-row items-center gap-2">
                  <Text className="font-mono-medium text-[15px] text-foreground">SLOT {number}</Text>
                  {quickBadge}
                </View>
                <Text className="font-mono text-[13px] text-secondary">
                  {formatSavedAt(slot.savedAt)}
                </Text>
              </View>
              {inGame && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Overwrite slot ${number}`}
                  disabled={busy}
                  onPress={() => askToOverwrite(number, slot)}
                  className="h-12 w-12 items-center justify-center rounded-[14px] active:bg-control-pressed">
                  <Save size={21} color={palette.secondary} />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete slot ${number}`}
                disabled={busy}
                onPress={() => setDialog({ kind: 'delete', slot: number })}
                className="h-12 w-12 items-center justify-center rounded-[14px] active:bg-control-pressed">
                <Trash2 size={21} color={palette.danger} />
              </Pressable>
            </Pressable>
          );
        })}

        <Text className="pt-3 text-center font-inter text-[13px] leading-[18px] text-secondary">
          Tap a slot to load it · long-press to set the quick slot
        </Text>
      </ScrollView>

      {dialog && (
        <Modal
          transparent
          statusBarTranslucent
          navigationBarTranslucent
          animationType="fade"
          onRequestClose={() => setDialog(null)}>
          <View className="flex-1 justify-center bg-black/80 px-6">
            <View
              accessibilityViewIsModal
              className="w-full max-w-[420px] gap-5 self-center rounded-3xl border border-control-border bg-control p-6">
              <View className="gap-3">
                <Text
                  className="font-inter-bold text-[22px] leading-[28px] text-foreground"
                  accessibilityRole="header">
                  {dialog.kind === 'overwrite'
                    ? `Overwrite slot ${dialog.slot}?`
                    : `Delete slot ${dialog.slot}?`}
                </Text>
                <Text className="font-inter text-[15px] leading-[22px] text-secondary">
                  {dialog.kind === 'overwrite'
                    ? 'The current save in this slot will be replaced. You can’t undo this.'
                    : 'This save state will be removed. You can’t undo this.'}
                </Text>
              </View>

              {dialog.kind === 'overwrite' && (
                <View className="flex-row items-center gap-3">
                  <View className="flex-1 gap-1.5">
                    <Thumbnail
                      uri={dialog.current.thumbnailUri}
                      className="aspect-[3/2] w-full rounded-lg opacity-60"
                    />
                    <Text className="font-inter text-[13px] text-secondary">Replaced</Text>
                    <Text className="font-mono text-[13px] text-secondary line-through">
                      {dialog.current.savedAt ? formatSavedAt(dialog.current.savedAt) : ''}
                    </Text>
                  </View>
                  <ArrowRight size={18} color={palette.secondary} />
                  <View className="flex-1 gap-1.5">
                    <Thumbnail
                      uri={dialog.previewUri}
                      className="aspect-[3/2] w-full rounded-lg border-2 border-accent"
                    />
                    <Text className="font-inter text-[13px] text-secondary">New</Text>
                    <Text className="font-mono text-[13px] text-foreground">
                      Now · {formatClock(dialog.capturedAt)}
                    </Text>
                  </View>
                </View>
              )}

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <SetupButton
                    label="Cancel"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setDialog(null)}
                  />
                </View>
                <View className="flex-1">
                  <SetupButton
                    label={dialog.kind === 'overwrite' ? 'Overwrite' : 'Delete'}
                    variant="danger"
                    disabled={busy}
                    onPress={confirmDialog}
                  />
                </View>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}
