import KrsEmulator from '@/modules/krs-emulator';

export type VideoFilter = 'original' | 'smooth' | 'lcd' | 'scanlines';
export type VideoAspect = 'native' | '4:3' | 'stretch';
export type VideoScaling = 'integer' | 'fit';

export type VideoSettings = {
  filter: VideoFilter;
  /** How dark the grid or scanlines are, from 0 to 1. */
  strength: number;
  aspect: VideoAspect;
  scaling: VideoScaling;
};

// The order of each list is the number the native renderer expects.
export const FILTER_OPTIONS: { value: VideoFilter; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'lcd', label: 'LCD Grid' },
  { value: 'scanlines', label: 'Scanlines' },
];

export const ASPECT_OPTIONS: { value: VideoAspect; label: string }[] = [
  { value: 'native', label: '3:2 native' },
  { value: '4:3', label: '4:3' },
  { value: 'stretch', label: 'Stretch' },
];

export const SCALING_OPTIONS: { value: VideoScaling; label: string }[] = [
  { value: 'integer', label: 'Integer · sharp' },
  { value: 'fit', label: 'Fit · larger' },
];

export const filterLabel = (filter: VideoFilter) =>
  FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? '';

export function applyVideoSettings(video: VideoSettings) {
  return KrsEmulator.setVideoSettings(
    FILTER_OPTIONS.findIndex((option) => option.value === video.filter),
    video.strength,
    ASPECT_OPTIONS.findIndex((option) => option.value === video.aspect),
    SCALING_OPTIONS.findIndex((option) => option.value === video.scaling)
  );
}
