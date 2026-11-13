import { NativeModule, requireNativeModule, requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

/** Matches GameSystem in lib/systems.ts. */
export type EmulatorSystem = 'gba' | 'nds';

export type CoreInfo = {
  name: string;
  version: string;
  extensions: string;
  libretroApiVersion: number;
  aaudioRecommended: boolean;
};

export type EmulatorStats = {
  fps: number;
  frameMs: number;
  audioUnderruns: number;
  audioOverruns: number;
  saveWrites: number;
  saveBytes: number;
};

export type ControlDefault = {
  id: string;
  label: string;
  kind: 'rect' | 'pill' | 'round' | 'cross';
  x: number;
  y: number;
  size: number;
  aspect: number;
};

export type OrientationDefaults = {
  width: number;
  height: number;
  /** The first design unit controls may be placed at; above it is the game and title row. */
  top: number;
  game: { left: number; top: number; right: number; bottom: number };
  controls: ControlDefault[];
};

export type ControlDefaults = { portrait: OrientationDefaults; landscape: OrientationDefaults };

type KrsEmulatorEvents = {
  onControllerCapture: (event: { keys: string[] }) => void;
  onControllerAction: (event: { action: string }) => void;
};

declare class KrsEmulatorNativeModule extends NativeModule<KrsEmulatorEvents> {
  /** The core that runs the system's games; GBA when no system is given. */
  getCoreInfo(system?: EmulatorSystem): CoreInfo;
  loadGame(uri: string, system: EmulatorSystem): Promise<{ saveExists: boolean; saveId: string }>;
  /** The name, without extension, of this ROM's save file. */
  getSaveId(uri: string): Promise<string>;
  /** The player's default control positions, sizes and game area for each orientation. */
  getControlDefaults(system?: EmulatorSystem): ControlDefaults;
  /** Connected game controllers; battery is a percentage, or null when the pad doesn't report it. */
  getControllers(): { name: string; battery: number | null }[];
  setControllerMapping(json: string): void;
  startControllerCapture(): void;
  stopControllerCapture(): void;
  setVideoSettings(filter: number, strength: number, aspect: number, scaling: number): Promise<void>;
  stop(): void;
  setPaused(paused: boolean): void;
  saveState(name: string): Promise<void>;
  loadState(name: string): Promise<void>;
  reset(): Promise<void>;
  /** Writes the current picture to the named state's thumbnail file. */
  captureThumbnail(name: string, scale?: number): Promise<void>;
  /** Saves the current picture to Pictures/KRS32. Needs Android 10 or newer. */
  saveScreenshot(): Promise<void>;
  /**
   * Replaces the active cheats, undoing any ROM patches the previous ones made. Each entry is one
   * cheat: its code lines in a format the core understands, joined with "+".
   */
  setCheats(lines: string[]): Promise<void>;
  /** When the named state was written, in milliseconds, or null if it doesn't exist. */
  getStateTime(name: string): number | null;
  getStats(): EmulatorStats;
}

export type KrsEmulatorViewProps = ViewProps & {
  /** Picks the control layout, and whether touches on the picture reach the DS touchscreen. */
  system: EmulatorSystem;
  title: string;
  /** Saved control layout as JSON, or an empty string for the defaults. */
  controlLayout: string;
  stretchVideo: boolean;
  fastForwardSpeed: number;
  /** DS only: the screen arrangement as JSON ({ mode, swapped, gap }), or empty for the default. */
  screenLayout?: string;
  /** DS only: hide the touch controls while a controller is connected. */
  autoHideControls?: boolean;
  onMenuPress: () => void;
  /** DS only: the screen swap button was tapped. */
  onSwapScreensPress?: () => void;
  /** DS only: the screen layout button was tapped. */
  onScreenLayoutPress?: () => void;
};

export const KrsEmulatorView: ComponentType<KrsEmulatorViewProps> =
  requireNativeView('KrsEmulator');

export default requireNativeModule<KrsEmulatorNativeModule>('KrsEmulator');
