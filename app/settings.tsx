import Constants from 'expo-constants';
import { Directory, Paths } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Check from 'lucide-react-native/icons/check';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { type ReactNode, useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Toggle } from '@/components/Toggle';
import { palette } from '@/constants/palette';
import { loadControlLayout } from '@/lib/controlLayout';
import {
  BIOS_FILE_NAME,
  chooseRomFolder,
  DS_SYSTEM_FILES,
  dsSystemFilesFound,
  formatFolderPath,
  importBios,
  importDsSystemFiles,
  isBiosImported,
  listRomFiles,
  loadSettings,
  saveSettings,
} from '@/lib/setup';
import { filterLabel } from '@/lib/video';
import KrsEmulator from '@/modules/krs-emulator';

const BYTES_PER_MB = 1024 * 1024;

type StorageUse = { roms: number; saves: number; cache: number };

function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-2xl border border-card-border bg-card">{children}</View>
  );
}

function SettingsRow({
  title,
  accessibilityLabel,
  onPress,
  children,
}: {
  title: string;
  accessibilityLabel?: string;
  onPress?: () => void;
  children?: ReactNode;
}) {
  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      disabled={!onPress}
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-card-border p-3.5 active:bg-control-pressed">
      <View className="flex-1 gap-1">
        <Text className="font-inter-semibold text-[16px] text-foreground">{title}</Text>
        {children}
      </View>
      {onPress && <ChevronRight size={18} color={palette.secondary} />}
    </Pressable>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return <Text className="font-inter text-[13px] leading-[18px] text-secondary">{children}</Text>;
}

const directorySize = (directory: Directory) =>
  directory.exists ? (directory.size ?? 0) : 0;

const toMb = (bytes: number) => `${Math.round(bytes / BYTES_PER_MB)} MB`;

