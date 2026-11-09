import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import X from 'lucide-react-native/icons/x';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SetupButton } from '@/components/SetupCard';
import { palette } from '@/constants/palette';
import {
  CHEAT_TYPES,
  type CheatType,
  codeLines,
  findCodeIssue,
  formatCode,
  loadCheats,
  newCheatId,
  saveCheats,
} from '@/lib/cheats';

const CODE_LINE_HEIGHT = 26;
const CODE_PADDING_Y = 12;

function fieldLabel(text: string) {
  return <Text className="font-inter-semibold text-[15px] text-foreground">{text}</Text>;
}

export default function CheatEditScreen() {
  const { saveId, cheatId } = useLocalSearchParams<{ saveId: string; cheatId?: string }>();
  const [existing] = useState(() =>
    cheatId ? loadCheats(saveId).find((cheat) => cheat.id === cheatId) : undefined
  );
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<CheatType>(existing?.type ?? 'raw');
  const [code, setCode] = useState(existing?.code ?? '');
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const issue = findCodeIssue(code, type, codeFocused);
  const lineCount = codeLines(code).length;
  const typeLabel = CHEAT_TYPES.find((option) => option.type === type)?.label;
  const otherTypes = CHEAT_TYPES.filter((option) => option.type !== type)
    .map((option) => option.label)
    .join(', ');
  const canSave = !!name.trim() && lineCount > 0 && !findCodeIssue(code, type, false) && !saving;
  const lines = code.split('\n');

  async function save() {
    setSaving(true);
    setFailed(false);
    const cheat = {
      id: existing?.id ?? newCheatId(),
      name: name.trim(),
      type,
      code: formatCode(code),
      enabled: existing?.enabled ?? true,
    };
    const cheats = loadCheats(saveId);
    try {
      await saveCheats(
        saveId,
        existing ? cheats.map((item) => (item.id === cheat.id ? cheat : item)) : [...cheats, cheat]
      );
      router.back();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <View className="flex-row items-center gap-3 px-3 pb-3 pt-5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center rounded-[14px] active:bg-control-pressed">
            <X size={22} color={palette.secondary} />
          </Pressable>
          <Text
            className="font-inter-bold text-[20px] leading-[26px] text-foreground"
            accessibilityRole="header">
            {existing ? 'Edit cheat' : 'Add cheat'}
          </Text>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="gap-5 px-5 pb-6">
          <View className="gap-2">
            {fieldLabel('Name')}
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Infinite health"
              placeholderTextColor={palette.muted}
              accessibilityLabel="Cheat name"
              className="h-[52px] rounded-[14px] border border-control-border bg-card px-4 font-inter text-[16px] text-foreground"
            />
          </View>

          <View className="gap-2">
            {fieldLabel('Code type')}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Code type, ${typeLabel}`}
              accessibilityState={{ expanded: typeMenuOpen }}
              onPress={() => setTypeMenuOpen(!typeMenuOpen)}
              className="h-[52px] flex-row items-center justify-between rounded-[14px] border border-control-border bg-card px-4 active:bg-control-pressed">
              <Text className="font-mono text-[15px] text-foreground">{typeLabel}</Text>
              <ChevronDown size={20} color={palette.secondary} />
            </Pressable>
            {typeMenuOpen ? (
              <View className="overflow-hidden rounded-[14px] border border-control-border bg-card">
                {CHEAT_TYPES.map((option) => (
                  <Pressable
                    key={option.type}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.type === type }}
                    onPress={() => {
                      setType(option.type);
                      setTypeMenuOpen(false);
                    }}
                    className="h-12 flex-row items-center justify-between px-4 active:bg-control-pressed">
                    <Text className="font-mono text-[14px] text-foreground">{option.label}</Text>
                    {option.type === type && <Check size={17} color={palette.accent.DEFAULT} />}
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text className="font-inter text-[13px] leading-[18px] text-muted">
                Other options: {otherTypes}
              </Text>
            )}
          </View>

          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              {fieldLabel('Code')}
              <Text className="font-mono text-[12px] text-secondary">
                {lineCount} {lineCount === 1 ? 'line' : 'lines'}
              </Text>
            </View>

            <View
              className={`overflow-hidden rounded-[14px] border bg-card ${
                issue ? 'border-danger' : 'border-control-border'
              }`}
              style={{ minHeight: CODE_LINE_HEIGHT * 3 + CODE_PADDING_Y * 2 }}>
              {issue && (
                <View
                  className="absolute inset-x-0 bg-danger/15"
                  style={{
                    top: CODE_PADDING_Y + issue.line * CODE_LINE_HEIGHT,
                    height: CODE_LINE_HEIGHT,
                  }}
                />
              )}
              <View className="flex-row px-3" style={{ paddingVertical: CODE_PADDING_Y }}>
                <View className="w-7">
                  {lines.map((_, index) => (
                    <Text
                      key={index}
                      className={`font-mono text-[15px] ${
                        issue?.line === index ? 'text-danger' : 'text-muted'
                      }`}
                      style={{ lineHeight: CODE_LINE_HEIGHT }}>
                      {index + 1}
                    </Text>
                  ))}
                </View>
                <TextInput
                  multiline
                  scrollEnabled={false}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  spellCheck={false}
                  accessibilityLabel="Cheat code"
                  placeholder="0300 1A2C 0000 0063"
                  placeholderTextColor={palette.muted}
                  cursorColor={palette.accent.DEFAULT}
                  onChangeText={setCode}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  textAlignVertical="top"
                  className="flex-1 p-0 font-mono text-[15px] text-foreground"
                  style={{ lineHeight: CODE_LINE_HEIGHT, minHeight: CODE_LINE_HEIGHT * 3 }}>
                  {issue?.column != null ? (
                    <Text>
                      {lines.slice(0, issue.line).map((line) => `${line}\n`).join('')}
                      {lines[issue.line].slice(0, issue.column)}
                      <Text className="text-danger underline">{lines[issue.line][issue.column]}</Text>
                      {lines[issue.line].slice(issue.column + 1)}
                      {lines.slice(issue.line + 1).map((line) => `\n${line}`).join('')}
                    </Text>
                  ) : (
                    <Text>{code}</Text>
                  )}
                </TextInput>
              </View>
            </View>

            {issue && (
              <View accessibilityLiveRegion="polite" className="flex-row gap-2">
                <CircleAlert size={18} color={palette.danger} />
                <Text className="flex-1 font-inter text-[14px] leading-[20px] text-danger">
                  <Text className="font-inter-bold">Line {issue.line + 1} isn’t valid. </Text>
                  {issue.message}
                </Text>
              </View>
            )}
            <Text className="font-inter text-[13px] leading-[18px] text-muted">
              {type === 'auto'
                ? 'One code per line: 12 or 16 hex digits. Spaces are ignored.'
                : 'One code per line: 8-digit address, space, 8-digit value. Spaces inside a group are ignored.'}
            </Text>
            {failed && (
              <Text
                accessibilityLiveRegion="polite"
                className="font-inter text-[13px] leading-[18px] text-danger">
                Couldn’t save this cheat. Try again.
              </Text>
            )}
          </View>
        </ScrollView>

        <View className="flex-row gap-3 px-5 pb-4 pt-2">
          <View className="flex-1">
            <SetupButton label="Cancel" variant="secondary" onPress={() => router.back()} />
          </View>
          <View className="flex-1">
            <SetupButton label="Save cheat" disabled={!canSave} onPress={save} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
