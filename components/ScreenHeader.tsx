import { router } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-3 px-4 pb-4 pt-5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        className="h-12 w-12 items-center justify-center rounded-[14px] active:bg-control-pressed">
        <ArrowLeft size={22} color={palette.secondary} />
      </Pressable>
      <View className="flex-1 gap-0.5">
        <Text
          className="font-inter-bold text-[20px] leading-[26px] text-foreground"
          accessibilityRole="header"
          numberOfLines={1}>
          {title}
        </Text>
        <Text
          className="font-mono text-[13px] text-secondary"
          numberOfLines={1}
          ellipsizeMode="middle">
          {subtitle}
        </Text>
      </View>
      {action}
    </View>
  );
}
