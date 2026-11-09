import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import ArrowDownUp from 'lucide-react-native/icons/arrow-down-up';
import LayoutGrid from 'lucide-react-native/icons/layout-grid';
import List from 'lucide-react-native/icons/list';
import Search from 'lucide-react-native/icons/search';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Star from 'lucide-react-native/icons/star';
import X from 'lucide-react-native/icons/x';
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GameCover } from '@/components/GameCover';
import { GameGridCard } from '@/components/GameGridCard';
import { GameSheet } from '@/components/GameSheet';
import { KrsIcon } from '@/components/KrsIcon';
import { LibraryEmptyState } from '@/components/LibraryEmptyState';
import { ScanningView } from '@/components/ScanningView';
import { SortMenu } from '@/components/SortMenu';
import { palette } from '@/constants/palette';
import {
  deleteRom,
  EMPTY_SCAN,
  formatClock,
  formatPlayedAgo,
  formatPlayTime,
  type Game,
  loadGameMeta,
  requestPlay,
  type Rom,
  saveGameMeta,
  type ScanProgress,
  scanRoms,
  SORT_OPTIONS,
  type SortMode,
  sortGames,
  subscribeGameMeta,
} from '@/lib/library';
import { deleteCoverFile } from '@/lib/covers';
import { AUTO_STATE } from '@/lib/saveStates';
import { chooseRomFolder, formatFolderPath, formatRomPath, loadSettings } from '@/lib/setup';

const SIDE_PADDING = 24;
const COLUMN_GAP = 12;
const COLUMNS = 3;
const RECENT_LIMIT = 8;
// Below this width the filter and view controls no longer fit on one row with full labels.
const COMPACT_WIDTH = 400;
const SORT_MENU_GAP = 8;
const NO_GAMES_BODY =
  "KRS-32 plays the ROM files you own. Pick the folder that holds them and we'll build your library.";

type Status = 'scanning' | 'ready' | 'noFolder' | 'unreadable';
type Filter = 'all' | 'favorites';
type Layout = 'grid' | 'list';
type Icon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

function IconButton({
  icon: IconGlyph,
  label,
  active = false,
  onPress,
}: {
  icon: Icon;
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`h-12 w-12 items-center justify-center rounded-[14px] border active:bg-control-pressed ${
        active ? 'border-accent' : 'border-control-border'
      }`}>
      <IconGlyph
        size={20}
        color={active ? palette.accent.DEFAULT : palette.foreground}
        strokeWidth={2}
      />
    </Pressable>
  );
}

function FilterChip({
  label,
  count,
  selected,
  icon: IconGlyph,
  hideLabel = false,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  icon?: Icon;
  hideLabel?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`h-12 flex-row items-center gap-2 rounded-[14px] px-3.5 ${
        selected ? 'bg-foreground' : 'border border-control-border active:bg-control-pressed'
      }`}>
      {IconGlyph && <IconGlyph size={15} color={selected ? palette.background : palette.foreground} />}
      {!hideLabel && (
        <Text
          className={`font-inter-semibold text-[14px] ${selected ? 'text-background' : 'text-foreground'}`}>
          {label}
        </Text>
      )}
      {selected && <Text className="font-mono text-[12px] text-background">{count}</Text>}
    </Pressable>
  );
}

function LayoutOption({
  icon: IconGlyph,
  label,
  selected,
  onPress,
}: {
  icon: Icon;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`h-[42px] w-11 items-center justify-center rounded-[11px] ${
        selected ? 'bg-foreground' : ''
      }`}>
      <IconGlyph size={19} color={selected ? palette.background : palette.foreground} />
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="font-mono-medium text-[12px] tracking-[1.4px] text-secondary">{children}</Text>
  );
}

function favoriteHint(game: Game) {
  return game.favorite ? 'Long press to remove from favorites' : 'Long press to add to favorites';
}

