<script lang="ts">
  /**
   * DATA - version and updates, backup, restore, import, feedback and the
   * usage-logging switch.
   *
   * Restore takes a FILE, not pasted text. Pasting a multi-megabyte backup
   * into a textarea is miserable and truncates silently; a file picker also
   * lets us reject anything that isn't a `.json` before it is ever parsed.
   */
  import {
    app,
    exportBackup,
    exportLogs,
    exportWorkRecord,
    openDataFolder,
    restoreBackup,
    setFeedback,
    setFlag,
    showToast,
  } from "../../../store";
  import ImportSheet from "../ImportSheet.svelte";
  import UpdateCard from "../UpdateCard.svelte";
  import type { ReportRange } from "../../../store";
  import { allTags } from "../../../view";

  export let dataFolder: string;

  /** Lifted to the router: this tab is destroyed and recreated on every tab
      switch, but these drafts must survive that round trip. */
  export let importText = "";
  export let restoreText = "";
  export let confirmRestore = false;

  let importOpen = false;
  let restoring = false;
  let restoreName = "";
  let restoreError = "";
  let fileInput: HTMLInputElement | null = null;
  let feedbackDraft = "";
  let feedbackSeeded = false;

  // Work record
  const RANGES: { value: ReportRange; label: string }[] = [
    { value: "all", label: "Entire history" },
    { value: "year", label: "This year" },
    { value: "month", label: "This month" },
    { value: "custom", label: "Custom" },
  ];
  let range: ReportRange = "all";
  let customFrom = "";
  let customTo = "";
  let withInterruptions = true;
  let exporting = false;
  let reportTags: string[] = [];
  $: knownTags = allTags([...s.mains, ...s.history.flatMap((h) => h.completed)]);

  $: s = $app;
  $: dayBuckets = Object.keys(s.metrics.days).length;
  // Seed once from state, then leave the textarea alone - re-seeding on
  // every store tick would fight the user's cursor while they type.
  $: if (!feedbackSeeded && s) {
    feedbackDraft = s.feedback;
    feedbackSeeded = true;
  }

  function pickFile(e: Event) {
    restoreError = "";
    confirmRestore = false;
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    // A JSON backup is the only thing this accepts. Checked by extension
    // AND by parsing below - the extension stops an obvious mistake, the
    // parse stops a renamed one.
    if (!/\.json$/i.test(f.name)) {
      restoreName = "";
      restoreText = "";
      restoreError = `“${f.name}” isn't a .json backup. Export one from Remi and pick that file.`;
      return;
    }
    const r = new FileReader();
    r.onerror = () => {
      restoreError = "Couldn't read that file.";
    };
    r.onload = () => {
      const text = String(r.result ?? "");
      try {
        JSON.parse(text);
      } catch {
        restoreName = "";
        restoreText = "";
        restoreError = `“${f.name}” has a .json name but isn't valid JSON.`;
        return;
      }
      restoreName = f.name;
      restoreText = text;
    };
    r.readAsText(f);
  }

  function clearPick() {
    restoreText = "";
    restoreName = "";
    restoreError = "";
    confirmRestore = false;
    if (fileInput) fileInput.value = "";
  }
</script>

<div class="dsec-title">Data</div>
<div class="dsec-sub">
  Everything lives in a plain JSON file on this machine. Nothing is uploaded anywhere.
</div>

<UpdateCard />

<div class="bk-card">
  <h4>Where your data lives</h4>
  <p class="bk-name" style="font-family:var(--font-num); overflow-wrap:anywhere;">
    {dataFolder || "…"}
  </p>
  <div class="bk-actions">
    <button class="bk-btn ghost" on:click={openDataFolder}>⧉ Open folder</button>
  </div>
</div>

