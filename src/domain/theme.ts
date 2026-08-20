import { ACCENTS } from "./types";
import type { Accent, Mode } from "./types";

/** Apply both theme axes to the document root. */
export function applyTheme(mode: Mode, accent: Accent): void {
  const root = document.documentElement;
  root.setAttribute("data-mode", mode === "dark" ? "dark" : "light");
  root.setAttribute("data-accent", ACCENTS.some(([k]) => k === accent) ? accent : "remi");
}
