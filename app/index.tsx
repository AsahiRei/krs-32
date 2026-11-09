import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KrsIcon } from '@/components/KrsIcon';
import { SetupButton, SetupCard } from '@/components/SetupCard';
import {
  chooseRomFolder,
  importBios,
  isBiosImported,
  loadRomFolder,
  loadSettings,
  saveSettings,
  type RomFolder,
} from '@/lib/setup';

export default function Index() {
  const [setupComplete] = useState(() => loadSettings().setupComplete);
  return setupComplete ? <Redirect href="/library" /> : <OnboardingScreen />;
}

function gameCountLabel(count: number) {
  if (count === 0) return 'No .gba files in this folder yet';
  return count === 1 ? '1 game found' : `${count} games found`;
}

function OnboardingScreen() {
  const [folder, setFolder] = useState<RomFolder | null>(() =>
    loadRomFolder(loadSettings().romFolderUri)
  );
  const [biosImported, setBiosImported] = useState(isBiosImported);
  const [busy, setBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [biosError, setBiosError] = useState<string | null>(null);

  async function pickFolder() {
    setBusy(true);
    setFolderError(null);
    try {
      setFolder(await chooseRomFolder());
    } catch (error) {
      // The picker rejects when cancelled, which isn't worth reporting.
      if (error instanceof Error && !/cancel/i.test(error.message)) {
        setFolderError('Could not open that folder. Try a different one.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function pickBios() {
    setBusy(true);
    setBiosError(null);
    try {
      if (await importBios()) setBiosImported(true);
    } catch (error) {
      setBiosError(error instanceof Error ? error.message : 'Could not import that file.');
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    await saveSettings({ setupComplete: true });
    router.replace('/library');
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <StatusBar style="light" />
      <ScrollView
        contentContainerClassName="grow px-6 pb-8 pt-5"
        showsVerticalScrollIndicator={false}>
        <View className="mb-8 min-h-[20px] flex-row items-center justify-between">
          <Text className="font-mono text-[12px] tracking-[1.4px] text-secondary">
            STEP {folder ? 2 : 1} OF 2
          </Text>
          {!folder && (
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              onPress={finishSetup}
              className="active:opacity-60">
              <Text className="font-inter-semibold text-[14px] text-secondary">Set up later</Text>
            </Pressable>
          )}
        </View>

        <View className="mb-3.5 flex-row items-center gap-3">
          <KrsIcon size={40} />
          <Text className="font-pixel text-[20px] leading-[28px] tracking-[2px] text-foreground">
            KRS-32
          </Text>
        </View>
        <Text
          className="mb-3.5 font-inter-bold text-[26px] leading-[32px] tracking-[-0.4px] text-foreground"
          accessibilityRole="header">
          Your games,{'\n'}pocket-sized.
        </Text>
        <Text className="mb-9 font-inter text-[16px] leading-[24px] text-secondary">
          Fast, accurate 32-bit handheld emulation with save states, cheats and controls you can
          rearrange.
        </Text>

        <View className="gap-3">
          <SetupCard step={1} title="Choose your ROM folder" active={!folder} done={!!folder}>
            {folder && (
              <View className="gap-1">
                <Text className="font-mono text-[14px] text-foreground" numberOfLines={1}>
                  {folder.name}
                </Text>
                <Text className="font-inter text-[13px] leading-[18px] text-secondary">
                  {gameCountLabel(folder.gameCount)}
                </Text>
              </View>
            )}
            <SetupButton
              label={folder ? 'Change folder' : 'Choose ROM folder'}
              variant={folder ? 'secondary' : 'primary'}
              disabled={busy}
              onPress={pickFolder}
            />
            {folderError && (
              <Text
                accessibilityLiveRegion="polite"
                className="font-inter text-[13px] leading-[18px] text-danger">
                {folderError}
              </Text>
            )}
            {!folder && (
              <Text className="font-inter text-[13px] leading-[18px] text-muted">
                KRS-32 doesn&apos;t include any games. You play the ROM files you own. Android
                won&apos;t let apps use the Download folder itself, so pick a folder inside it.
              </Text>
            )}
          </SetupCard>

          <SetupCard
            step={2}
            title="Import BIOS"
            active={!!folder && !biosImported}
            done={biosImported}
            optional={!biosImported}>
            <Text className="font-inter text-[14px] leading-[20px] text-secondary">
              {biosImported
                ? 'BIOS imported. KRS-32 will use it for your games.'
                : 'A BIOS file you dumped yourself improves compatibility. The built-in open BIOS works for most games.'}
            </Text>
            <SetupButton
              label={biosImported ? 'Replace BIOS file' : 'Import BIOS file'}
              variant="secondary"
              disabled={busy}
              onPress={pickBios}
            />
            {biosError && (
              <Text
                accessibilityLiveRegion="polite"
                className="font-inter text-[13px] leading-[18px] text-danger">
                {biosError}
              </Text>
            )}
            <Text className="font-mono text-[12px] leading-[16px] text-muted">
              Expected: gba_bios.bin · 16 KB
            </Text>
          </SetupCard>

          {folder && (
            <SetupButton label="Continue" disabled={busy} onPress={finishSetup} />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
