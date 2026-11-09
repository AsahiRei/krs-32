import Star from 'lucide-react-native/icons/star';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { coverUri } from '@/lib/covers';
import { coverInitials, type Game } from '@/lib/library';

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