<div class="bk-card">
  <h4>Export a work record</h4>
  <p>
    A printable record of what you actually finished — tasks, the focused time each took, and
    anything left open. Opens in your browser, where <b>Print → Save as PDF</b> gives you a file to keep
    or send.
  </p>

  <div class="seg-inline" style="flex-wrap:wrap;">
    {#each RANGES as r (r.value)}
      <button class:on={range === r.value} on:click={() => (range = r.value)}>{r.label}</button>
    {/each}
  </div>

  {#if range === "custom"}
    <div class="imp-row">
      <span class="imp-note">From</span>
      <input class="num-in" style="width:auto;" type="date" bind:value={customFrom} />
      <span class="imp-note">to</span>
      <input class="num-in" style="width:auto;" type="date" bind:value={customTo} />
    </div>
  {/if}

  {#if knownTags.length}
    <div class="grouplbl">Filter by tag</div>
    <div class="tagpick">
      {#each knownTags as t (t)}
        <button
          class="tagchip"
          class:on={reportTags.includes(t)}
          on:click={() =>
            (reportTags = reportTags.includes(t)
              ? reportTags.filter((x) => x !== t)
              : [...reportTags, t])}>#{t}</button
        >
      {/each}
      {#if reportTags.length}
        <button class="tagchip clear" on:click={() => (reportTags = [])}>clear</button>
      {/if}
    </div>
    <p class="imp-note">
      {#if reportTags.length}
        Only work tagged {reportTags.map((t) => `#${t}`).join(" and ")} — daily totals are recalculated
        to match, so the report never claims hours it hasn't shown.
      {:else}
        No filter — everything is included.
      {/if}
    </p>
  {/if}

  <div class="imp-row">
    <button
      class="pill-switch"
      class:on={withInterruptions}
      role="switch"
      aria-checked={withInterruptions}
      aria-label="Include interruptions"
      on:click={() => (withInterruptions = !withInterruptions)}
    >
      <span class="ps-track"><span class="ps-knob"></span></span>
      <span class="ps-lbl">Include interruptions</span>
    </button>
  </div>
  <p class="imp-note">
    The interruption section names what pulled you away and which task paid for it. Leave it off if
    the record is going to someone who doesn't need that detail.
  </p>

  <div class="bk-actions" style="margin-top:12px;">
    <button
      class="bk-btn"
      disabled={exporting || (range === "custom" && !(customFrom && customTo))}
      on:click={async () => {
        exporting = true;
        await exportWorkRecord(
          range,
          withInterruptions,
          { from: customFrom, to: customTo },
          reportTags,
        );
        exporting = false;
      }}>{exporting ? "Building…" : "⇪ Export work record"}</button
    >
  </div>
</div>

<div class="bk-card">
  <h4>Create a backup</h4>
  <p>
    Writes a timestamped <b>.json</b> with all your days, tasks, steps, notes, backlog, history and settings.
  </p>
  <div class="bk-actions"><button class="bk-btn" on:click={exportBackup}>⬇ Backup now</button></div>
</div>

<div class="bk-card">
  <h4>Restore from a backup</h4>
  <p>
    Pick a <b>.json</b> backup Remi exported earlier. This <b>replaces</b> your current state; the data
    folder itself is machine-local and is not restored.
  </p>

  <div class="bk-actions">
    <button class="bk-btn ghost" on:click={() => fileInput?.click()}>⬆ Choose a backup file…</button
    >
    <input
      bind:this={fileInput}
      type="file"
      accept=".json,application/json"
      style="display:none"
      on:change={pickFile}
    />
    {#if restoreName}
      <button class="bk-btn ghost" on:click={clearPick}>Clear</button>
    {/if}
  </div>

  {#if restoreError}
    <div class="imp-err" style="margin-top:10px;">{restoreError}</div>
  {/if}

  {#if restoreName}
    <div class="bk-row" style="margin-top:10px;">
      <span class="bk-name">{restoreName}</span>
      <span class="imp-note">{(restoreText.length / 1024).toFixed(0)} KB · valid JSON</span>
    </div>

    {#if !confirmRestore}
      <div class="bk-actions">
        <button class="bk-btn ghost" on:click={() => (confirmRestore = true)}>Restore…</button>
      </div>
    {:else}
      <div class="imp-err">This replaces everything currently tracked. Are you sure?</div>
      <div class="bk-actions">
        <button class="bk-btn ghost" on:click={() => (confirmRestore = false)}>Cancel</button>
        <button
          class="bk-btn"
          style="background:var(--danger); border-color:var(--danger);"
          disabled={restoring}
          on:click={async () => {
            restoring = true;
            const result = await restoreBackup(restoreText);
            restoring = false;
            // Clear ONLY on a confirmed success - a rejected restore keeps
            // the chosen file so it can be retried without picking again.
            if (result.ok) clearPick();
            else confirmRestore = false;
          }}
        >
          {restoring ? "Restoring…" : "Yes, replace my data"}
        </button>
      </div>
    {/if}
  {/if}
</div>

<div class="bk-card">
  <h4>Import a task list</h4>
  <p>Turn an assistant's task list, or a plain text file, into a real day.</p>
  <div class="bk-actions">
    <button class="bk-btn ghost" on:click={() => (importOpen = true)}>⇪ Import a task list</button>
  </div>
</div>

<div class="bk-card">
  <h4>Something wrong? Tell us</h4>
  <p>
    Anything broken, confusing or missing. This is saved with your logs, so when you export them
    below your note goes along with them — it is the one part of the export that contains your own
    words, and nothing is sent anywhere until you hand the file over yourself.
  </p>
  <textarea
    class="imp-text"
    style="min-height:110px; margin-top:0;"
    maxlength="4000"
    placeholder="What happened? What did you expect instead?"
    bind:value={feedbackDraft}
    on:blur={() => setFeedback(feedbackDraft)}
  ></textarea>
  <div class="bk-actions" style="margin-top:10px;">
    <button
      class="bk-btn ghost"
      on:click={() => {
        setFeedback(feedbackDraft);
        showToast("Saved — it'll go out with your next log export");
      }}>Save note</button
    >
    {#if s.feedback}
      <button
        class="bk-btn ghost"
        on:click={() => {
          feedbackDraft = "";
          setFeedback("");
        }}>Clear</button
      >
    {/if}
  </div>
</div>

<div class="bk-card">
  <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
    <h4 style="margin:0;">Usage logs</h4>
    <button
      class="pill-switch"
      class:on={s.loggingOptIn}
      role="switch"
      aria-checked={s.loggingOptIn}
      aria-label="Usage logging"
      on:click={() => setFlag("loggingOptIn", !s.loggingOptIn)}
    >
      <span class="ps-track"><span class="ps-knob"></span></span>
      <span class="ps-lbl">{s.loggingOptIn ? "Logging on" : "Logging off"}</span>
    </button>
  </div>
  <p style="margin-top:10px;">
    Anonymous, <b>day-by-day</b> record of how the app is used: buttons and screens, feature counts,
    friction signals and errors.
    <b>No task titles, notes, steps, backlog or reminder text is ever included.</b>
    On by default during the beta; switch it off and collection stops immediately.
  </p>
  <p class="imp-note">
    {dayBuckets} day bucket{dayBuckets === 1 ? "" : "s"} · {s.metrics.errors.length} error{s.metrics
      .errors.length === 1
      ? ""
      : "s"} recorded{#if s.feedback}
      · your note is included{/if}.
  </p>
  <div class="bk-actions" style="margin-top:12px;">
    <button class="bk-btn" disabled={!s.loggingOptIn && !s.feedback} on:click={exportLogs}
      >⬇ Export logs</button
    >
  </div>
</div>

<ImportSheet bind:open={importOpen} bind:text={importText} />

<style>
  .tagpick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .tagchip {
    font-family: var(--font-num);
    font-size: 11px;
    font-weight: 600;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
    border-radius: 999px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .tagchip:hover {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .tagchip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .tagchip.clear {
    color: var(--danger);
    border-style: dashed;
  }
</style>
