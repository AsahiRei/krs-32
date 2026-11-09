import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Check from 'lucide-react-native/icons/check';
import ChevronsLeftRight from 'lucide-react-native/icons/chevrons-left-right';
import { useEffect, useState } from 'react';
import {
  Image,
  PanResponder,
  PixelRatio,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { SegmentedControl } from '@/components/SegmentedControl';
import { Slider } from '@/components/Slider';
import { useLatest } from '@/components/useLatest';
import { palette } from '@/constants/palette';
import { getPlayRequest } from '@/lib/library';
import { getRomSaveId, readThumbnailUri } from '@/lib/saveStates';
import { loadSettings, saveSettings } from '@/lib/setup';
import {
  applyVideoSettings,
  ASPECT_OPTIONS,
  FILTER_OPTIONS,
  filterLabel,
  SCALING_OPTIONS,
  type VideoFilter,
  type VideoSettings,
} from '@/lib/video';
import KrsEmulator from '@/modules/krs-emulator';

const SIDE_PADDING = 24;
const GAME_WIDTH = 240;
const GAME_HEIGHT = 160;
const SHARP_THUMBNAIL = 'filter-sharp';
const SMOOTH_THUMBNAIL = 'filter-smooth';
const SHARP_SCALE = 4;
// The player's portrait picture area, in its 412-unit-wide design.
const PLAYER_DESIGN_WIDTH = 412;
const PLAYER_DESIGN_HEIGHT = 772;
const PLAYER_PICTURE_WIDTH = 366;
const CARD_GAP = 12;
const CARD_CELL_MIN = 3;

type PreviewImages = { sharp: string | null; smooth: string | null };

function FilterOverlay({
  id,
  filter,
  strength,
  cell,
}: {
  id: string;
  filter: VideoFilter;
  strength: number;
  cell: number;
}) {
  if (filter !== 'lcd' && filter !== 'scanlines') return null;
  const thickness = filter === 'lcd' ? cell / 4 : cell / 2;

  return (
    <Svg pointerEvents="none" style={{ position: 'absolute', width: '100%', height: '100%' }}>
      <Defs>
        <Pattern id={id} width={cell} height={cell} patternUnits="userSpaceOnUse">
          <Line
            x1={0}
            y1={cell - thickness / 2}
            x2={cell}
            y2={cell - thickness / 2}
            stroke="black"
            strokeWidth={thickness}
            opacity={strength}
          />
          {filter === 'lcd' && (
            <Line
              x1={cell - thickness / 2}
              y1={0}
              x2={cell - thickness / 2}
              y2={cell}
              stroke="black"
              strokeWidth={thickness}
              opacity={strength}
            />
          )}
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

function FilteredPicture({
  id,
  images,
  filter,
  strength,
  width,
  height,
  cell,
}: {
  id: string;
  images: PreviewImages;
  filter: VideoFilter;
  strength: number;
  width: number;
  height: number;
  cell: number;
}) {
  const uri = filter === 'smooth' ? images.smooth : images.sharp;
  return (
    <View style={{ width, height }} className="bg-control">
      {uri ? <Image source={{ uri }} style={{ width, height }} resizeMode="stretch" /> : null}
      <FilterOverlay id={id} filter={filter} strength={strength} cell={cell} />
    </View>
  );
}

function PictureLabel({ side, children }: { side: 'left' | 'right'; children: string }) {
  return (
    <View
      pointerEvents="none"
      className="absolute bottom-2 rounded-md bg-background/85 px-2 py-1"
      style={{ [side]: 8 }}>
      <Text className="font-mono text-[12px] text-foreground">{children}</Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="font-mono-medium text-[12px] tracking-[1.4px] text-secondary">{children}</Text>
  );
}

export default function ScreenFilterScreen() {
  const { inGame } = useLocalSearchParams<{ inGame?: string }>();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [video, setVideo] = useState<VideoSettings>(() => loadSettings().video);
  const [images, setImages] = useState<PreviewImages>({ sharp: null, smooth: null });
  const [split, setSplit] = useState(0.5);
  const [failed, setFailed] = useState(false);

  const pictureWidth = screenWidth - SIDE_PADDING * 2;
  const pictureHeight = (pictureWidth * GAME_HEIGHT) / GAME_WIDTH;
  const cardWidth = (pictureWidth - CARD_GAP) / 2;
  const cardPictureHeight = (cardWidth * 3) / 8;

  const latest = useLatest({ pictureWidth, split, setSplit });
  const [dragStart] = useState(() => new DragStart());
  const [dividerHandlers] = useState(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.split = latest.get().split;
        },
        onPanResponderMove: (_, { dx }) => {
          const current = latest.get();
          current.setSplit(
            Math.min(1, Math.max(0, dragStart.split + dx / current.pictureWidth))
          );
        },
      }).panHandlers
  );

  useEffect(() => {
    const game = getPlayRequest()?.game;
    if (inGame !== '1' || !game) return;
    let active = true;
    (async () => {
      const saveId = await getRomSaveId(game.uri);
      await KrsEmulator.captureThumbnail(SHARP_THUMBNAIL, SHARP_SCALE);
      await KrsEmulator.captureThumbnail(SMOOTH_THUMBNAIL, 1);
      if (active) {
        setImages({
          sharp: readThumbnailUri(saveId, SHARP_THUMBNAIL),
          smooth: readThumbnailUri(saveId, SMOOTH_THUMBNAIL),
        });
      }
    })().catch(() => {
      // Without a picture the previews still show the filter patterns on a plain backdrop.
    });
    return () => {
      active = false;
    };
  }, [inGame]);

  function update(changes: Partial<VideoSettings>) {
    const next = { ...video, ...changes };
    setVideo(next);
    setFailed(false);
    applyVideoSettings(next).catch(() => setFailed(true));
    saveSettings({ video: next }).catch(() => setFailed(true));
  }

  const hasStrength = video.filter === 'lcd' || video.filter === 'scanlines';

  // What the Player's portrait picture area works out to on this phone.
  const playerScale = Math.min(
    screenWidth / PLAYER_DESIGN_WIDTH,
    screenHeight / PLAYER_DESIGN_HEIGHT
  );
  const areaPixels = PLAYER_PICTURE_WIDTH * playerScale * PixelRatio.get();
  const exactScale = areaPixels / GAME_WIDTH;
  const scale = video.scaling === 'integer' ? Math.max(1, Math.floor(exactScale)) : exactScale;
  const scaleLabel = `${Number(scale.toFixed(1))}× · ${Math.round(GAME_WIDTH * scale)}×${Math.round(
    GAME_HEIGHT * scale
  )} px`;

  // The grid lines up with game pixels at the size the picture is drawn here.
  const pictureCell = pictureWidth / GAME_WIDTH;
  const dividerLeft = split * pictureWidth;

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
          className="flex-1 font-inter-bold text-[20px] leading-[26px] text-foreground"
          accessibilityRole="header">
          Screen filter
        </Text>
        <Text className="pr-3 font-mono text-[12px] text-secondary">applies live</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SIDE_PADDING, paddingBottom: 24, gap: 16 }}>
        <View
          className="overflow-hidden rounded-xl"
          style={{ width: pictureWidth, height: pictureHeight }}>
          <FilteredPicture
            id="before"
            images={images}
            filter="original"
            strength={0}
            width={pictureWidth}
            height={pictureHeight}
            cell={pictureCell}
          />
          <View
            className="absolute inset-y-0 right-0 overflow-hidden"
            style={{ left: dividerLeft }}>
            <View className="absolute inset-y-0" style={{ left: -dividerLeft, width: pictureWidth }}>
              <FilteredPicture
                id="after"
                images={images}
                filter={video.filter}
                strength={video.strength}
                width={pictureWidth}
                height={pictureHeight}
                cell={pictureCell}
              />
            </View>
          </View>
          <PictureLabel side="left">BEFORE · Original</PictureLabel>
          <PictureLabel side="right">{`AFTER · ${filterLabel(video.filter)}`}</PictureLabel>

          <View
            {...dividerHandlers}
            accessibilityLabel="Before and after divider"
            className="absolute inset-y-0 w-12 items-center justify-center"
            style={{ left: dividerLeft - 24 }}>
            <View pointerEvents="none" className="absolute inset-y-0 w-0.5 bg-foreground" />
            <View
              pointerEvents="none"
              className="h-11 w-11 items-center justify-center rounded-full bg-foreground">
              <ChevronsLeftRight size={20} color={palette.background} />
            </View>
          </View>
        </View>

        <View className="flex-row flex-wrap" style={{ gap: CARD_GAP }}>
          {FILTER_OPTIONS.map((option) => {
            const selected = option.value === video.filter;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                onPress={() => update({ filter: option.value })}
                style={{ width: cardWidth }}
                className={`overflow-hidden rounded-2xl border bg-card ${
                  selected ? 'border-accent' : 'border-card-border'
                }`}>
                <FilteredPicture
                  id={`card-${option.value}`}
                  images={images}
                  filter={option.value}
                  strength={Math.max(video.strength, 0.4)}
                  width={cardWidth}
                  height={cardPictureHeight}
                  cell={Math.max(CARD_CELL_MIN, cardWidth / GAME_WIDTH)}
                />
                <View className="h-11 flex-row items-center justify-between px-3">
                  <Text className="font-inter-semibold text-[14px] text-foreground">
                    {option.label}
                  </Text>
                  {selected && (
                    <View className="flex-row items-center gap-1">
                      <Check size={14} color={palette.accent.DEFAULT} />
                      <Text className="font-inter-semibold text-[13px] text-accent">On</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        {hasStrength && (
          <View className="flex-row items-center gap-3">
            <Text className="font-inter-semibold text-[14px] text-foreground">
              {video.filter === 'lcd' ? 'Grid strength' : 'Line strength'}
            </Text>
            <Slider
              label="Filter strength"
              value={video.strength}
              min={0.1}
              max={1}
              step={0.05}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onChange={(strength) => update({ strength })}
            />
            <Text className="w-11 text-right font-mono text-[13px] text-foreground">
              {Math.round(video.strength * 100)}%
            </Text>
          </View>
        )}

        <View className="gap-2">
          <SectionLabel>ASPECT RATIO</SectionLabel>
          <SegmentedControl
            options={ASPECT_OPTIONS}
            value={video.aspect}
            onChange={(aspect) => update({ aspect })}
          />
        </View>

        {video.aspect !== 'stretch' && (
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <SectionLabel>SCALING</SectionLabel>
              <Text className="font-mono text-[12px] text-secondary">{scaleLabel}</Text>
            </View>
            <SegmentedControl
              options={SCALING_OPTIONS}
              value={video.scaling}
              onChange={(scaling) => update({ scaling })}
            />
            <Text className="font-inter text-[13px] leading-[18px] text-muted">
              Integer keeps every pixel the same size. Fit fills more of the screen but pixels may
              look uneven.
            </Text>
          </View>
        )}

        {failed && (
          <Text
            accessibilityLiveRegion="polite"
            className="font-inter text-[13px] leading-[18px] text-danger">
            Couldn’t save your screen settings. Try again.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

class DragStart {
  split = 0.5;
}
