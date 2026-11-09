const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// NativeWind defaults to a 14px rem on native; 16 keeps sizes identical to web.
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
