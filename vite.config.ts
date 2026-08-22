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
  // Svelte ships a browser build and an SSR build. Under Vitest the SSR
  // one wins by default, and in it `onMount` never runs - so a mounted
  // component whose behaviour lives in `onMount` (the splash's hold timer)
  // tests as doing nothing at all, silently. Asking for the browser
  // condition is what makes a mounted component behave like one.
  resolve: {
    conditions: ["browser"],
  },
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
    setupFiles: ["src/test-setup.ts"],
    // Resolve Svelte's BROWSER build under test. Without it, a mounted
    // component runs the SSR path, where `onMount` never fires - so a
    // component whose behaviour lives in `onMount` (the splash's hold
    // timer) would silently test as doing nothing at all.
    // (see resolve.conditions below)
  },
});
