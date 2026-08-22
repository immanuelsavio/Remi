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
import { flushSync, mount, tick, unmount } from "svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "load_app_state" ? { kind: "empty" } : null)),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

import Tour from "./Tour.svelte";
import {
  addMain,
  closeRemind,
  endTour,
  goToStep,
  openRemind,
  startTour,
  tourAnchor,
  tourStep,
} from "../../store";
import { get } from "svelte/store";
// The facade exposes `app` read-only, deliberately. A test needs to place
// the world, so it goes through the store's own setter.
import { setState, state } from "../../store/state";
import { TOUR_STEPS } from "../../domain/tour";
import { freshDay } from "../../domain/defaults";
import { demoMains } from "../../domain/demo";

/** Let reactive statements, the registry and any frames settle. */
async function settle() {
  for (let f = 0; f < 6; f++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    flushSync();
    await tick();
  }
}

/** Give a stub the two things jsdom refuses to compute. */
function anchor(key: string, top = 100): HTMLElement {
  const el = document.createElement("div");
  el.dataset.tour = key;
  const input = document.createElement("input");
  el.appendChild(input);
  document.body.appendChild(el);
  // The tour reads a REGISTRY now, not the DOM - elements put themselves in
  // it with the `tourAnchor` action, so a stub has to do the same.
  cleanups.push(tourAnchor(el, key).destroy);
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
let comp: ReturnType<typeof mount> | null = null;
let cleanups: (() => void)[] = [];

/** Mount the tour sitting on one step, with the DOM it expects. */
async function showStep(id: string) {
  startTour();
  goToStep(indexOf(id));
  comp = mount(Tour, { target: host });
  // Svelte 5 runs effects asynchronously; nothing the component does on
  // mount has happened yet when `mount` returns.
  flushSync();
  // The anchor search polls animation frames before it settles.
  for (let f = 0; f < 8; f++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await tick();
  }
}

beforeEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  // A day mid-tour: the demo tasks are up and the gate is lifted.
  setState({ ...freshDay(), awaitingStart: false, phase: "today", mains: demoMains(Date.now()) });
});

