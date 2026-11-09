import Check from 'lucide-react-native/icons/check';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/palette';

type SetupCardProps = {
  step: number;
  title: string;
  active?: boolean;
  done?: boolean;
  optional?: boolean;
  children: ReactNode;
};

export function SetupCard({
  step,
  title,
  active = false,
  done = false,
  optional = false,
  children,
}: SetupCardProps) {
  return (
    <View className="gap-3 rounded-[18px] border border-card-border bg-card p-4">
      <View className="flex-row items-center gap-3">
        <View
          className={`h-7 w-7 items-center justify-center rounded-lg ${
            active || done ? 'bg-accent' : 'border border-control-border'
          }`}>
          {done ? (
            <Check size={16} color={palette.accent.on} strokeWidth={3} />
          ) : (
            <Text
              className={`font-mono-medium text-[13px] ${active ? 'text-accent-on' : 'text-foreground'}`}>
              {step}
            </Text>
          )}
        </View>
        <Text
          className="flex-1 font-inter-semibold text-[17px] text-foreground"
          accessibilityRole="header">
          {title}
        </Text>
        {optional && (
          <View className="rounded-lg border border-control-border px-[9px] py-1">
            <Text className="font-mono-medium text-[11px] tracking-[1.3px] text-secondary">
              OPTIONAL
            </Text>
          </View>
        )}
      </View>
      {children}
    </View>
  );
}

type SetupButtonProps = {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  onPress?: () => void;
};

const BUTTON_SURFACE = {
  primary: 'bg-accent active:bg-accent-pressed',
  secondary: 'border border-control-border bg-control active:bg-control-pressed',
  danger: 'bg-danger active:opacity-80',
};

export function SetupButton({
  label,
  variant = 'primary',
  disabled = false,
  onPress,
}: SetupButtonProps) {
  const filled = variant !== 'secondary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[52px] items-center justify-center rounded-[14px] px-4 ${
        disabled ? 'opacity-50' : ''
      } ${BUTTON_SURFACE[variant]}`}>
      <Text
        className={`font-inter-semibold text-[16px] ${filled ? 'text-accent-on' : 'text-foreground'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