export default function SettingsScreen() {
  const [settings, setSettings] = useState(loadSettings);
  const [controllers, setControllers] = useState(() => KrsEmulator.getControllers());
  const [biosFound, setBiosFound] = useState(isBiosImported);
  const [dsFilesFound, setDsFilesFound] = useState(dsSystemFilesFound);
  const [storage, setStorage] = useState<StorageUse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setSettings(loadSettings());
      setControllers(KrsEmulator.getControllers());
      // They may have been imported from the Library's banner since this screen last showed.
      setDsFilesFound(dsSystemFilesFound());
      // Adding up file sizes blocks the JS thread, so let the screen paint first.
      const timer = setTimeout(() => {
        const current = loadSettings();
        let roms = 0;
        try {
          if (current.romFolderUri) {
            roms = listRomFiles(new Directory(current.romFolderUri)).reduce(
              (total, { file }) => total + (file.size ?? 0),
              0
            );
          }
        } catch {
          // A lost folder shows as 0 MB here; the Library explains how to fix it.
        }
        setStorage({
          roms,
          saves:
            directorySize(new Directory(Paths.document, 'saves')) +
            directorySize(new Directory(Paths.document, 'states')),
          cache: directorySize(Paths.cache),
        });
      }, 0);
      return () => clearTimeout(timer);
    }, [])
  );

  async function changeFolder() {
    try {
      await chooseRomFolder();
      setSettings(loadSettings());
      setNotice(null);
    } catch {
      // The picker rejects when cancelled; nothing changed.
    }
  }

  async function replaceBios() {
    try {
      if (await importBios()) {
        setBiosFound(true);
        setNotice(null);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not import that file.');
    }
  }

  async function importDsFiles() {
    try {
      if (await importDsSystemFiles()) {
        setDsFilesFound(dsSystemFilesFound());
        setNotice(null);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not import those files.');
    }
  }

  function toggleAutoHide() {
    const autoHideControls = !settings.autoHideControls;
    setSettings({ ...settings, autoHideControls });
    saveSettings({ autoHideControls }).catch(() => setSettings(loadSettings()));
  }

  const missingDsFiles = DS_SYSTEM_FILES.filter((name) => !dsFilesFound.includes(name));
  const { video, romFolderUri } = settings;
  const portraitOpacity = Math.round(loadControlLayout().portrait.opacity * 100);
  const totalStorage = storage ? storage.roms + storage.saves + storage.cache : 0;
  const scalingLabel = video.scaling === 'integer' ? 'integer scaling' : 'fit to screen';
  const storageShare = (bytes: number) => (totalStorage > 0 ? bytes / totalStorage : 0);

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
          className="font-inter-bold text-[22px] leading-[28px] text-foreground"
          accessibilityRole="header">
          Settings
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-4 px-4 pb-6">
        <SettingsGroup>
          <SettingsRow title="Video" onPress={() => router.push('/screen-filter')}>
            <Detail>
              {filterLabel(video.filter)} · {scalingLabel}
            </Detail>
          </SettingsRow>
          <SettingsRow title="Audio">
            <Detail>Mutes during fast-forward</Detail>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow title="Controls" onPress={() => router.push('/control-editor')}>
            <Detail>Edit layouts · opacity {portraitOpacity}%</Detail>
          </SettingsRow>
          <SettingsRow
            title="Bluetooth controller mapping"
            onPress={() => router.push('/controller-mapping')}>
            {controllers.length > 0 ? (
              <View className="flex-row items-center gap-1.5">
                <View className="h-2 w-2 rounded-full bg-success" />
                <Detail>
                  {controllers.length} connected · {controllers[0].name}
                </Detail>
              </View>
            ) : (
              <Detail>No controller connected</Detail>
            )}
          </SettingsRow>
          <View className="flex-row items-center gap-3 border-b border-card-border p-3.5">
            <View className="flex-1 gap-1">
              <Text className="font-inter-semibold text-[16px] text-foreground">
                Hide touch controls with a controller
              </Text>
              <Detail>DS games give the screens the whole display</Detail>
            </View>
            <Toggle
              label="Hide touch controls with a controller"
              value={settings.autoHideControls}
              onChange={toggleAutoHide}
            />
          </View>
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow title="Saves & backup">
            <Detail>Auto-save on quit</Detail>
          </SettingsRow>
          <SettingsRow
            title="Storage"
            accessibilityLabel="Storage. Change ROM folder"
            onPress={changeFolder}>
            <Text className="font-mono text-[12px] text-secondary" numberOfLines={1}>
              {romFolderUri ? formatFolderPath(romFolderUri) : 'No ROM folder chosen'}
            </Text>
            {storage && totalStorage > 0 && (
              <View className="my-1 h-1.5 flex-row overflow-hidden rounded-full bg-control-border">
                <View className="bg-foreground" style={{ flex: storageShare(storage.roms) }} />
                <View className="bg-accent" style={{ flex: storageShare(storage.saves) }} />
                <View className="bg-muted" style={{ flex: storageShare(storage.cache) }} />
              </View>
            )}
            {storage && (
              <Text className="font-mono text-[12px] leading-[16px] text-secondary">
                ROMs {toMb(storage.roms)} · saves {toMb(storage.saves)} · cache{' '}
                {toMb(storage.cache)}
              </Text>
            )}
          </SettingsRow>
          <SettingsRow
            title="BIOS"
            accessibilityLabel={biosFound ? 'BIOS, found. Replace' : 'BIOS, not imported. Import'}
            onPress={replaceBios}>
            {biosFound ? (
              <View className="flex-row items-center gap-1.5">
                <Check size={15} color={palette.success} />
                <Text className="font-mono text-[12px] text-secondary">
                  Found · {BIOS_FILE_NAME}
                </Text>
              </View>
            ) : (
              <Detail>Not imported · using the built-in open BIOS</Detail>
            )}
          </SettingsRow>
          <SettingsRow
            title="DS BIOS & firmware"
            accessibilityLabel={
              missingDsFiles.length
                ? `DS BIOS and firmware, ${missingDsFiles.length} missing. Import`
                : 'DS BIOS and firmware, found. Replace'
            }
            onPress={importDsFiles}>
            {missingDsFiles.length === 0 ? (
              <View className="flex-row items-center gap-1.5">
                <Check size={15} color={palette.success} />
                <Text className="font-mono text-[12px] text-secondary">
                  Found · {DS_SYSTEM_FILES.join(', ')}
                </Text>
              </View>
            ) : (
              <Detail>
                {dsFilesFound.length === 0
                  ? 'Not imported · using built-in firmware'
                  : `Missing ${missingDsFiles.join(', ')} · using built-in firmware`}
              </Detail>
            )}
          </SettingsRow>
        </SettingsGroup>

        {notice && (
          <Text
            accessibilityLiveRegion="polite"
            className="font-inter text-[13px] leading-[18px] text-danger">
            {notice}
          </Text>
        )}

        <SettingsGroup>
          <SettingsRow title="About">
            <Detail>Version {Constants.expoConfig?.version}</Detail>
          </SettingsRow>
        </SettingsGroup>

        <View className="items-center gap-1 pt-2">
          <Text className="font-pixel text-[10px] leading-[16px] tracking-[1.5px] text-secondary">
            KRS-32
          </Text>
          <Text className="font-inter text-[13px] text-secondary">
            No games included. Play only ROMs you own.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
