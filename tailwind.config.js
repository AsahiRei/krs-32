const { palette } = require('./constants/palette');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // NativeWind's web runtime throws in dev under the default 'media' strategy.
  darkMode: 'class',
  theme: {
    extend: {
      colors: palette,
      fontFamily: {
        inter: 'Inter_400Regular',
        'inter-semibold': 'Inter_600SemiBold',
        'inter-bold': 'Inter_700Bold',
        mono: 'JetBrainsMono_400Regular',
        'mono-medium': 'JetBrainsMono_500Medium',
        pixel: 'PressStart2P_400Regular',
      },
    },
  },
  plugins: [],
};
