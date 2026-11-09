import Svg, { Rect } from 'react-native-svg';

import { palette } from '@/constants/palette';

const CELL = 6;
const GAP = 1;
const CELLS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
];

export function KrsLogo({ size = 20 }: { size?: number }) {
  const extent = CELL * 3 + GAP * 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${extent} ${extent}`}>
      {CELLS.map(([column, row]) => (
        <Rect
          key={`${column}-${row}`}
          x={column * (CELL + GAP)}
          y={row * (CELL + GAP)}
          width={CELL}
          height={CELL}
          fill={palette.accent.DEFAULT}
        />
      ))}
    </Svg>
  );
}
