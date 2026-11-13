import Star from 'lucide-react-native/icons/star';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { coverUri } from '@/lib/covers';
import { coverInitials, type Game } from '@/lib/library';
import { SYSTEMS } from '@/lib/systems';

type GameCoverProps = {
  game: Game;
  width: number;
  height: number;
  showDetails?: boolean;
};

const LARGE_COVER_WIDTH = 80;

export function GameCover({ game, width, height, showDetails = false }: GameCoverProps) {
  const large = width >= LARGE_COVER_WIDTH;
  const [unreadableFile, setUnreadableFile] = useState<string | null>(null);
  const coverFile = game.coverFile && game.coverFile !== unreadableFile ? game.coverFile : null;

  return (
    <View
      style={{ width, height }}
      className={`items-center justify-center gap-2 overflow-hidden rounded-xl bg-card ${
        coverFile ? '' : 'border border-dashed border-control-border'
      }`}>
      {coverFile ? (
        <Image
          source={{ uri: coverUri(coverFile) }}
          style={{ width, height }}
          resizeMode="cover"
          // Photos can be far larger than a cover; decoding them smaller keeps the grid smooth.
          resizeMethod="resize"
          onError={() => setUnreadableFile(coverFile)}
        />
      ) : (
        <>
          <Text
            className="font-pixel text-foreground"
            style={{ fontSize: large ? 18 : 11, lineHeight: large ? 24 : 16 }}>
            {coverInitials(game.title)}
          </Text>
          {showDetails && <Text className="font-mono text-[11px] text-muted">no cover</Text>}
        </>
      )}
      {/* GBA is the default, so only DS games are marked. */}
      {showDetails && game.system === 'nds' && (
        <View
          accessibilityLabel={`${SYSTEMS.nds.label} game`}
          className="absolute bottom-2 left-2 flex-row items-center gap-1.5 rounded-md bg-background/90 px-1.5 py-1">
          <View className="gap-[2px]">
            <View className="h-[4px] w-[7px] rounded-[1px] bg-accent" />
            <View className="h-[4px] w-[7px] rounded-[1px] border border-accent" />
          </View>
          <Text className="font-mono-medium text-[10px] tracking-[1px] text-foreground">
            {SYSTEMS.nds.label}
          </Text>
        </View>
      )}
      {showDetails && game.favorite && (
        <View className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full bg-background">
          <Star
            size={14}
            color={palette.accent.DEFAULT}
            fill={palette.accent.DEFAULT}
            strokeWidth={2}
          />
        </View>
      )}
    </View>
  );
}
