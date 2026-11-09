import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SetupButton } from '@/components/SetupCard';
import { palette } from '@/constants/palette';
import {
  assignKeys,
  BUTTON_ROWS,
  type ControllerMapping,
  DEFAULT_CONTROLLER_MAPPING,
  formatKeys,
  loadControllerMapping,
  type MappingAction,
  saveControllerMapping,
  SHORTCUT_ROWS,
} from '@/lib/controllerMapping';
import KrsEmulator from '@/modules/krs-emulator';

const CONTROLLER_POLL_MS = 2000;
const PULSE_MS = 500;
const PULSE_MIN_OPACITY = 0.3;

function ListeningDot() {
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: PULSE_MIN_OPACITY,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!reduced) pulse.start();
    });
    return () => pulse.stop();
  }, [opacity]);

  return <Animated.View style={{ opacity }} className="h-2 w-2 rounded-full bg-accent" />;
}

function KeyChip({ children }: { children: string }) {
  return (
    <View className="rounded-lg border border-control-border bg-control px-2 py-1.5">
      <Text className="font-mono-medium text-[12px] text-foreground">{children}</Text>
    </View>
  );
}

function MappingRow({
  label,
  keys,
  listening,
  onPress,
}: {
  label: string;
  keys: string[];
  listening: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${
        listening ? 'press a button' : keys.length > 0 ? formatKeys(keys) : 'not set'
      }`}
      onPress={onPress}
      className={`h-12 flex-row items-center justify-between border-card-border px-3.5 ${
        listening ? 'border border-accent bg-accent/15' : 'active:bg-control-pressed'
      }`}>
      <Text className="font-inter-semibold text-[15px] text-foreground">{label}</Text>
      {listening ? (
        <View className="flex-row items-center gap-2">
          <ListeningDot />
          <Text className="font-inter-semibold text-[13px] text-accent">Press a button…</Text>
        </View>
      ) : keys.length > 0 ? (
        <KeyChip>{formatKeys(keys)}</KeyChip>
      ) : (
        <Text className="font-inter text-[13px] text-secondary">Not set</Text>
      )}
    </Pressable>
  );
}

export default function ControllerMappingScreen() {
  const [mapping, setMapping] = useState<ControllerMapping>(loadControllerMapping);
  const [listeningFor, setListeningFor] = useState<MappingAction | null>(null);
  const [controllers, setControllers] = useState(() => KrsEmulator.getControllers());
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [failed, setFailed] = useState(false);

  const update = useCallback((next: ControllerMapping) => {
    setMapping(next);
    setFailed(false);
    saveControllerMapping(next).catch(() => setFailed(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(
        () => setControllers(KrsEmulator.getControllers()),
        CONTROLLER_POLL_MS
      );
      return () => {
        clearInterval(timer);
        KrsEmulator.stopControllerCapture();
        setListeningFor(null);
      };
    }, [])
  );

  useEffect(() => {
    if (!listeningFor) return;
    const subscription = KrsEmulator.addListener('onControllerCapture', ({ keys }) => {
      setListeningFor(null);
      update(assignKeys(mapping, listeningFor, keys));
    });
    return () => subscription.remove();
  }, [listeningFor, mapping, update]);

  function toggleListening(action: MappingAction) {
    if (listeningFor === action) {
      KrsEmulator.stopControllerCapture();
      setListeningFor(null);
    } else {
      KrsEmulator.startControllerCapture();
      setListeningFor(action);
    }
  }

  function resetMapping() {
    KrsEmulator.stopControllerCapture();
    setListeningFor(null);
    update(DEFAULT_CONTROLLER_MAPPING);
    setConfirmingReset(false);
  }

  const controller = controllers[0];
  const status =
    controller?.battery != null ? `Connected · battery ${controller.battery}%` : 'Connected';

  return (
    <SafeAreaView className="flex-1 bg-background">
      <StatusBar style="light" />
      <View className="flex-row items-center gap-2 px-3 pb-3 pt-5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="h-12 w-12 items-center justify-center rounded-[14px] active:bg-control-pressed">
          <ArrowLeft size={22} color={palette.secondary} />
        </Pressable>
        <Text
          className="font-inter-bold text-[20px] leading-[26px] text-foreground"
          accessibilityRole="header">
          Controller mapping
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-3 px-4 pb-6">
        <View className="flex-row items-center gap-3 rounded-2xl border border-card-border bg-card p-3.5">
          <View className="flex-1 gap-0.5">
            <Text className="font-inter-semibold text-[16px] text-foreground" numberOfLines={1}>
              {controller ? controller.name : 'No controller connected'}
            </Text>
            {controller ? (
              <View className="flex-row items-center gap-1.5">
                <View className="h-2 w-2 rounded-full bg-success" />
                <Text className="font-inter text-[13px] text-secondary">{status}</Text>
              </View>
            ) : (
              <Text className="font-inter text-[13px] text-secondary">
                Pair one in your phone’s Bluetooth settings.
              </Text>
            )}
          </View>
          {controller && <Text className="font-mono text-[12px] text-secondary">player 1</Text>}
        </View>

        <View className="flex-row items-center justify-between pt-1">
          <Text className="font-mono-medium text-[12px] tracking-[1.4px] text-secondary">
            BUTTONS
          </Text>
          <Text className="font-inter text-[12px] text-secondary">Tap a row, then press</Text>
        </View>
        <View className="overflow-hidden rounded-2xl border border-card-border bg-card">
          {BUTTON_ROWS.map(({ action, label }) => (
            <MappingRow
              key={action}
              label={label}
              keys={mapping[action]}
              listening={listeningFor === action}
              onPress={() => toggleListening(action)}
            />
          ))}
          <View
            accessible
            accessibilityLabel="D-pad, D-pad and left stick"
            className="h-12 flex-row items-center justify-between px-3.5">
            <Text className="font-inter-semibold text-[15px] text-foreground">D-pad</Text>
            <KeyChip>DPAD + LEFT STICK</KeyChip>
          </View>
        </View>

        <Text className="pt-1 font-mono-medium text-[12px] tracking-[1.4px] text-secondary">
          SHORTCUTS
        </Text>
        <View className="overflow-hidden rounded-2xl border border-card-border bg-card">
          {SHORTCUT_ROWS.map(({ action, label }) => (
            <MappingRow
              key={action}
              label={label}
              keys={mapping[action]}
              listening={listeningFor === action}
              onPress={() => toggleListening(action)}
            />
          ))}
        </View>

        {failed && (
          <Text
            accessibilityLiveRegion="polite"
            className="font-inter text-[13px] leading-[18px] text-danger">
            Couldn’t save your mapping. Try again.
          </Text>
        )}

        <SetupButton
          label="Reset to defaults…"
          variant="secondary"
          onPress={() => setConfirmingReset(true)}
        />
      </ScrollView>

      {confirmingReset && (
        <Modal
          transparent
          statusBarTranslucent
          navigationBarTranslucent
          animationType="fade"
          onRequestClose={() => setConfirmingReset(false)}>
          <View className="flex-1 justify-center bg-black/80 px-6">
            <View
              accessibilityViewIsModal
              className="w-full max-w-[420px] gap-5 self-center rounded-3xl border border-control-border bg-control p-6">
              <View className="gap-3">
                <Text
                  className="font-inter-bold text-[22px] leading-[28px] text-foreground"
                  accessibilityRole="header">
                  Reset controller mapping?
                </Text>
                <Text className="font-inter text-[15px] leading-[22px] text-secondary">
                  Every button and shortcut goes back to its default.
                </Text>
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <SetupButton
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setConfirmingReset(false)}
                  />
                </View>
                <View className="flex-1">
                  <SetupButton label="Reset" variant="danger" onPress={resetMapping} />
                </View>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}
