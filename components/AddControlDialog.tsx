import Camera from 'lucide-react-native/icons/camera';
import FastForward from 'lucide-react-native/icons/fast-forward';
import FolderOpen from 'lucide-react-native/icons/folder-open';
import type { LucideIcon } from 'lucide-react-native';
import Save from 'lucide-react-native/icons/save';
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { palette } from '@/constants/palette';
import {
  EXTRA_PRESETS,
  type ExtraAction,
  type ExtraBinding,
  type ExtraPreset,
} from '@/lib/controlLayout';

// Keeps the dialog clear of the status and navigation bars.
const DIALOG_MARGIN = 64;

const ACTION_ICONS: Record<ExtraAction, LucideIcon> = {
  QUICK_LOAD: FolderOpen,
  QUICK_SAVE: Save,
  FAST_FORWARD: FastForward,
  SCREENSHOT: Camera,
};

function Badge({ binding }: { binding: ExtraBinding }) {
  if (binding.action) {
    const Icon = ACTION_ICONS[binding.action];
    return (
      <View className="h-10 w-10 items-center justify-center">
        <Icon size={26} color={palette.secondary} />
      </View>
    );
  }
  return (
    <View
      className={`h-10 w-10 items-center justify-center rounded-full border-2 ${
        binding.turbo ? 'border-danger' : 'border-secondary'
      }`}>
      <Text
        className={`font-inter-semibold text-[14px] ${
          binding.turbo ? 'text-danger' : 'text-foreground'
        }`}>
        {binding.buttons.join('')}
      </Text>
    </View>
  );
}

function PresetRow({ preset, onPress }: { preset: ExtraPreset; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={preset.title}
      onPress={onPress}
      className="min-h-[60px] flex-row items-center gap-3 px-5 active:bg-control-pressed">
      {preset.bindings.map((binding) => (
        <Badge key={binding.label} binding={binding} />
      ))}
      <Text className="ml-2 flex-1 font-inter text-[17px] text-foreground">{preset.title}</Text>
    </Pressable>
  );
}

export function AddControlDialog({
  onAdd,
  onClose,
}: {
  onAdd: (bindings: ExtraBinding[]) => void;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();

  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}>
      <View className="flex-1 justify-center bg-black/80 px-6">
        <View
          accessibilityViewIsModal
          className="w-full max-w-[520px] self-center overflow-hidden rounded-3xl border border-control-border bg-control"
          style={{ maxHeight: height - DIALOG_MARGIN }}>
          <Text
            className="px-6 py-4 font-inter-bold text-[22px] leading-[28px] text-foreground"
            accessibilityRole="header">
            Add control
          </Text>
          <ScrollView className="bg-background">
            {EXTRA_PRESETS.map((preset) => (
              <PresetRow
                key={preset.title}
                preset={preset}
                onPress={() => onAdd(preset.bindings)}
              />
            ))}
          </ScrollView>
          <View className="items-end px-3 py-2">
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              className="h-12 justify-center rounded-[14px] px-4 active:bg-control-pressed">
              <Text className="font-inter-semibold text-[16px] text-foreground">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
