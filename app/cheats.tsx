import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import Plus from 'lucide-react-native/icons/plus';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Toggle } from '@/components/Toggle';
import { palette } from '@/constants/palette';
import {
  activeCheatCodes,
  type Cheat,
  cheatTag,
  codeLines,
  loadCheats,
  saveCheats,
} from '@/lib/cheats';
import { type Game, getPlayRequest } from '@/lib/library';
import { getRomSaveId } from '@/lib/saveStates';
import KrsEmulator from '@/modules/krs-emulator';

const SWIPE_START_PX = 10;
const DELETE_WIDTH = 88;
const SWIPE_OPEN_PX = 56;

export default function CheatsRoute() {
  const [request] = useState(getPlayRequest);
  const { inGame } = useLocalSearchParams<{ inGame?: string }>();
  return request ? (
    <CheatsScreen game={request.game} inGame={inGame === '1'} />
  ) : (
    <Redirect href="/library" />
  );
}

function CheatRow({
  cheat,
  onEdit,
  onToggle,
  onDelete,
}: {
  cheat: Cheat;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [offset] = useState(() => new Animated.Value(0));
  const [open, setOpen] = useState(false);

  const panHandlers = useMemo(() => {
    const settle = (toValue: number) =>
      Animated.spring(offset, { toValue, bounciness: 0, useNativeDriver: true }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        Math.abs(dx) > SWIPE_START_PX && Math.abs(dx) > Math.abs(dy),
      onPanResponderMove: (_, { dx }) =>
        offset.setValue(Math.max(-DELETE_WIDTH, Math.min(0, (open ? -DELETE_WIDTH : 0) + dx))),
      onPanResponderRelease: (_, { dx }) => {
        const shouldOpen = open ? dx < SWIPE_OPEN_PX : dx < -SWIPE_OPEN_PX;
        setOpen(shouldOpen);
        settle(shouldOpen ? -DELETE_WIDTH : 0);
      },
    }).panHandlers;
  }, [offset, open]);

  const lines = codeLines(cheat.code);
  const summary = lines.length > 1 ? `${lines[0]} · ${lines.length} lines` : lines[0];

  return (
    <View className="overflow-hidden rounded-2xl">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete ${cheat.name}`}
        onPress={onDelete}
        style={{ width: DELETE_WIDTH }}
        className="absolute inset-y-0 right-0 items-center justify-center gap-1 bg-danger active:opacity-80">
        <Trash2 size={20} color={palette.accent.on} />
        <Text className="font-inter-semibold text-[13px] text-accent-on">Delete</Text>
      </Pressable>

      <Animated.View {...panHandlers} style={{ transform: [{ translateX: offset }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${cheat.name}`}
          accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
          onAccessibilityAction={onDelete}
          onPress={onEdit}
          className="flex-row items-center gap-3 rounded-2xl border border-card-border bg-card px-4 py-3.5 active:bg-control-pressed">
          <View className="flex-1 gap-1.5">
            <View className="flex-row items-center gap-2">
              <Text
                className="shrink font-inter-semibold text-[17px] text-foreground"
                numberOfLines={1}>
                {cheat.name}
              </Text>
              <View className="rounded-md border border-control-border px-1.5 py-0.5">
                <Text className="font-mono text-[11px] text-secondary">{cheatTag(cheat.type)}</Text>
              </View>
            </View>
            <Text className="font-mono text-[13px] text-secondary" numberOfLines={1}>
              {summary}
            </Text>
          </View>

          <Text
            className={`font-mono text-[12px] ${cheat.enabled ? 'text-foreground' : 'text-secondary'}`}>
            {cheat.enabled ? 'ON' : 'OFF'}
          </Text>
          <Toggle label={cheat.name} value={cheat.enabled} onChange={onToggle} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

function CheatsScreen({ game, inGame }: { game: Game; inGame: boolean }) {
  const [saveId, setSaveId] = useState<string | null>(null);
  const [cheats, setCheats] = useState<Cheat[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  // Rapid toggles would each queue a full reset-and-reapply on the emulator thread. Only one
  // call runs at a time, and anything toggled meanwhile is sent once as the newest list.
  const applying = useRef(false);
  const pendingApply = useRef<Cheat[] | null>(null);
  const applyToGame = useCallback(
    async (list: Cheat[]) => {
      if (!inGame) return;
      pendingApply.current = list;
      if (applying.current) return;
      applying.current = true;
      try {
        while (pendingApply.current) {
          const next = pendingApply.current;
          pendingApply.current = null;
          try {
            await KrsEmulator.setCheats(activeCheatCodes(next));
          } catch {
            setFailure('Couldn’t apply the cheats to the game. Close this screen and try again.');
          }
        }
      } finally {
        applying.current = false;
      }
    },
    [inGame]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getRomSaveId(game.uri)
        .then((id) => {
          if (!active) return;
          const list = loadCheats(id);
          setSaveId(id);
          setCheats(list);
          applyToGame(list);
        })
        .catch(() => {
          if (active) setFailure('Couldn’t read this game’s cheats. Check the ROM is still there.');
        });
      return () => {
        active = false;
      };
    }, [game.uri, applyToGame])
  );

  function update(next: Cheat[]) {
    if (!saveId) return;
    setCheats(next);
    applyToGame(next);
    saveCheats(saveId, next).catch(() =>
      setFailure('Couldn’t save your cheats. Your change will be lost when you leave this screen.')
    );
  }

  function openEditor(cheatId?: string) {
    router.push({
      pathname: '/cheat-edit',
      params: { ...(cheatId ? { cheatId } : {}), ...(saveId ? { saveId } : {}) },
    });
  }

  const onCount = cheats.filter((cheat) => cheat.enabled).length;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <StatusBar style="light" />
      <ScreenHeader
        title="Cheats"
        subtitle={`${onCount} of ${cheats.length} on · ${game.title}`}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add cheat"
            disabled={!saveId}
            onPress={() => openEditor()}
            className="h-12 w-12 items-center justify-center rounded-[14px] bg-accent active:bg-accent-pressed">
            <Plus size={22} color={palette.accent.on} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-2.5 px-4 pb-6">
        <View className="flex-row items-center gap-3 rounded-2xl border border-warning-border bg-warning-surface px-4 py-3.5">
          <CircleAlert size={20} color={palette.warning.DEFAULT} />
          <Text className="flex-1 font-inter text-[14px] leading-[20px] text-foreground">
            Cheats can corrupt in-game saves. Make a save state first.
          </Text>
        </View>

        {failure && (
          <Text
            accessibilityLiveRegion="polite"
            className="font-inter text-[13px] leading-[18px] text-danger">
            {failure}
          </Text>
        )}

        {cheats.map((cheat) => (
          <CheatRow
            key={cheat.id}
            cheat={cheat}
            onEdit={() => openEditor(cheat.id)}
            onToggle={() =>
              update(
                cheats.map((item) =>
                  item.id === cheat.id ? { ...item, enabled: !item.enabled } : item
                )
              )
            }
            onDelete={() => update(cheats.filter((item) => item.id !== cheat.id))}
          />
        ))}

        <Text className="pt-3 text-center font-inter text-[13px] leading-[18px] text-secondary">
          {cheats.length > 0
            ? 'Tap a cheat to edit · swipe left to delete'
            : 'No cheats yet. Tap + to add your first.'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
