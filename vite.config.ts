/**
 * Vite + Vitest + Svelte config, in one file.
 *
 * The full repo has three (`vite.config.ts`, `vitest.config.ts`,
 * `svelte.config.js`). They merge cleanly because Vitest reads a `test` key off
 * the same config, and the Svelte plugin takes its preprocessor inline instead
 * of via a separate `svelte.config.js`.
 */
import { defineConfig } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ preprocess: vitePreprocess() })],
  // Keep Tauri's own logs visible.
  clearScreen: false,
  server: {
    // Fixed + strict so it always matches tauri.conf.json's devUrl.
    port: 5178,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
