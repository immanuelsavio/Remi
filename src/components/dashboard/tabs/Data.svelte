<script lang="ts">
  import {
    app,
    applyImport,
    exportBackup,
    exportLogs,
    openDataFolder,
    restoreBackup,
    setFlag,
  } from "../../../store";
  import { IMPORT_PROMPT, parseImport } from "../../../view";
  import type { ParsedImport } from "../../../view";

  export let dataFolder: string;

  $: s = $app;

  // Lifted to the router and passed down bound: this tab is destroyed and
  // recreated on every tab switch, but in the original single-file component
  // these drafts lived at the top level and survived switching tabs.
  export let importText = "";
  export let importPreview: ParsedImport | null = null;
  export let restoreText = "";
  export let confirmRestore = false;
</script>

<div class="wrap">
  <h1>Your data</h1>
  <p class="muted">
    Everything is a plain JSON file on this machine. Nothing is uploaded anywhere.
  </p>

  <div class="line">
    <span class="grow">
      Data folder
      <div class="muted small mono">{dataFolder || "…"}</div>
    </span>
    <button class="btn small" on:click={openDataFolder}>Open folder</button>
    <button class="btn small" on:click={exportBackup}>Export backup</button>
  </div>

  <h2>Import a plan</h2>
  <p class="muted small">
    Paste the structured format below - handy for turning an assistant's task list into a real day.
  </p>
  <details>
    <summary class="muted small">Show the prompt to copy</summary>
    <pre class="prompt">{IMPORT_PROMPT}</pre>
  </details>
  <textarea class="in" rows="6" placeholder="Paste your task list here…" bind:value={importText}
  ></textarea>
  <div class="row">
    <button
      class="btn"
      on:click={() => (importPreview = importText.trim() ? parseImport(importText) : null)}
    >
      Preview
    </button>
    {#if importPreview}
      <button
        class="btn accent"
        on:click={() => {
          if (!importPreview) return;
          applyImport(importPreview);
          importPreview = null;
          importText = "";
        }}
      >
        Add {importPreview.mains.length} task{importPreview.mains.length === 1 ? "" : "s"}
      </button>
      <button class="btn" on:click={() => (importPreview = null)}>Cancel</button>
    {/if}
  </div>
  {#if importPreview}
    <div class="card">
      {#each importPreview.mains as m (m.title)}
        <div>
          <b>{m.title}</b>
          {#if m.remind}<span class="badge">⏲ {m.remind.short}</span>{/if}
        </div>
        {#each m.subs as sub (sub.title)}
          <div class="muted small indent">
            {sub.title}
            {#if sub.remind}<span class="badge">⏲ {sub.remind.short}</span>{/if}
          </div>
        {/each}
      {/each}
      {#each importPreview.backlog as b (b.title)}
        <div class="muted small">backlog: {b.title}</div>
      {/each}
      {#each importPreview.errors as e (e)}
        <div class="note">{e}</div>
      {/each}
    </div>
  {/if}

  <h2>Usage logging</h2>
  <p class="muted small">
    Off by default. When on, Remi counts what you click and where the interface seems to confuse you
    - <b>counts and settings only</b>. Task names, notes, backlog text and reminder text are never
    recorded.
  </p>
  <div class="line">
    <span class="grow">
      Anonymous usage logging
      <div class="muted small">
        {Object.keys(s.metrics.days).length} day bucket{Object.keys(s.metrics.days).length === 1
          ? ""
          : "s"} · {s.metrics.errors.length} error{s.metrics.errors.length === 1 ? "" : "s"}
        recorded
      </div>
    </span>
    <button class="btn small" on:click={() => setFlag("loggingOptIn", !s.loggingOptIn)}>
      {s.loggingOptIn ? "On" : "Off"}
    </button>
    <button class="btn small" disabled={!s.loggingOptIn} on:click={exportLogs}>
      Export logs
    </button>
  </div>

  <h2>Restore a backup</h2>
  <p class="muted small">
    Paste the contents of an exported backup. This REPLACES today's state; the data folder itself is
    machine-local and is not restored.
  </p>
  <textarea
    class="in"
    rows="4"
    placeholder="Paste backup JSON…"
    bind:value={restoreText}
    on:input={() => (confirmRestore = false)}
  ></textarea>
  {#if !confirmRestore}
    <button class="btn" disabled={!restoreText.trim()} on:click={() => (confirmRestore = true)}>
      Restore…
    </button>
  {:else}
    <p class="muted small">This replaces everything currently tracked today. Are you sure?</p>
    <div class="row">
      <button class="btn" on:click={() => (confirmRestore = false)}>Cancel</button>
      <button
        class="btn danger-btn"
        on:click={() => {
          restoreBackup(restoreText);
          restoreText = "";
          confirmRestore = false;
        }}
      >
        Yes, replace today's state
      </button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    padding: 20px 26px 48px;
    max-width: 1040px;
  }
  h1 {
    font-size: 26px;
    letter-spacing: -0.02em;
    margin: 0 0 4px;
  }
  h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--ink-soft);
    margin: 26px 0 8px;
  }
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-num);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 9px;
    margin-top: 9px;
    flex-wrap: wrap;
  }
  .indent {
    padding-left: 16px;
  }
  .card {
    margin: 11px 0;
    padding: 13px;
    border-radius: var(--r-md);
    background: var(--card);
    border: 1px solid var(--line);
  }
  .note {
    font-size: 12px;
    color: var(--warn-ink);
    margin-top: 4px;
  }
  .badge {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--pill-bg);
    color: var(--accent-ink);
    white-space: nowrap;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 2px;
    border-bottom: 1px solid var(--line);
  }
  .prompt {
    font-family: var(--font-num);
    font-size: 11px;
    white-space: pre-wrap;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 10px;
    max-height: 220px;
    overflow: auto;
  }
</style>
