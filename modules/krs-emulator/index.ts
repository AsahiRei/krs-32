import { NativeModule, requireNativeModule, requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

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
  getCoreInfo(): CoreInfo;
  loadGame(uri: string): Promise<{ saveExists: boolean; saveId: string }>;
  /** The name, without extension, of this ROM's save file. */
  getSaveId(uri: string): Promise<string>;
  /** The player's default control positions, sizes and game area for each orientation. */
  getControlDefaults(): ControlDefaults;
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
  /** Replaces the active cheats. Each entry is one line in a format the core understands. */
  setCheats(lines: string[]): Promise<void>;
  /** When the named state was written, in milliseconds, or null if it doesn't exist. */
  getStateTime(name: string): number | null;
  getStats(): EmulatorStats;
}

export type KrsEmulatorViewProps = ViewProps & {
  title: string;
  /** Saved control layout as JSON, or an empty string for the defaults. */
  controlLayout: string;
  stretchVideo: boolean;
  fastForwardSpeed: number;
  onMenuPress: () => void;
};

export const KrsEmulatorView: ComponentType<KrsEmulatorViewProps> =
  requireNativeView('KrsEmulator');

export default requireNativeModule<KrsEmulatorNativeModule>('KrsEmulator');
