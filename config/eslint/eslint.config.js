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
    },
  },
]);
