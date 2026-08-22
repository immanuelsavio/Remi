<script lang="ts">
  /**
   * The guided tour: Remi WALKS to whatever it is describing.
   *
   * Two kinds of step, and the difference is not decorative:
   *
   *   1. A walkthrough step names an `anchor` - the `data-tour` value of a
   *      real element. Remi scurries over to it, a ring marks it, and the
   *      words come out of a bubble beside the mouse. Nothing is dimmed and
   *      nothing is covered, so "add a task below, press Enter" is an
   *      instruction you can actually carry out while it is on screen.
   *   2. A step that ASKS (name, look, preferences) is a centred card. A
   *      speech bubble is a bad container for a form: the controls need
   *      room, a stable position and somewhere sensible for focus to land.
   *
   * It was a docked full-height panel before this, which worked but shifted
   * the whole app sideways to make space and pointed at nothing in
   * particular. Before that it was a true full-screen overlay, which hid the
   * demo day the tour exists to point at.
   *
   * The anchor is best-effort by design. If the element cannot be found -
   * wrong tab, still rendering, a list that happens to be empty - the step
   * silently falls back to the centred card. A tour that strands itself
   * pointing at empty space is worse than one that stops pointing.
   *
   * Both ask steps bind straight to real settings, so they always show what
   * is currently true - which is what makes retaking the tour a way to
   * change your mind rather than a form that resets you. Nothing on them is
   * required: Next moves on whether or not anything was touched.
   */
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";

  import {
    app,
    endTour,
    setAccent,
    setFlag,
    setMode,
    setCostume,
    setFullName,
    setUserName,
    toggleWellness,
    previewNotifications,
    setWellnessEvery,
    setWellnessHour,
    wellnessCopy,
    tourBack,
    tourNext,
    tourStep,
    remindTarget,
    setRemind,
    openPopover,
  } from "../../store";
  import { FULL_NAME_MAX, NAME_MAX } from "../../domain/name";
  import { ACCENTS, clockLabel } from "../../view";
  import {
    beatIndexFor,
    clampCursor,
    ownTask,
    shouldAutoAdvance,
    stepAt,
    tourProgress,
  } from "../../domain/tour";
  import type { TourBeat } from "../../domain/tour";
  import { COSTUMES } from "../../domain/types";
  import Mascot from "../shared/Mascot.svelte";

  $: s = $app;
  $: i = $tourStep;
  $: step = i === null ? null : stepAt(i);
  /**
   * Position and length of the tour THIS user is getting.
   *
   * Some steps opt out (turning the mouse off drops the two pages about it),
   * so counting against the whole script would say "step 8 of 14" on the
   * last page and leave the bar short of the end.
   */
  $: prog = i === null ? { pos: 1, total: 1 } : tourProgress(i, s);
  $: lastStep = prog.pos === prog.total;

  // ---- beats -------------------------------------------------------------
  /**
   * The step's checklist, and which item is being asked for right now.
   *
   * `done` is a pure read of state, so this recomputes itself whenever the
   * user actually does something - no events to wire, and it cannot claim
   * a beat is finished when the app disagrees.
   */
  $: beats = (step?.beats ?? []) as TourBeat[];
  $: doneCount = beats.filter((b) => b.done(s)).length;
  /** Index of the first beat still outstanding, or past the end if none is. */
  $: autoIdx = (() => {
    const at = beats.findIndex((b) => !b.done(s));
    return at < 0 ? beats.length : at;
  })();
  /**
   * How far Next has been pressed past what has actually been done.
   *
   * Next used to jump the whole page mid-checklist, which made the other
   * three things unreachable without doing the first. It moves ONE beat
   * now, so the button means "show me the next one" while there is a next
   * one, and only turns the page once the list is finished or skipped
   * past. Reset on every step change.
   */
  /**
   * ===== CHECKLIST NAVIGATION =====
   *
   * Two drivers, and exactly one of them is in charge at a time. Mixing
   * them is what kept breaking this: an automatic advance would fire on
   * top of a deliberate Back and yank the page out from under it.
   *
   *   AUTO (`cursor === null`) - the default. The bubble follows whatever
   *   is still outstanding, and finishing the list turns the page.
   *
   *   MANUAL (`cursor` set) - the moment Back or Next is pressed. The
   *   person is driving: the bubble stays where they put it, nothing
   *   re-syncs it, and the page never turns by itself. Pressing Next past
   *   the last beat is then the only way onward, which is the point.
   *
   * Manual lasts until the step changes. Taking the wheel and having the
   * tour take it back a second later is the whole complaint.
   */
  let cursor: number | null = null;

  /** Cancel a pending auto-advance and hand control over. */
  function takeWheel(at: number) {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    cursor = clampCursor(beats.length, at);
  }

  // A new step is a clean slate: back to AUTO, nothing pending.
  $: if (i !== null) {
    void i;
    cursor = null;
    advancedFrom = null;
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  }

  $: beatIdx = beatIndexFor(beats.length, cursor, autoIdx);
  $: beat = beats[beatIdx] ?? null;
  /** Every beat genuinely DONE - not merely skipped past. */
  $: allBeatsDone = beats.length > 0 && autoIdx >= beats.length;
  /** ...and the tour is still the one driving. */
  $: canAutoAdvance = shouldAutoAdvance(beats.length, autoIdx, cursor);
  /**
   * The most recently finished beat BEFORE the current one.
   *
   * Indexing by `doneCount` was wrong the moment anything was done out of
   * order: two beats done meant `beats[1]`, which is the second beat
   * whether or not it was one of them - so skipping the step and adding a
   * tag congratulated you for the step you had not done.
   */
  $: lastDone =
    beats
      .slice(0, beatIdx)
      .reverse()
      .find((b) => b.done(s)) ?? null;

  /**
   * Finishing the checklist turns the page by itself - in AUTO only.
   *
   * Held briefly so the last acknowledgement is readable rather than
   * flashing past. `advancedFrom` stops a re-render arming it twice, and
   * it re-checks the step on firing so a page turned in the meantime is
   * never turned again.
   */
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;
  let advancedFrom: number | null = null;
  $: {
    if (canAutoAdvance && i !== null && advancedFrom !== i) {
      advancedFrom = i;
      const at = i;
      if (advanceTimer) clearTimeout(advanceTimer);
      advanceTimer = setTimeout(() => {
        advanceTimer = null;
        if (get(tourStep) === at && cursor === null) tourNext();
      }, 1400);
    }
  }

  /** A beat can point somewhere other than the step it belongs to. */
  /**
   * Where to point, best first, as a stable "a|b" key.
   *
   * A beat's own anchor is the preference, but it may not EXIST yet: press
   * Next on "type a task" without typing one and the step's add-a-step box
   * has nothing to attach to, because there is no task. The step's own
   * anchor is the fallback, so the tour keeps walking instead of collapsing
   * to a centred card - which is what it did, and it looked like the tour
   * had lost its place.
   *
   * Joined into one string on purpose: an array literal is a new reference
   * every recompute, and the reactive statement below would re-run the
   * search on every store tick.
   */
  $: anchorKey = step?.ask ? "" : [beat?.anchor, step?.anchor].filter(Boolean).join("|");
  /** The preferred anchor, for the upgrade check in the poll. */
  $: wantKey = anchorKey.split("|")[0] ?? "";
  /**
   * Pointing at the fallback, because this beat's own control is not there.
   *
   * Happens when a beat is skipped past its prerequisite - Next on "type a
   * task" without typing one leaves nothing to add a step TO. Saying so is
   * better than an instruction aimed at a control that does not exist.
   */
  $: beatBlocked = !!beat?.anchor && !!anchorEl && anchorEl.dataset.tour !== beat.anchor;

  /**
   * A modal is open over the app - stand aside until it closes.
   *
   * The tour layer is z-index 300 and a sheet's scrim is 20, so the bubble
   * drew straight over the reminder picker and covered the date fields the
   * step had just told the user to fill in. Hiding is right rather than
   * restacking: the sheet IS the instruction being followed, the beat
   * notices on its own when it is done, and the bubble comes back as soon
   * as the sheet closes.
   */
  $: modalUp = !!$remindTarget || !!s.overlay;
  $: first = !s.tourSeen;

  /** A Svelte template cannot parse a TS `as` cast, so narrow here. */
  function pickCostume(v: string) {
    const found = COSTUMES.find(([k]) => k === v);
    if (found) setCostume(found[0]);
  }

  /** The switches worth deciding up front. Everything else lives in Settings. */
  const PREFS = [
    {
      key: "notifyReminders",
      label: "Reminder notifications",
      hint: "A native banner when a reminder is due.",
    },
    {
      key: "privateNotifications",
      label: "Keep task names out of banners",
      hint: "Safer on a shared screen. The detail stays inside the app.",
    },
    {
      key: "trayTimer",
      label: "Show the timer in the menu bar",
      hint: "Ambient time awareness with nothing to click.",
    },
    {
      key: "loggingOptIn",
      label: "Anonymous usage counts",
      hint: "Buttons and screens only. Never task titles, notes or reminders. Nothing is transmitted.",
    },
  ] as const;

  const WELLNESS = ["water", "stand", "walk", "lunch", "breakr"] as const;

  // ---- the walk ----------------------------------------------------------
  /** Rendered width of the bubble, px. Fixed so the geometry is knowable. */
  const BUBBLE_W = 330;
  /** Rendered size of the mouse walking beside it. */
  const REMI_SIZE = 62;
  /** Gap between the target and the group, and from the window edge. */
  const GAP = 16;
  const MARGIN = 12;
  /** Walking speed, px per second - the same constant the roaming mouse uses. */
  const SPEED = 620;

  /** The element this step is about, once found. */
  let anchorEl: HTMLElement | null = null;
  /** Group position (viewport px) and which side of the target it sits on. */
  let gx = 0;
  let gy = 0;
  type Side = "right" | "left" | "below" | "above";
  const SIDES: Side[] = ["right", "left", "below", "above"];
  let side: Side = "right";
  /** The target's rectangle, for the ring. Null = nothing to ring. */
  let ring: { x: number; y: number; w: number; h: number } | null = null;
  /** Measured once rendered, so the group can be centred on the target. */
  let groupH = REMI_SIZE;
  /** First placement jumps; every later one walks. */
  let placed = false;
  let walking = false;
  let walkMs = 0;
  let walkTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Supersedes an in-flight anchor search.
   *
   * Pressing Next twice quickly starts a second search while the first is
   * still waiting on frames; without this the older one wins whenever it
   * finishes last and the bubble points at the previous step's element.
   */
  let findToken = 0;
  let scroller: HTMLElement | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  /** A walking step is one with an anchor that is not asking anything. */
  $: wants = !!step && !!step.anchor && !step.ask;
  /**
   * Which of the two shapes this step is rendering.
   *
   * There is deliberately no third "still looking" state any more. There
   * was, and it rendered NOTHING - which meant any search that ran long, or
   * got superseded before it finished, left the tour invisible with the app
   * showing through and no way to tell the tour was still running. A blank
   * is the worst thing this can do, so the previous anchor is now kept
   * until a new one is found and the bubble never has a gap to fall into.
   */
  $: mode = wants && anchorEl ? "walk" : "card";

  function reducedMotion(): boolean {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  /**
   * Wait for the element to exist AND be laid out.
   *
   * A tab switch re-creates the whole panel, so the element for the step we
   * are moving to does not exist yet at the moment the step changes. Polling
   * frames rather than guessing a delay means it is found the instant it is
   * there, and gives up rather than hanging if it never appears.
   */
  /** On screen and big enough to ring, or not really there. */
  function usable(el: HTMLElement | null): el is HTMLElement {
    // offsetParent is null for a display:none ancestor - present in the
    // DOM but not on screen, which is not something to point at.
    return !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  }

  function lookup(key: string): HTMLElement | null {
    const el = document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
    return usable(el) ? el : null;
  }

  async function findAnchor(keys: string[], token: number): Promise<HTMLElement | null> {
    for (let f = 0; f < 40; f++) {
      if (token !== findToken) return null;
      // Preference order every frame, so the fallback is only taken while
      // the better target genuinely is not there.
      for (const key of keys) {
        const el = lookup(key);
        if (el) return el;
      }
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return null;
  }

  /** Move the group, walking there if it is already somewhere. */
  function moveTo(x: number, y: number) {
    const dist = Math.hypot(x - gx, y - gy);
    gx = x;
    gy = y;
    if (!placed || reducedMotion() || dist < 4) {
      placed = true;
      walking = false;
      walkMs = 0;
      return;
    }
    // Duration from DISTANCE, so speed is constant: a fixed duration makes
    // short hops crawl and long ones teleport, which reads as broken.
    walkMs = clamp((dist / SPEED) * 1000, 240, 900);
    walking = true;
    if (walkTimer) clearTimeout(walkTimer);
    walkTimer = setTimeout(() => (walking = false), walkMs);
  }

  /**
   * Put the group beside the target, preferring the side with room.
   *
   * Right, then left, then below, then above - and clamped to the window
   * either way, because a bubble half off screen says nothing.
   */
  /** Does the group's box, placed here, sit on top of the target's? */
  function overlaps(x: number, y: number, w: number, h: number, r: DOMRect): boolean {
    return x < r.right && x + w > r.left && y < r.bottom && y + h > r.top;
  }

  /**
   * Put the group beside the target, on whichever side has the most room.
   *
   * First-fit used to decide this - right, then left, then below, then
   * above - which meant a target with barely enough space to its right got
   * the bubble jammed into that sliver while half the window sat empty on
   * the other side. Scoring by SLACK puts it where it is least in the way,
   * and a placement that would still land on top of the target is skipped
   * rather than clamped onto it.
   */
  function measure() {
    if (!anchorEl || !document.contains(anchorEl)) {
      ring = null;
      return;
    }
    const r = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Scrolled out of the panel entirely: stop ringing empty space, but
    // leave the bubble where it is rather than snapping it about.
    if (r.bottom < 0 || r.top > vh) {
      ring = null;
      return;
    }
    // Clamped to the window, so the spotlight's four panels never take a
    // negative size when the target is only partly on screen.
    const top = clamp(r.top, 0, vh);
    const bottom = clamp(r.bottom, 0, vh);
    ring = { x: Math.max(0, r.left), y: top, w: Math.max(0, r.width), h: bottom - top };

    const groupW = BUBBLE_W + REMI_SIZE + 8;
    const h = Math.max(groupH, REMI_SIZE);
    const room: Record<Side, number> = {
      right: vw - r.right - GAP - MARGIN,
      left: r.left - GAP - MARGIN,
      below: vh - r.bottom - GAP - MARGIN,
      above: r.top - GAP - MARGIN,
    };
    const needs: Record<Side, number> = { right: groupW, left: groupW, below: h, above: h };
    const ranked = SIDES.slice().sort((a, b) => room[b] - needs[b] - (room[a] - needs[a]));

    const place = (which: Side): { x: number; y: number } => {
      let x: number;
      let y: number;
      if (which === "right") {
        x = r.right + GAP;
        y = r.top + r.height / 2 - h / 2;
      } else if (which === "left") {
        x = r.left - GAP - groupW;
        y = r.top + r.height / 2 - h / 2;
      } else if (which === "below") {
        x = r.left + r.width / 2 - groupW / 2;
        y = r.bottom + GAP;
      } else {
        x = r.left + r.width / 2 - groupW / 2;
        y = r.top - GAP - h;
      }
      return {
        x: clamp(x, MARGIN, vw - groupW - MARGIN),
        y: clamp(y, MARGIN, vh - h - MARGIN),
      };
    };

    // The best side that actually fits AND stays off the target. Clamping
    // can drag a placement back over the thing it is pointing at, which is
    // the one position a pointer must never take.
    let chosen = ranked[0];
    let at = place(chosen);
    for (const cand of ranked) {
      const p = place(cand);
      if (room[cand] >= needs[cand] && !overlaps(p.x, p.y, groupW, h, r)) {
        chosen = cand;
        at = p;
        break;
      }
    }
    side = chosen;
    moveTo(at.x, at.y);
  }

  /** Bring the target into view before measuring, if it is off screen. */
  function reveal(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top >= MARGIN && r.bottom <= vh - MARGIN) return;
    try {
      el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    } catch {
      el.scrollIntoView();
    }
  }

  /** Latch onto the step's element (or give up and fall back to a card). */
  async function attach(keys: string) {
    const token = ++findToken;
    if (!keys) {
      anchorEl = null;
      ring = null;
      return;
    }
    // The PREVIOUS anchor is deliberately left in place while this search
    // runs. Clearing it first blanked the tour for however long the search
    // took - and forever if the search was superseded before it finished.
    // Holding the old one means the worst case is a ring in the right
    // shape but the wrong place, for a few frames.
    const el = await findAnchor(keys.split("|"), token);
    if (token !== findToken) return;
    anchorEl = el;
    if (!el) {
      ring = null;
      return;
    }
    reveal(el);
    measure();
    handOverFocus(el);
  }

  /**
   * Put the caret where the current beat is asking you to type.
   *
   * Without this the tour walked people into a loop. Adding a task returns
   * focus to the add-a-task box (right for someone entering five tasks in a
   * row), so the very next Enter made ANOTHER task - while the bubble was
   * asking for a step on the first one. Following the instruction produced
   * a fresh task every time, and the checklist never moved.
   *
   * Inputs only. Focusing a button would arm Enter to press it, which for
   * the deadline beat means a sheet opening at a keystroke nobody aimed.
   * Only on steps that ASK for something - an ordinary walking step has no
   * business taking the caret.
   */
  function handOverFocus(el: HTMLElement) {
    if (!beats.length) return;
    // Only ever the beat's OWN control. `el` may be the step's fallback -
    // on the Plan step that is the add-a-TASK box - and seeding there put
    // the step's example into it, so pressing Next made a top-level task
    // called "First step" instead of a step under the task. A fallback is
    // something to POINT at; it is never something to type into.
    if (beat?.anchor && el.dataset.tour !== beat.anchor) return;
    const field = el instanceof HTMLInputElement ? el : el.querySelector<HTMLInputElement>("input");
    if (!field) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return;
    }
    field.focus();
    seedField(field);
  }

  /**
   * Put the beat's example into an empty box, and select it.
   *
   * Selected rather than merely typed in: the first keystroke replaces the
   * whole thing, so it reads as a suggestion rather than something to
   * delete first. Only ever into an EMPTY field - overwriting what somebody
   * has already typed to make a demo tidier would be indefensible.
   *
   * Assigning `.value` bypasses Svelte's `bind:value`, so the input event is
   * dispatched by hand; without it the component's own draft stays empty and
   * the commit on blur has nothing to save.
   */
  function seedField(field: HTMLInputElement) {
    const example = beat?.fill;
    // Never onto a beat already done. Back can land on a finished beat with
    // an empty box beside it, and seeding there would have Next make a
    // SECOND task called "Task 1" - the runaway this was meant to end.
    if (!example || beat?.done(s) || field.value.trim()) return;
    field.value = example;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.select();
  }

  // Re-latch whenever the step changes. `i` is in the dependency list so
  // going back to a step with the same anchor still re-runs.
  $: if (typeof document !== "undefined") void attach(i !== null ? anchorKey : "");

  // The first placement has to guess the bubble's height, because it is
  // computed before the bubble exists. This corrects it the moment the real
  // height is known, rather than leaving it half a step off centre until the
  // next poll. `measure` writes nothing this statement reads, so it settles.
  $: if (groupH && anchorEl) measure();

  onMount(() => {
    scroller = document.querySelector<HTMLElement>(".dash-body");
    scroller?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // The page moves under the tour for reasons it does not see: a task is
    // added, a card expands, the smooth scroll is still running. Cheap
    // enough to just re-check, and far more reliable than trying to observe
    // every cause.
    poll = setInterval(() => {
      // Only while a step is actually anchored. This component is mounted
      // for the life of the window, and the tour runs for two minutes of
      // it, so the check is what keeps this from being a timer that ticks
      // forever for nothing.
      if (i === null || !anchorEl) return;
      // The preferred target may have appeared since we settled for the
      // fallback - add the task the beat was waiting on and its step box
      // exists now. `anchorKey` has not changed, so nothing else would
      // re-run the search, and the ring would sit on the wrong control for
      // the rest of the step.
      // Gone from the page entirely - the "＋ add steps" button replaced by
      // the box it opens, a row re-rendered. Same anchor name, different
      // element, so the upgrade check below cannot see it: re-run the
      // search rather than measuring something detached.
      if (!document.contains(anchorEl)) {
        void attach(anchorKey);
        return;
      }
      if (wantKey && anchorEl.dataset.tour !== wantKey) {
        const better = lookup(wantKey);
        if (better) anchorEl = better;
      }
      measure();
    }, 400);
  });

  onDestroy(() => {
    findToken++;
    scroller?.removeEventListener("scroll", measure);
    window.removeEventListener("resize", measure);
    if (poll) clearInterval(poll);
    if (walkTimer) clearTimeout(walkTimer);
    if (advanceTimer) clearTimeout(advanceTimer);
  });

  /** Is this element part of the tour's own card or bubble? */
  function inTour(el: HTMLElement | null): boolean {
    return !!el?.closest?.(".tourcard, .tour-bubble");
  }

  /**
   * Keys, scoped by WHERE they were pressed.
   *
   * The tour sits over a live app it is actively telling you to use, so a
   * global key handler is a trap. Enter used to page the tour forward from
   * any input anywhere - including the demo task box the "add a task, press
   * Enter" step points at, so following the instruction skipped the step
   * that gave it and you never got to add a step or a tag to what you had
   * just typed.
   *
   * So: Enter only means "next" from a text field in the tour's own card.
   * In the app it belongs to the app, and the Next button is how you move
   * on. Escape leaves an app field alone too - there it usually means
   * "cancel what I am typing", not "abandon the tour".
   */
  /**
   * Next: do the outstanding beat, then move on.
   *
   * Committing what is in the box - the default the tour seeded, or
   * whatever was typed over it - is what makes Next mean the same thing on
   * every beat. Blurring is the commit: the app's own inputs already save
   * on blur, so this goes through the same path a person leaving the field
   * would, rather than a second write path that could drift from it.
   */
  function onNext() {
    if (!beat) {
      tourNext();
      return;
    }
    // Stepped back onto something already done: just move along. Committing
    // again would duplicate it.
    if (beat.done(s)) {
      takeWheel(beatIdx + 1);
      return;
    }
    // Same rule as seeding: only ever act on the beat's OWN control. On a
    // fallback the focused field belongs to something else entirely, and
    // committing it writes the beat's example into the wrong place.
    const onOwn = !beatBlocked;
    const el = document.activeElement;
    if (onOwn && el instanceof HTMLInputElement && el.value.trim()) {
      el.blur();
      return; // the commit advances `autoIdx`, which moves the checklist on
    }
    // BEFORE the generic button case below. The deadline's control is a
    // button too, and letting that branch have it would open the picker
    // sheet instead of setting the default - so Next would ask a question
    // rather than answer one, on the one beat that promised an answer.
    if (beat.id === "remind") {
      const own = ownTask(s);
      // Half an hour is plausible, and trivially changed from the ⏲ after.
      if (own) setRemind({ kind: "main", id: own.id }, "in", 30);
      return;
    }
    // The beat's control is a button, not a field - "＋ add steps" is the
    // way in before a task has any. Press it, then re-latch immediately:
    // the box it reveals answers to the same anchor, and waiting for the
    // 400ms tick to notice would leave the caret nowhere for a beat.
    if (onOwn && anchorEl instanceof HTMLButtonElement) {
      anchorEl.click();
      void attach(anchorKey);
      return;
    }
    takeWheel(beatIdx + 1);
  }

  /** Back walks the checklist before it leaves the page. */
  function onBack() {
    if (beatIdx > 0) {
      takeWheel(beatIdx - 1);
      return;
    }
    tourBack();
  }

  function onKey(e: KeyboardEvent) {
    if (i === null) return;
    const el = e.target as HTMLElement | null;
    const field = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    // Anything with its own use for arrow keys.
    const editing = field || (!!el && (el.tagName === "SELECT" || el.isContentEditable));
    const mine = inTour(el);

    if (e.key === "Enter") {
      // Not from a button: the button's own click already fired, and
      // advancing again would skip a page.
      if (mine && field) tourNext();
      return;
    }
    if (e.key === "Escape") {
      if (mine || !editing) endTour();
      return;
    }
    if (editing) return; // the caret has first claim on the arrows
    if (e.key === "ArrowRight") tourNext();
    if (e.key === "ArrowLeft") tourBack();
  }
