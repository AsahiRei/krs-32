import Check from 'lucide-react-native/icons/check';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SetupButton } from '@/components/SetupCard';
import { palette } from '@/constants/palette';
import type { Game } from '@/lib/library';

type DeleteGameDialogProps = {
  game: Game;
  romPath: string;
  onCancel: () => void;
  onConfirm: (alsoDeleteSave: boolean) => Promise<void>;
};

export function DeleteGameDialog({ game, romPath, onCancel, onConfirm }: DeleteGameDialogProps) {
  const [alsoDeleteSave, setAlsoDeleteSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm(alsoDeleteSave);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <View
      accessibilityViewIsModal
      className="w-full gap-5 rounded-3xl border border-control-border bg-control p-6">
      <View className="gap-3">
        <Text
          className="font-inter-bold text-[22px] leading-[28px] text-foreground"
          accessibilityRole="header">
          Delete {game.title}?
        </Text>
        <Text className="font-inter text-[15px] leading-[22px] text-secondary">
          This removes the ROM file from your device. You can&apos;t undo this.
        </Text>
      </View>

      <View className="rounded-[10px] border border-card-border bg-card px-3 py-2.5">
        <Text
          className="font-mono text-[13px] text-secondary"
          numberOfLines={1}
          ellipsizeMode="middle">
          {romPath}
        </Text>
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: alsoDeleteSave, disabled: busy }}
        disabled={busy}
        onPress={() => setAlsoDeleteSave(!alsoDeleteSave)}
        className="flex-row gap-3 active:opacity-70">
        <View
          className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
            alsoDeleteSave ? 'border-danger bg-danger' : 'border-muted'
          }`}>
          {alsoDeleteSave && <Check size={16} color={palette.accent.on} strokeWidth={3} />}
        </View>
        <View className="flex-1 gap-1">
          <Text className="font-inter-semibold text-[15px] leading-[22px] text-foreground">
            Also delete the in-game save
          </Text>
          <Text className="font-inter text-[13px] leading-[20px] text-muted">
            Off by default, so your progress stays if you re-add the game
          </Text>
        </View>
      </Pressable>

      {failed && (
        <Text
          accessibilityLiveRegion="polite"
          className="font-inter text-[13px] leading-[18px] text-danger">
          Couldn&apos;t delete this file. Check that the ROM folder is still available.
        </Text>
      )}

      <View className="flex-row gap-3">
        <View className="flex-1">
          <SetupButton label="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
        </View>
        <View className="flex-1">
          <SetupButton label="Delete" variant="danger" disabled={busy} onPress={confirm} />
        </View>
      </View>
    </View>
  );
}
