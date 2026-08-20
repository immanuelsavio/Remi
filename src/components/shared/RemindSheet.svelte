<script lang="ts">
  /**
   * The reminder picker: three ways to say when, because people think about
   * "later" in three different ways.
   *
   *   In - a duration from now ("in 30 minutes")
   *   By - a clock time today, rolling to tomorrow if it has already passed
   *   On - an explicit date and time
   *
   * Rendered once per window at the root; `remindTarget` decides whether it
   * is on screen and what it is editing.
   */
  import { app, closeRemind, remindTarget, setRemind, showToast } from "../../store";

  $: s = $app;
  $: t = $remindTarget;

  /** The live reminder on whatever is being edited, so "Clear" can appear. */
  $: current =
    t === null
      ? null
      : t.kind === "main"
        ? (s.mains.find((m) => m.id === t.id)?.remind ?? null)
        : t.kind === "sub"
          ? (s.mains.find((m) => m.id === t.mainId)?.subs.find((x) => x.id === t.id)?.remind ??
            null)
          : (s.backlog.find((b) => b.id === t.id)?.remind ?? null);

  let inH = "";
  let inM = "";
  let byTime = "";
  let onDT = "";

  /** Default the "On" field to an hour from now, and floor the picker there
      too, so a past datetime cannot be chosen by accident. */
  function localStamp(at: number): string {
    const d = new Date(at);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  $: if (t && !onDT) onDT = localStamp(Date.now() + 3_600_000);

  function set(kind: "in" | "by" | "on" | "clear", raw: string | number) {
    if (!t) return;
    const ref =
      t.kind === "sub"
        ? ({ kind: "sub", mainId: t.mainId, id: t.id } as const)
        : ({ kind: t.kind, id: t.id } as const);
    setRemind(ref, kind, raw);
    reset();
  }

  function reset() {
    inH = "";
    inM = "";
    byTime = "";
    onDT = "";
    closeRemind();
  }

  function setCustomIn() {
    const mins = (Number(inH) || 0) * 60 + (Number(inM) || 0);
    if (mins < 1) {
      showToast("Enter hours or minutes");
      return;
    }
    set("in", mins);
  }

  function setBy() {
    if (!byTime) {
      showToast("Pick a time");
      return;
    }
    set("by", byTime);
  }

  function setOn() {
    if (!onDT) {
      showToast("Pick a date & time");
      return;
    }
    if (new Date(onDT).getTime() <= Date.now()) {
      showToast("Pick a future time");
      return;
    }
    set("on", onDT);
  }
</script>

{#if t}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="scrim" on:click|self={reset}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Set a reminder">
      <div class="s-in">
        <h3>Remind me</h3>
        <div class="s-text">
          “{t.title}”{#if current}
            · now: <b>{current.label}</b>{/if}
        </div>

        <div class="rem-grp">
          <div class="rem-lbl">In</div>
          <div class="rem-opts" style="grid-template-columns:1fr 1fr;">
            <button on:click={() => set("in", 30)}>30 min</button>
            <button on:click={() => set("in", 60)}>1 hour</button>
          </div>
          <div class="rem-custom">
            <input type="number" min="0" max="99" placeholder="hrs" bind:value={inH} />
            <input type="number" min="0" max="59" placeholder="min" bind:value={inM} />
            <button class="rem-set" on:click={setCustomIn}>Set</button>
          </div>
        </div>

        <div class="rem-grp">
          <div class="rem-lbl">By (today, or tomorrow if past)</div>
          <div class="rem-opts" style="grid-template-columns:1fr 1fr;">
            <button on:click={() => set("by", "14:00")}>2pm</button>
            <button on:click={() => set("by", "16:00")}>4pm</button>
          </div>
          <div class="rem-custom">
            <input type="time" bind:value={byTime} />
            <button class="rem-set" on:click={setBy}>Set</button>
          </div>
        </div>

        <div class="rem-grp">
          <div class="rem-lbl">On (date &amp; time)</div>
          <div class="rem-custom">
            <input type="datetime-local" min={localStamp(Date.now())} bind:value={onDT} />
            <button class="rem-set" on:click={setOn}>Set</button>
          </div>
        </div>

        {#if current}
          <button class="rem-clear" on:click={() => set("clear", "")}>Clear reminder</button>
        {/if}
        <button class="checkin-no" style="margin-top:9px;" on:click={reset}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