afterEach(() => {
  if (comp) unmount(comp);
  comp = null;
  cleanups.forEach((fn) => fn());
  cleanups = [];
  endTour();
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
      if (comp) unmount(comp);
      comp = null;
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

  it("goes inert while a sheet owns the screen", async () => {
    // The tour layer sits above a sheet's scrim, so it hides while one is
    // open - the sheet IS the instruction being followed. Hiding alone was
    // not enough: the keyboard handler stayed live, so Escape ended an
    // invisible tour and the arrows navigated one nobody could see.
    anchor("plan-add");
    await showStep("plan");
    expect(host.querySelector(".tour-bubble")).toBeTruthy();

    openRemind({ kind: "main", id: "demo-1", title: "Draft the quarterly update" });
    await settle();
    expect(
      host.querySelector(".tour-bubble, .tourcard"),
      "the tour drew over the sheet",
    ).toBeNull();

    // ...and the keys belong to the sheet, not to a hidden tour.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settle();
    expect(get(tourStep), "a hidden tour was ended or navigated").not.toBeNull();

    closeRemind();
    await settle();
    expect(host.querySelector(".tour-bubble"), "the tour never came back").toBeTruthy();
  });

  it("ignores arrow keys pressed on the app behind it", async () => {
    // They used to navigate the tour from any button in the application.
    anchor("plan-add");
    await showStep("plan");
    const before = get(tourStep);
    const appButton = document.createElement("button");
    document.body.appendChild(appButton);
    appButton.focus();
    appButton.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settle();
    expect(get(tourStep)).toBe(before);
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

    // Make the task the beat was waiting for - through the action a
    // person's typing goes through, which is what claims it as the task
    // being practised on.
    addMain("Mine");
    for (let f = 0; f < 8; f++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await tick();
    }

    // ...and the instruction moves on by itself.
    expect(host.textContent).toContain("add steps");
    expect(sub.dataset.tour).toBe("plan-substep");
  });

  // --- the buttons, actually clicked ---------------------------------------
  //
  // Everything above tests what the tour DRAWS. These press the controls a
  // person presses: every navigation regression this tour has shipped lived
  // between the reducer and the button wired to it, and no test ever
  // clicked either one.

  /** The card/bubble button whose label matches. */
  function button(label: string): HTMLButtonElement | null {
    const all = [...host.querySelectorAll<HTMLButtonElement>("button")];
    return all.find((b) => b.textContent?.trim().toLowerCase() === label.toLowerCase()) ?? null;
  }

  it("clicking Next turns the page", async () => {
    await showStep("look");
    const before = get(tourStep)!;
    button("Next")!.click();
    await settle();
    expect(get(tourStep)).toBeGreaterThan(before);
  });

  it("clicking Back returns to the previous page", async () => {
    await showStep("look");
    const start = get(tourStep)!;
    button("Next")!.click();
    await settle();
    button("Back")!.click();
    await settle();
    expect(get(tourStep)).toBe(start);
  });

  it("renders NO Back button on the first step - it would do nothing", async () => {
    // It used to render, enabled, and silently do nothing. A control that
    // ignores you teaches you that the app ignores you.
    await showStep(TOUR_STEPS[0].id);
    expect(button("Back"), "Back was rendered where it cannot go anywhere").toBeNull();
  });

  it("Back appears as soon as there is somewhere to go", async () => {
    await showStep(TOUR_STEPS[0].id);
    button("Next")!.click();
    await settle();
    expect(button("Back")).toBeTruthy();
  });

  it("rapid repeated Next clicks walk the checklist once, not once per click", async () => {
    anchor("plan-add");
    await showStep("plan");
    const beats = TOUR_STEPS[indexOf("plan")].beats!.length;
    for (let i = 0; i < beats + 2; i++) {
      button("Next")?.click();
      await settle();
    }
    // One practice task, however hard the button was pressed.
    const mine = get(state).mains.filter((m) => !m.id.startsWith("demo-"));
    expect(mine.length, "rapid clicking built more than one practice task").toBeLessThanOrEqual(1);
  });

  it("Back during the auto-advance hold wins - the timer does not undo it", async () => {
    anchor("plan-add");
    await showStep("plan");
    const plan = indexOf("plan");
    const beats = TOUR_STEPS[plan].beats!.length;
    // Finish the checklist, which arms the automatic page turn.
    for (let i = 0; i < beats; i++) {
      button("Next")!.click();
      await settle();
    }
    // ...and go back before it fires.
    button("Back")!.click();
    await settle();
    const after = get(tourStep);
    // Wait out the hold: nothing may move.
    await new Promise((r) => setTimeout(r, 1600));
    await settle();
    expect(get(tourStep), "the pending timer undid a deliberate Back").toBe(after);
  });

  it("Skip ends the tour and puts the real day back", async () => {
    await showStep("look");
    const skip = button("Skip") ?? button("Skip tour");
    expect(skip, "no Skip control").toBeTruthy();
    skip!.click();
    await settle();
    expect(get(tourStep)).toBeNull();
    expect(get(state).demoRestore).toBeNull();
  });

  it("puts focus back INTO the card when a sheet closes on the same step", async () => {
    // `focusedFor` remembered only the step index. The card is destroyed
    // while a sheet is up and rebuilt on the SAME step when it closes, so
    // the guard said "already focused for this step" and left focus
    // wherever the sheet had dropped it - outside a dialog still claiming
    // to be modal.
    await showStep("look");
    const card = host.querySelector<HTMLElement>(".tourcard")!;
    expect(card.contains(document.activeElement)).toBe(true);

    openRemind({ kind: "main", id: "demo-1", title: "Draft the quarterly update" });
    await settle();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    closeRemind();
    await settle();
    const again = host.querySelector<HTMLElement>(".tourcard")!;
    expect(again.contains(document.activeElement), "focus never came back to the card").toBe(true);
  });

  it("Shift+Tab from the card surface wraps to the last control, not out of the dialog", async () => {
    // The surface is `tabindex="-1"` and is what focus lands on when a card
    // opens, so it matched neither edge of the trap and Shift+Tab walked
    // straight out behind an `aria-modal` dialog.
    await showStep("look");
    const card = host.querySelector<HTMLElement>(".tourcard")!;
    card.focus();
    const focusable = [...card.querySelectorAll<HTMLElement>("button, a[href], input, textarea")];
    expect(focusable.length).toBeGreaterThan(0);

    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    await settle();
    expect(card.contains(document.activeElement), "Shift+Tab escaped the modal card").toBe(true);
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });

  it("Tab from the last control wraps to the first", async () => {
    await showStep("look");
    const card = host.querySelector<HTMLElement>(".tourcard")!;
    const focusable = [...card.querySelectorAll<HTMLElement>("button, a[href], input, textarea")];
    const last = focusable[focusable.length - 1];
    last.focus();
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await settle();
    expect(document.activeElement).toBe(focusable[0]);
  });

  it("hands focus back to the app when the tour ends", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    await showStep("look");
    expect(host.querySelector(".tourcard")!.contains(document.activeElement)).toBe(true);

    endTour();
    await settle();
    expect(document.activeElement, "focus was left on a destroyed card").toBe(opener);
  });

  // --- Enter ---------------------------------------------------------------
  //
  // Enter used to work from the two name fields and nowhere else, so the
  // pages asking a yes/no question swallowed it and people pressed it twice.

  /** Press Enter on a specific element, the way a keyboard does. */
  function pressEnter(el: Element) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }

  it("Enter in the nickname field saves and advances exactly once", async () => {
    await showStep("nickname");
    const input = host.querySelector<HTMLInputElement>("#tour-nick")!;
    const before = get(tourStep)!;
    input.value = "Sam";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    pressEnter(input);
    await settle();
    expect(get(state).userName).toBe("Sam");
    expect(get(tourStep)).toBe(before + 1);
  });

  it("Enter in the full-name field saves and advances exactly once", async () => {
    await showStep("fullname");
    const input = host.querySelector<HTMLInputElement>("input")!;
    const before = get(tourStep)!;
    input.value = "Sam Smith";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    pressEnter(input);
    await settle();
    expect(get(state).fullName).toBe("Sam Smith");
    expect(get(tourStep)).toBe(before + 1);
  });

  it("Enter on the Show Remi card advances", async () => {
    await showStep("mascot");
    const card = host.querySelector<HTMLElement>(".tourcard")!;
    const before = get(tourStep)!;
    card.focus();
    pressEnter(card);
    await settle();
    expect(get(tourStep), "Enter did nothing on a card with no text field").toBe(before + 1);
  });

  it("Enter on the costume/wander card advances", async () => {
    setState({ ...get(state), mascotOn: true });
    await showStep("mouse");
    const card = host.querySelector<HTMLElement>(".tourcard")!;
    const before = get(tourStep)!;
    card.focus();
    pressEnter(card);
    await settle();
    expect(get(tourStep)).toBe(before + 1);
  });

  it("Enter on the appearance card advances", async () => {
    await showStep("look");
    const card = host.querySelector<HTMLElement>(".tourcard")!;
    const before = get(tourStep)!;
    card.focus();
    pressEnter(card);
    await settle();
    expect(get(tourStep)).toBe(before + 1);
  });

  it("Enter does NOT fire twice from a button inside the card", async () => {
    // The browser already turns Enter on a focused button into a click;
    // navigating as well would run two actions from one keypress.
    await showStep("look");
    const before = get(tourStep)!;
    const btn = host.querySelector<HTMLButtonElement>(".tourcard button")!;
    btn.focus();
    pressEnter(btn);
    await settle();
    expect(get(tourStep), "Enter on a button also navigated").toBe(before);
  });

  it("Enter in an application field behind the tour never navigates", async () => {
    await showStep("look");
    const before = get(tourStep)!;
    const appInput = document.createElement("input");
    document.body.appendChild(appInput);
    appInput.focus();
    pressEnter(appInput);
    await settle();
    expect(get(tourStep), "the app's own input navigated the tour").toBe(before);
    appInput.remove();
  });
});
