/**
 * The guided tour, MOUNTED.
 *
 * Everything else about the tour is tested as pure data or pure functions,
 * and every regression it has shipped lived in the gap between those and
 * the component: an anchor that resolved to nothing, a mode that rendered
 * neither shape, a bubble hidden by a flag nobody remembered was still set.
 * None of that is visible from the domain, and all of it is visible here.
 *
 * jsdom has no layout, so the stub anchors are given a real rectangle and
 * an `offsetParent`. That is deliberate: what is under test is which
 * element the tour LATCHES ON TO and what it draws, not where the browser
 * would have put it.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "load_app_state" ? { kind: "empty" } : null)),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

import Tour from "./Tour.svelte";
import { tourStep } from "../../store";
// The facade exposes `app` read-only, deliberately. A test needs to place
// the world, so it goes through the store's own setter.
import { setState, state } from "../../store/state";
import { TOUR_STEPS } from "../../domain/tour";
import { freshDay } from "../../domain/defaults";
import { demoMains } from "../../domain/demo";

/** Give a stub the two things jsdom refuses to compute. */
function anchor(key: string, top = 100): HTMLElement {
  const el = document.createElement("div");
  el.dataset.tour = key;
  const input = document.createElement("input");
  el.appendChild(input);
  document.body.appendChild(el);
  Object.defineProperty(el, "offsetParent", { get: () => document.body });
  el.getBoundingClientRect = () =>
    ({
      left: 40,
      top,
      right: 340,
      bottom: top + 40,
      width: 300,
      height: 40,
      x: 40,
      y: top,
    }) as DOMRect;
  return el;
}

const indexOf = (id: string) => TOUR_STEPS.findIndex((s) => s.id === id);

let host: HTMLElement;
let comp: Tour;

/** Mount the tour sitting on one step, with the DOM it expects. */
async function showStep(id: string) {
  tourStep.set(indexOf(id));
  comp = new Tour({ target: host });
  // The anchor search polls animation frames before it settles.
  for (let f = 0; f < 8; f++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await tick();
  }
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  // A day mid-tour: the demo tasks are up and the gate is lifted.
  setState({ ...freshDay(), awaitingStart: false, phase: "today", mains: demoMains(Date.now()) });
});

afterEach(() => {
  comp?.$destroy();
  tourStep.set(null);
});

describe("the tour, on screen", () => {
  it("shows SOMETHING on every step of the script", async () => {
    // The failure this exists for: a step that renders neither the walking
    // bubble nor the card, leaving the app showing through with no way to
    // tell the tour is still running. It has happened twice.
    for (const step of TOUR_STEPS) {
      document.body.innerHTML = "";
      host = document.createElement("div");
      document.body.appendChild(host);
      if (step.anchor) anchor(step.anchor);
      for (const b of step.beats ?? []) if (b.anchor) anchor(b.anchor, 200);

      await showStep(step.id);
      const shown = host.querySelector(".tour-bubble, .tourcard");
      expect(shown, `step "${step.id}" rendered nothing at all`).toBeTruthy();
      comp.$destroy();
    }
  });

  it("falls back to a card when the anchor is nowhere to be found", async () => {
    // No stub anchors at all: the element a walking step wants does not
    // exist. It must still say something. Rendering neither shape is the
    // failure that has looked like "the tour vanished" twice.
    await showStep("plan");
    expect(host.querySelector(".tourcard"), "no card, and no bubble either").toBeTruthy();
  });

  it("keeps the blur on a card step too", async () => {
    await showStep("look");
    expect(host.querySelector(".tour-scrim")).toBeTruthy();
  });

  it("rings and blurs the thing a walking step points at", async () => {
    anchor("plan-add");
    await showStep("plan");
    expect(host.querySelector(".tour-ring"), "no ring").toBeTruthy();
    // Four panels around the target - the spotlight.
    expect(host.querySelectorAll(".tour-dim > div")).toHaveLength(4);
  });

  it("walks the checklist from the add box onto the task's own controls", async () => {
    anchor("plan-add");
    const sub = anchor("plan-substep", 200);
    await showStep("plan");

    // Beat one is outstanding, so the ring is on the add-a-task box.
    expect(host.textContent).toContain("Type a task");

    // Make the task the beat was waiting for.
    const now = Date.now();
    state.update((s) => {
      const own = { ...demoMains(now)[0], id: "mine", subs: [], tags: [], remind: null };
      return { ...s, mains: [...demoMains(now), own] };
    });
    for (let f = 0; f < 8; f++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await tick();
    }

    // ...and the instruction moves on by itself.
    expect(host.textContent).toContain("add steps");
    expect(sub.dataset.tour).toBe("plan-substep");
  });
});
