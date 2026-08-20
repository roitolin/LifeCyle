const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The web application lives inside the mobile project directory, but it is a
// separate build with its own dependency tree. Keeping it out of Metro's file
// map prevents Android reloads from stalling while Metro scans unrelated files.
config.resolver.blockList = [
  /[\\/]LIFECYCLE_WEB[\\/].*/,
  /[\\/]\.expo-export-test\d*[\\/].*/,
];

module.exports = config;