</script>

<svelte:window on:keydown={onKey} />

{#if i !== null && step}
  {#if mode === "walk" && !modalUp}
    <!-- ===== WALKING: a ring on the thing, Remi beside it, words in a
         bubble. The layer takes no pointer events so the app underneath
         stays fully usable; only the bubble itself takes them back. ===== -->
    <div class="tour-layer">
      {#if ring}
        <!-- SPOTLIGHT: four panels around the target rather than one overlay
             with a hole in it. A hole needs an SVG mask or a giant
             box-shadow, and neither can blur what is behind it - four
             plain boxes each get their own `backdrop-filter` and leave the
             target completely untouched. All of them are pointer-transparent,
             so the app underneath stays as clickable as it was: the tour
             asks you to USE what it is pointing at, and dimming must never
             become disabling. -->
        <div class="tour-dim" aria-hidden="true">
          <div style="left:0; top:0; right:0; height:{ring.y}px;"></div>
          <div style="left:0; top:{ring.y}px; width:{ring.x}px; height:{ring.h}px;"></div>
          <div style="left:{ring.x + ring.w}px; top:{ring.y}px; right:0; height:{ring.h}px;"></div>
          <div style="left:0; top:{ring.y + ring.h}px; right:0; bottom:0;"></div>
        </div>
        <div
          class="tour-ring"
          aria-hidden="true"
          style="left:{ring.x}px; top:{ring.y}px; width:{ring.w}px; height:{ring.h}px;"
        ></div>
      {/if}

      <div
        class="tour-group"
        class:on-left={side === "left"}
        class:stacked={side === "below" || side === "above"}
        bind:clientHeight={groupH}
        style="transform: translate3d({gx}px, {gy}px, 0); transition-duration: {walking
          ? walkMs
          : 0}ms;"
      >
        <div class="tour-remi" aria-hidden="true">
          <!-- Facing the thing it is talking about. It runs while it moves
               and settles into the step's own pose when it arrives. -->
          <div class="tour-flip" style="transform: scaleX({side === 'left' ? 1 : -1});">
            <Mascot
              mood={walking ? "run" : (step.pose ?? "idle")}
              costume={step.costume ?? null}
              size={REMI_SIZE}
            />
          </div>
        </div>

        <div class="tour-bubble" role="dialog" aria-label="Guided tour">
          <div class="tb-top">
            <span class="tf-count">Step {prog.pos} of {prog.total}</span>
            <button class="tf-x" aria-label="Close the tour" on:click={endTour}>✕</button>
          </div>
          <h2>{step.title}</h2>
          {#each step.body as para (para)}
            <p>{para}</p>
          {/each}

          {#if beats.length}
            <!-- ONE instruction at a time. The list of ticks says how far
                 through you are without making you read four things. -->
            <div class="tb-beats">
              <span class="tb-dots" aria-hidden="true">
                {#each beats as b (b.id)}
                  <i class:on={b.done(s)}></i>
                {/each}
              </span>
              <span class="tb-count">{doneCount} of {beats.length}</span>
            </div>
            {#if beat}
              {#if lastDone}
                <p class="tb-cheer">✓ {lastDone.cheer}</p>
              {/if}
              <p class="tb-do">{beat.text}</p>
              {#if beatBlocked}
                <p class="tb-note">Not there yet - do the one before it first.</p>
              {/if}
            {:else}
              <p class="tb-cheer">✓ {lastDone?.cheer}</p>
              <p class="tb-do">That is a whole task. Everything else is a variation on it.</p>
            {/if}
          {/if}

          {#if step.aside}
            <p class="tf-aside">{step.aside}</p>
          {/if}
          <div class="tb-acts">
            <button class="tf-ghost sm" on:click={endTour}>Skip</button>
            <span class="tf-spacer"></span>
            {#if i > 0 || beatIdx > 0}
              <button class="tf-ghost sm" on:click={onBack}>Back</button>
            {/if}
            <button class="tf-next sm" class:ready={allBeatsDone} on:click={onNext}>
              {beat ? "Next" : lastStep ? "Finish" : "Next"}
            </button>
          </div>
          <div class="tf-bar" aria-hidden="true">
            <span style="width:{(prog.pos / prog.total) * 100}%"></span>
          </div>
        </div>
      </div>
    </div>
  {:else if mode === "card"}
    <!-- ===== CARD: the steps that ask something, and the fallback for a
         walking step whose element could not be found. ===== -->
    <div class="tour-scrim">
      <div class="tourcard" role="dialog" aria-modal="true" aria-label="Guided tour">
        <div class="tf-top">
          <span class="tf-count">Step {prog.pos} of {prog.total}</span>
          <!-- A named way out at the top as well as the bottom. Someone who
               has decided not to do this should not have to read to the end
               of the page to find that out. -->
          <button class="tf-skip" on:click={endTour}>Skip tour</button>
          <button class="tf-x" aria-label="Close the tour" on:click={endTour}>✕</button>
        </div>

        <!-- OUTSIDE the scrolling body on purpose. As the first child of the
             scroller the mouse scrolled away the moment a page had any
             height to it, so the costume picker was choosing an outfit for
             something you had to scroll back up to see. `costume` falls
             through to the user's own pick when a step does not set one,
             which is what makes the costume page show the choice live. -->
        <div class="tf-face">
          <Mascot
            mood={step.pose ?? (step.ask ? "ready" : "idle")}
            costume={step.costume ?? null}
            size={110}
          />
        </div>

        <div class="tf-body">
          <div class="tf-card">
            <h2>{step.title}</h2>
            {#each step.body as para (para)}
              <p>{para}</p>
            {/each}

            {#if step.ask === "nick"}
              <div class="tf-ask">
                <label class="tf-lbl" for="tour-nick">Nickname</label>
                <!-- svelte-ignore a11y-autofocus -->
                <input
                  id="tour-nick"
                  class="tf-name"
                  autofocus
                  type="text"
                  maxlength={NAME_MAX}
                  placeholder="Nickname"
                  value={s.userName}
                  on:input={(e) => setUserName(e.currentTarget.value)}
                />
                <p class="tf-note">
                  {#if s.userName}
                    Remi will say "Good morning, {s.userName}".
                  {:else}
                    Left empty, nothing anywhere says a name.
                  {/if}
                </p>
              </div>
            {:else if step.ask === "fullname"}
              <div class="tf-ask">
                <label class="tf-lbl" for="tour-full">Full Name</label>
                <!-- svelte-ignore a11y-autofocus -->
                <input
                  id="tour-full"
                  class="tf-name"
                  autofocus
                  type="text"
                  maxlength={FULL_NAME_MAX}
                  placeholder="Full Name"
                  value={s.fullName}
                  on:input={(e) => setFullName(e.currentTarget.value)}
                />
              </div>
            {:else if step.ask === "mascot"}
              <div class="tf-ask tf-prefs">
                <!-- Answering "no" here drops the two pages that follow, so
                     nobody is asked what an absent mouse should wear. -->
                <label class="tf-pref">
                  <input
                    type="checkbox"
                    checked={s.mascotOn}
                    on:change={() => setFlag("mascotOn", !s.mascotOn)}
                  />
                  <span>
                    <span class="tp-l">Show Remi</span>
                    <span class="tp-h">
                      {#if s.mascotOn}
                        On. The next two pages are about the outfit and the wandering.
                      {:else}
                        Off. The app runs exactly the same, without the mouse.
                      {/if}
                    </span>
                  </span>
                </label>
              </div>
            {:else if step.ask === "mouse"}
              <div class="tf-ask">
                <label class="tf-lbl" for="tour-costume">Outfit</label>
                <select
                  id="tour-costume"
                  class="tf-name"
                  value={s.mascotCostume}
                  on:change={(e) => pickCostume(e.currentTarget.value)}
                >
                  {#each COSTUMES as [key, label] (key)}
                    <option value={key}>{label}</option>
                  {/each}
                </select>
                <p class="tf-note">The mouse above is wearing it.</p>
                <label class="tf-pref">
                  <input
                    type="checkbox"
                    checked={s.roamOn}
                    on:change={() => setFlag("roamOn", !s.roamOn)}
                  />
                  <span>
                    <span class="tp-l">Let me wander the dashboard</span>
                    <span class="tp-h">Clicks pass straight through me.</span>
                  </span>
                </label>
              </div>
            {:else if step.ask === "look"}
              <div class="tf-ask tf-prefs">
                <div class="tf-row">
                  <span class="tp-l">Mode</span>
                  <span class="seg-inline">
                    <button class:on={s.mode === "light"} on:click={() => setMode("light")}>
                      ☀ Light
                    </button>
                    <button class:on={s.mode === "dark"} on:click={() => setMode("dark")}>
                      ☾ Dark
                    </button>
                  </span>
                </div>
                <div class="tf-row">
                  <span class="tp-l">Colour</span>
                  <span class="tf-sw">
                    {#each ACCENTS as [name, hex] (name)}
                      <button
                        class="acc-sw"
                        class:on={s.accent === name}
                        style="background:{hex}"
                        title={name}
                        aria-label={name}
                        on:click={() => setAccent(name)}
                      ></button>
                    {/each}
                  </span>
                </div>
              </div>
            {:else if step.ask === "wellness"}
              <div class="tf-ask tf-prefs">
                {#each WELLNESS as key (key)}
                  {@const c = s.wellness[key]}
                  {@const copy = wellnessCopy(key)}
                  <!-- The interval appears the moment one is ticked. "Stand
                       up" without "how often" is half an answer, and finding
                       out it meant every 60 minutes only once it starts
                       interrupting you is the wrong time to find out. -->
                  <div class="tf-pref" class:on={c.on}>
                    <label class="tf-prefmain">
                      <input
                        type="checkbox"
                        checked={c.on}
                        on:change={() => toggleWellness(key, !c.on)}
                      />
                      <span>
                        <span class="tp-l">{copy.icon} {copy.title}</span>
                        <span class="tp-h">{copy.msg}</span>
                      </span>
                    </label>
                    {#if c.on && key === "lunch"}
                      <select
                        class="tf-when"
                        aria-label="{copy.title} time"
                        value={String(c.atHour ?? 13)}
                        on:change={(e) => setWellnessHour(key, Number(e.currentTarget.value))}
                      >
                        {#each [11, 12, 13, 14] as h (h)}
                          <option value={String(h)}>at {clockLabel(h, 0)}</option>
                        {/each}
                      </select>
                    {:else if c.on}
                      <select
                        class="tf-when"
                        aria-label="{copy.title} interval"
                        value={String(c.everyMin ?? 60)}
                        on:change={(e) => setWellnessEvery(key, Number(e.currentTarget.value))}
                      >
                        {#each [30, 45, 60, 90, 120] as o (o)}
                          <option value={String(o)}>every {o < 60 ? `${o}m` : `${o / 60}h`}</option>
                        {/each}
                      </select>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else if step.ask === "tray"}
              <div class="tf-ask">
                <button class="tf-send" on:click={openPopover}>Open it from the menu bar</button>
                <p class="tf-note">
                  It drops down under the mouse in your menu bar. Click anywhere else and it goes
                  away again - your work carries on either way.
                </p>
              </div>
            {:else if step.ask === "notify"}
              <div class="tf-ask">
                <button class="tf-send" on:click={previewNotifications}>
                  Send me a deadline and a water nudge
                </button>
                <p class="tf-note">
                  Two real notifications, a second apart - the kind a deadline sends, then the kind
                  a wellness nudge sends. The second also shows the in-app card, since that one
                  arrives both ways.
                </p>
              </div>
            {:else if step.ask === "prefs"}
              <div class="tf-ask tf-prefs">
                {#each PREFS as pref (pref.key)}
                  <label class="tf-pref">
                    <input
                      type="checkbox"
                      checked={s[pref.key]}
                      on:change={() => setFlag(pref.key, !s[pref.key])}
                    />
                    <span>
                      <span class="tp-l">{pref.label}</span>
                      <span class="tp-h">{pref.hint}</span>
                    </span>
                  </label>
                {/each}
                <p class="tf-note">
                  {#if first}
                    All off unless you say otherwise.
                  {:else}
                    These are your current settings. Change what you like, or leave them and carry
                    on.
                  {/if}
                </p>
              </div>
            {/if}

            {#if step.aside}
              <p class="tf-aside">{step.aside}</p>
            {/if}
          </div>
        </div>

        <div class="tf-bar" aria-hidden="true">
          <span style="width:{(prog.pos / prog.total) * 100}%"></span>
        </div>

        <div class="tf-acts">
          <!-- Kept alongside the one at the top on purpose. They are read at
               different moments: the top one before you start reading a page,
               this one after you have. -->
          <button class="tf-ghost" on:click={endTour}>
            {lastStep ? "Done" : "Skip the tour"}
          </button>
          <span class="tf-spacer"></span>
          {#if i > 0}
            <button class="tf-ghost" on:click={tourBack}>Back</button>
          {/if}
          <button class="tf-next" on:click={tourNext}>
            {lastStep ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  /* ================= WALKING ================= */
  /* Takes NO pointer events: the tour points at things you are meant to be
     able to press, so the layer must never stand between you and them. The
     bubble takes them back for its own buttons. */
  .tour-layer {
    position: fixed;
    inset: 0;
    z-index: 300;
    pointer-events: none;
  }
  /* Everything that is NOT the target, softened. Blur rather than a heavy
     dim: the surroundings stay recognisable as context while stopping
     being somewhere the eye can land. */
  .tour-dim > div {
    position: absolute;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(2.5px);
    transition:
      left 220ms ease,
      top 220ms ease,
      width 220ms ease,
      height 220ms ease;
  }
  /* The thing being described, ringed inside the gap in the blur. */
  .tour-ring {
    position: absolute;
    border: 2px solid var(--accent);
    border-radius: 12px;
    box-shadow:
      0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent),
      0 8px 26px -12px rgba(0, 0, 0, 0.5);
    transition:
      left 220ms ease,
      top 220ms ease,
      width 220ms ease,
      height 220ms ease;
  }
  .tour-group {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.34, 0.02, 0.28, 1);
    will-change: transform;
  }
  /* Standing on the far side, so the mouse is always between the bubble and
     the thing it is pointing at. */
  .tour-group.on-left {
    flex-direction: row-reverse;
  }
  .tour-group.stacked {
    align-items: flex-end;
  }
  .tour-remi {
    flex: none;
  }
  .tour-flip {
    transition: transform 160ms ease;
  }
  .tour-bubble {
    pointer-events: auto;
    width: 330px;
    box-sizing: border-box;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 12px 14px 10px;
    box-shadow: 0 18px 44px -18px rgba(0, 0, 0, 0.55);
  }
  .tb-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .tb-top .tf-count {
    margin-right: auto;
  }
  .tour-bubble h2 {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 16px;
    color: var(--ink);
    margin: 0 0 6px;
  }
  .tour-bubble p {
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--ink-soft);
    margin: 0 0 8px;
  }
  /* The checklist: a row of ticks, then the ONE thing to do next. */
  .tb-beats {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 6px;
  }
  .tb-dots {
    display: flex;
    gap: 4px;
  }
  .tb-dots i {
    width: 18px;
    height: 4px;
    border-radius: 2px;
    background: var(--line);
    transition: background 200ms ease;
  }
  .tb-dots i.on {
    background: var(--accent);
  }
  .tb-count {
    font-family: var(--font-num);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .tour-bubble .tb-cheer {
    font-size: 12px;
    color: var(--success-ink);
    margin: 0 0 4px;
  }
  .tour-bubble .tb-note {
    font-size: 11.5px;
    color: var(--ink-faint);
    margin: 0 0 4px;
  }
  .tour-bubble .tb-do {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 4px;
  }
  /* Once every beat is done, Next is the obvious thing to press. */
  .tf-next.ready {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .tf-send {
    width: 100%;
    padding: 11px 13px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .tf-send:hover {
    filter: brightness(1.06);
  }
  .tb-acts {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 10px 0 8px;
  }
  .sm {
    padding: 6px 11px !important;
    font-size: 12px !important;
  }
  .tour-bubble .tf-bar {
    margin: 0;
  }

  /* ================= CARD ================= */
  /* Soft, not opaque: the demo day the tour is describing stays readable
     behind the questions. */
  .tour-scrim {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(20, 16, 12, 0.34);
  }
  .tourcard {
    width: min(520px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 18px;
    box-shadow: var(--shadow);
  }
  .tf-top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 18px 0;
  }
  .tf-top .tf-count {
    margin-right: auto;
  }
  .tf-skip {
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
    border-radius: 999px;
    padding: 4px 11px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .tf-skip:hover {
    color: var(--ink);
    border-color: var(--accent);
  }
  .tf-count {
    font-family: var(--font-num);
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .tf-x {
    border: none;
    background: none;
    color: var(--ink-faint);
    font-size: 15px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 8px;
  }
  .tf-x:hover {
    color: var(--ink);
    background: var(--card);
  }
  /* Fixed height so the mouse does not jump between pages as the body
     under it grows and shrinks. */
  .tf-face {
    flex: none;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    height: 118px;
    padding-top: 6px;
  }
  .tf-body {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 24px;
    overflow-y: auto;
  }
  .tf-card {
    width: 100%;
    text-align: center;
  }
  .tf-card h2 {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 21px;
    color: var(--ink);
    margin: 0 0 10px;
  }
  .tf-card p {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--ink-soft);
    margin: 0 0 10px;
  }
  .tf-aside {
    font-size: 12px;
    color: var(--ink-faint);
    border-left: 2px solid var(--accent);
    padding-left: 10px;
    text-align: left;
    margin-top: 14px;
  }
  .tf-ask {
    margin: 16px 0 4px;
    text-align: left;
  }
  .tf-name {
    width: 100%;
    padding: 11px 13px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    color: var(--ink);
    font-size: 15px;
  }
  .tf-name:focus {
    outline: none;
    border-color: var(--accent);
  }
  .tf-note {
    font-size: 11.5px;
    color: var(--ink-faint);
    margin: 10px 0 18px;
  }
  .tf-lbl {
    display: block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin-bottom: 6px;
  }
  .tf-prefs {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tf-pref {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    cursor: pointer;
  }
  .tf-pref:hover {
    border-color: var(--accent);
  }
  .tf-pref input {
    margin-top: 2px;
    flex: none;
  }
  /* A wellness row is a label AND a picker, so the label takes the click
     and the row is the container. */
  .tf-pref.on {
    border-color: var(--accent);
    flex-wrap: wrap;
  }
  .tf-prefmain {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .tf-when {
    flex: none;
    align-self: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-num);
    font-size: 11.5px;
    padding: 5px 7px;
  }
  .tp-l {
    display: block;
    font-weight: 600;
    font-size: 13px;
    color: var(--ink);
  }
  .tp-h {
    display: block;
    font-size: 11.5px;
    color: var(--ink-soft);
    margin-top: 2px;
  }
  .tf-bar {
    height: 3px;
    background: var(--line);
    margin: 0 18px;
    border-radius: 2px;
    overflow: hidden;
  }
  .tf-bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 220ms ease;
  }
  .tf-acts {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 18px 18px;
  }
  .tf-spacer {
    flex: 1;
  }
  .tf-ghost,
  .tf-next {
    border-radius: 10px;
    padding: 9px 15px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
  }
  .tf-ghost:hover {
    color: var(--ink);
    border-color: var(--accent);
  }
  .tf-next {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .tf-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
  }
  .tf-sw {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .tour-group,
    .tour-ring,
    .tour-flip,
    .tour-dim > div {
      transition: none !important;
    }
  }
</style>
