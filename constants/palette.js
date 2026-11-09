// CommonJS so both tailwind.config.js and app code can import it.
const palette = {
  background: '#0B0B0E',
  card: {
    DEFAULT: '#141418',
    border: '#2A2A31',
  },
  control: {
    DEFAULT: '#1B1B20',
    pressed: '#26262D',
    border: '#33333B',
  },
  accent: {
    DEFAULT: '#5BC0FF',
    pressed: '#46A9E6',
    on: '#0B0B0E',
  },
  foreground: '#F3EFE7',
  secondary: '#BDB9B0',
  muted: '#8B8880',
  danger: '#FF7A7A',
  success: '#6FDB9B',
  warning: {
    DEFAULT: '#FFC14D',
    surface: '#1E1A12',
    border: '#5A4A1E',
  },
};

module.exports = { palette };
