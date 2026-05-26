const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add 'tflite' to asset extensions for react-native-fast-tflite
config.resolver.assetExts.push('tflite');

module.exports = config;