function RecentCard({
  game,
  onPress,
  onLongPress,
}: {
  game: Game;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const details = [
    formatPlayTime(game.playSeconds),
    game.lastAutoSaveAt ? `auto ${formatClock(game.lastAutoSaveAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={game.title}
      accessibilityHint={favoriteHint(game)}
      onPress={onPress}
      onLongPress={onLongPress}
      className="w-[276px] flex-row items-center gap-3 rounded-[18px] border border-card-border bg-card p-2.5">
      <GameCover game={game} width={66} height={88} />
      <View className="flex-1 gap-1">
        <Text className="font-inter-semibold text-[17px] text-foreground" numberOfLines={1}>
          {game.title}
        </Text>
        <Text className="font-inter text-[13px] text-secondary" numberOfLines={1}>
          {formatPlayedAgo(game.lastPlayedAt ?? 0)}
        </Text>
        <Text className="font-mono text-[12px] text-secondary" numberOfLines={1}>
          {details}
        </Text>
      </View>
    </Pressable>
  );
}

function GameListRow({
  game,
  onPress,
  onToggleFavorite,
}: {
  game: Game;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  const detail = game.playSeconds
    ? formatPlayTime(game.playSeconds)
    : game.coverFile
      ? 'not played'
      : 'no cover';

  return (
    <View className="mx-6 flex-row items-center gap-3 border-b border-card-border py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={game.title}
        accessibilityHint={favoriteHint(game)}
        onPress={onPress}
        onLongPress={onToggleFavorite}
        className="flex-1 flex-row items-center gap-3 active:opacity-70">
        <GameCover game={game} width={48} height={64} />
        <View className="flex-1 gap-1">
          <Text className="font-inter-semibold text-[16px] text-foreground" numberOfLines={1}>
            {game.title}
          </Text>
          <Text
            className="font-mono text-[12px] text-secondary"
            numberOfLines={1}
            ellipsizeMode="middle">
            {game.fileName} · {detail}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          game.favorite ? `Remove ${game.title} from favorites` : `Add ${game.title} to favorites`
        }
        accessibilityState={{ selected: !!game.favorite }}
        onPress={onToggleFavorite}
        className="h-12 w-12 items-center justify-center rounded-[14px] active:bg-control-pressed">
        <Star
          size={20}
          color={game.favorite ? palette.accent.DEFAULT : palette.foreground}
          fill={game.favorite ? palette.accent.DEFAULT : 'none'}
        />
      </Pressable>
    </View>
  );
}

export default function LibraryScreen() {
  const { width: screenWidth } = useWindowDimensions();
  const [status, setStatus] = useState<Status>('scanning');
  const [roms, setRoms] = useState<Rom[]>([]);
  const [meta, setMeta] = useState(loadGameMeta);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortMode>('lastPlayed');
  const [layout, setLayout] = useState<Layout>('grid');
  const [folderUri, setFolderUri] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const closeSortMenu = useCallback(() => setSortMenuOpen(false), []);
  const [scanProgress, setScanProgress] = useState<ScanProgress>(EMPTY_SCAN);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const closeGameSheet = useCallback(() => setSelectedGameId(null), []);
  const activeScan = useRef<AbortController | null>(null);

  const scan = useCallback(() => {
    activeScan.current?.abort();
    const controller = new AbortController();
    activeScan.current = controller;

    // Listing a large folder blocks the JS thread, so let the current frame paint first.
    setTimeout(async () => {
      if (controller.signal.aborted) return;
      const uri = loadSettings().romFolderUri;
      setFolderUri(uri);
      if (!uri) {
        setStatus('noFolder');
        return;
      }
      try {
        const found = await scanRoms(uri, controller.signal, setScanProgress);
        if (controller.signal.aborted) return;
        setRoms(found);
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('unreadable');
      }
    }, 0);
  }, []);

  useFocusEffect(
    useCallback(() => {
      scan();
      return () => activeScan.current?.abort();
    }, [scan])
  );

  // The Player records play time while this screen sits underneath it.
  useEffect(() => subscribeGameMeta(setMeta), []);

  const games = useMemo<Game[]>(
    () => roms.map((rom) => ({ ...rom, ...meta[rom.id] })),
    [roms, meta]
  );
  const selectedGame = games.find((game) => game.id === selectedGameId);
  const favoriteCount = useMemo(() => games.filter((game) => game.favorite).length, [games]);
  const recentGames = useMemo(
    () =>
      sortGames(
        games.filter((game) => game.lastPlayedAt),
        'lastPlayed'
      ).slice(0, RECENT_LIMIT),
    [games]
  );
  const search = query.trim();
  const visibleGames = useMemo(() => {
    const needle = search.toLowerCase();
    return sortGames(
      games.filter(
        (game) =>
          (filter === 'all' || game.favorite) &&
          (!needle ||
            game.title.toLowerCase().includes(needle) ||
            game.fileName.toLowerCase().includes(needle))
      ),
      sort
    );
  }, [games, search, filter, sort]);

  const cardWidth = (screenWidth - SIDE_PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS;

  function toggleFavorite(game: Game) {
    const next = { ...meta, [game.id]: { ...meta[game.id], favorite: !game.favorite } };
    setMeta(next);
    saveGameMeta(next).catch(() => setMeta(loadGameMeta()));
  }

  function rescan() {
    setScanProgress(EMPTY_SCAN);
    setStatus('scanning');
    scan();
  }

  function cancelScan() {
    activeScan.current?.abort();
    setRoms(scanProgress.found);
    setStatus('ready');
  }

  function openGameScreen(game: Game, pathname: '/save-states' | '/cheats') {
    setSelectedGameId(null);
    requestPlay({ game, startState: null });
    router.push(pathname);
  }

  function playGame(game: Game, resume: boolean) {
    setSelectedGameId(null);
    requestPlay({ game, startState: resume ? AUTO_STATE : null });
    router.push('/player');
  }

  async function deleteGame(game: Game, alsoDeleteSave: boolean) {
    await deleteRom(game, alsoDeleteSave);
    if (alsoDeleteSave) deleteCoverFile(game.coverFile);
    setRoms((current) => current.filter((rom) => rom.id !== game.id));
    setSelectedGameId(null);
    // Without a save to go with them, the favorite and play time have nothing left to restore.
    if (alsoDeleteSave) {
      const next = { ...meta };
      delete next[game.id];
      setMeta(next);
      saveGameMeta(next).catch(() => setMeta(loadGameMeta()));
    }
  }

  async function pickFolder() {
    try {
      await chooseRomFolder();
      rescan();
    } catch {
      // The picker rejects when cancelled; the current screen is still correct.
    }
  }

  const appHeader = (
    <View className="flex-row items-center justify-between px-6 pb-4 pt-5">
      <View className="flex-row items-center gap-2">
        <KrsIcon size={28} />
        <Text className="font-pixel text-[14px] leading-[20px] tracking-[2px] text-foreground">
          KRS-32
        </Text>
      </View>
      <IconButton
        icon={SlidersHorizontal}
        label="Settings"
        onPress={() => router.push('/settings')}
      />
    </View>
  );

  const sortOption = SORT_OPTIONS.find((option) => option.mode === sort);

  // Lives outside the list so the search field and sort menu stay put while scrolling.
  const toolbar = (
    <View
      className="gap-3 px-6"
      onLayout={(event) => setToolbarHeight(event.nativeEvent.layout.height)}>
      <View
        className={`h-12 flex-row items-center gap-2.5 rounded-[14px] border bg-card px-4 ${
          searchFocused || query ? 'border-accent' : 'border-control-border'
        }`}>
        <Search size={18} color={palette.secondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder={`Search ${games.length} ${games.length === 1 ? 'game' : 'games'}`}
          placeholderTextColor={palette.muted}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search games"
          className="flex-1 py-0 font-inter text-[15px] text-foreground"
        />
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={12}
            onPress={() => setQuery('')}
            className="active:opacity-60">
            <X size={18} color={palette.secondary} />
          </Pressable>
        )}
      </View>

      <View className="flex-row items-center gap-2">
        <FilterChip
          label="All"
          count={games.length}
          selected={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        <FilterChip
          label="Favorites"
          count={favoriteCount}
          icon={Star}
          hideLabel={screenWidth < COMPACT_WIDTH}
          selected={filter === 'favorites'}
          onPress={() => setFilter('favorites')}
        />
        <View className="flex-1" />
        <IconButton
          icon={ArrowDownUp}
          label={`Sort, ${sortOption?.label}`}
          active={sortMenuOpen}
          onPress={() => {
            // The keyboard would cover the lower options on shorter screens.
            Keyboard.dismiss();
            setSortMenuOpen(true);
          }}
        />
        <View className="h-12 flex-row items-center rounded-[14px] border border-control-border px-0.5">
          <LayoutOption
            icon={LayoutGrid}
            label="Grid view"
            selected={layout === 'grid'}
            onPress={() => setLayout('grid')}
          />
          <LayoutOption
            icon={List}
            label="List view"
            selected={layout === 'list'}
            onPress={() => setLayout('list')}
          />
        </View>
      </View>
    </View>
  );

  const listHeader = search ? (
    <Text className="px-6 pb-3 pt-4 font-mono text-[12px] text-secondary" numberOfLines={1}>
      {visibleGames.length} {visibleGames.length === 1 ? 'result' : 'results'} for “{search}”
    </Text>
  ) : (
    <View className="gap-5 pb-4 pt-5">
      {recentGames.length > 0 && (
        <View className="gap-3">
          <View className="px-6">
            <SectionLabel>RECENTLY PLAYED</SectionLabel>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-3 px-6">
            {recentGames.map((game) => (
              <RecentCard
                key={game.id}
                game={game}
                onPress={() => setSelectedGameId(game.id)}
                onLongPress={() => toggleFavorite(game)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      <View className="flex-row items-center justify-between px-6">
        <SectionLabel>ALL GAMES</SectionLabel>
        <Text className="font-mono text-[12px] text-secondary">
          {visibleGames.length} · {sortOption?.summary}
        </Text>
      </View>
    </View>
  );

  const emptyList = (
    <View className="px-8 pt-16">
      <Text className="text-center font-inter text-[14px] leading-[20px] text-secondary">
        {filter === 'favorites' && !search
          ? 'No favorites yet. Long-press a game to add it.'
          : 'No games match your search.'}
      </Text>
    </View>
  );

  function renderBody() {
    if (status === 'scanning') {
      return (
        <ScanningView
          progress={scanProgress}
          folderUri={folderUri}
          cardWidth={cardWidth}
          columns={COLUMNS}
          columnGap={COLUMN_GAP}
          sidePadding={SIDE_PADDING}
          onCancel={cancelScan}
        />
      );
    }
    if (status === 'noFolder' || !folderUri) {
      return (
        <LibraryEmptyState title="No games yet" body={NO_GAMES_BODY} onChooseFolder={pickFolder} />
      );
    }
    if (status === 'unreadable') {
      return (
        <LibraryEmptyState
          title="Can't read your ROM folder"
          body="It may have been moved or deleted. Choose it again to continue."
          footer={`Current: ${formatFolderPath(folderUri)}`}
          onChooseFolder={pickFolder}
          onRescan={rescan}
        />
      );
    }
    if (games.length === 0) {
      return (
        <LibraryEmptyState
          title="No games yet"
          body={NO_GAMES_BODY}
          footer={`Current: ${formatFolderPath(folderUri)} · 0 games found`}
          onChooseFolder={pickFolder}
          onRescan={rescan}
        />
      );
    }

    return (
      <View className="flex-1">
        {toolbar}
        <FlatList
          key={layout}
          data={visibleGames}
          keyExtractor={(game) => game.id}
          numColumns={layout === 'grid' ? COLUMNS : 1}
          columnWrapperStyle={
            layout === 'grid' ? { gap: COLUMN_GAP, paddingHorizontal: SIDE_PADDING } : undefined
          }
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyList}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) =>
            layout === 'grid' ? (
              <GameGridCard
                game={item}
                width={cardWidth}
                onPress={() => setSelectedGameId(item.id)}
                onLongPress={() => toggleFavorite(item)}
              />
            ) : (
              <GameListRow
                game={item}
                onPress={() => setSelectedGameId(item.id)}
                onToggleFavorite={() => toggleFavorite(item)}
              />
            )
          }
        />
        {sortMenuOpen && (
          <SortMenu
            top={toolbarHeight + SORT_MENU_GAP}
            value={sort}
            onSelect={(mode) => {
              setSort(mode);
              closeSortMenu();
            }}
            onClose={closeSortMenu}
          />
        )}
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-background">
      <StatusBar style="light" />
      {appHeader}
      {renderBody()}
      {selectedGame && folderUri && (
        <GameSheet
          game={selectedGame}
          romPath={formatRomPath(folderUri, selectedGame.id)}
          onClose={closeGameSheet}
          onToggleFavorite={() => toggleFavorite(selectedGame)}
          onPlay={(resume) => playGame(selectedGame, resume)}
          onOpenSaveStates={() => openGameScreen(selectedGame, '/save-states')}
          onOpenCheats={() => openGameScreen(selectedGame, '/cheats')}
          onDelete={(alsoDeleteSave) => deleteGame(selectedGame, alsoDeleteSave)}
        />
      )}
    </SafeAreaView>
  );
}
