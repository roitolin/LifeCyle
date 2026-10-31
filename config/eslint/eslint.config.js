// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  {
    ignores: [
      "node_modules/**",
      ".expo/**",
      "LIFECYCLE_WEB/**",
      "dist/**",
      "src/**/dist/**",
    ],
  },
  expoConfig,
  {
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      // These React Compiler rules currently flag established React Native
      // Animated/ref and subscription patterns. The project does not enable
      // React Compiler, so keep the runtime-focused hooks rules enabled while
      // disabling compiler-only diagnostics.
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
