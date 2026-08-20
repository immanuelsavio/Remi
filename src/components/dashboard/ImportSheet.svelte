<script lang="ts">
  /**
   * Import a task list, typically pasted out of an LLM.
   *
   * The copy-the-prompt button is the load-bearing part: getting a model to
   * emit the exact indented shape the parser wants is the whole difficulty,
   * so we hand the user the prompt rather than documenting a format.
   *
   * Preview before Add, always. An import can create a dozen tasks at once,
   * and a mis-indented paste that silently swallows everything into one task
   * is worse than an error.
   */
  import { applyImport, showToast } from "../../store";
  import { IMPORT_PROMPT, parseImport } from "../../view";
  import type { ParsedImport } from "../../view";

  /** Bound by the parent so the paste survives closing and reopening. */
  export let text: string;
  export let open: boolean;

  let copied = false;
  let fileInput: HTMLInputElement | null = null;

  $: parsed = text.trim() ? parseImport(text) : (null as ParsedImport | null);
  $: count = parsed ? parsed.mains.length + parsed.backlog.length : 0;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(IMPORT_PROMPT);
      copied = true;
      showToast("Prompt copied");
    } catch {
      showToast("Couldn't reach the clipboard - select and copy manually");
    }
  }

  function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => (text = String(r.result ?? ""));
    r.readAsText(f);
  }

  function add() {
    if (!parsed || !count) return;
    applyImport(parsed);
    showToast(
      `Imported ${parsed.mains.length} task${parsed.mains.length === 1 ? "" : "s"}` +
        (parsed.backlog.length ? ` + ${parsed.backlog.length} to backlog` : ""),
    );
    text = "";
    open = false;
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="scrim" on:click|self={() => (open = false)}>
    <div class="sheet wide" role="dialog" aria-modal="true">
      <div class="s-in">
        <h3>Import a task list</h3>
        <div class="s-text">
          Ask ChatGPT (or any tool) for your tasks, then paste the result here. Use the button below
          to copy a prompt that formats it correctly.
        </div>
        <button class="bk-btn ghost" style="margin-top:12px;" on:click={copyPrompt}>
          ⧉ Copy the formatting prompt
        </button>
        {#if copied}
          <div class="imp-hint">
            Prompt copied. Paste it under your task request, then paste the reply below.
          </div>
        {/if}

        <div class="grouplbl">Paste your list</div>
        <!-- svelte-ignore a11y-autofocus -->
        <textarea
          class="imp-text"
          autofocus
          bind:value={text}
          placeholder={"Main Task 1\n    Subtask 1 @ 2026-08-14 10:00\n    Subtask 2 @ by 3pm\nMain Task 2\n\nBacklog:\n    Something later @ in 2h"}
        ></textarea>

        <div class="imp-row">
          <button class="bk-btn ghost" on:click={() => fileInput?.click()}>
            ⬆ Upload a .txt file
          </button>
          <input
            bind:this={fileInput}
            type="file"
            accept=".txt,text/plain,.md"
            style="display:none"
            on:change={onFile}
          />
          <span class="imp-note">or paste above</span>
        </div>

        {#if parsed}
          <div class="grouplbl">Preview</div>
          <div class="imp-preview">
            {#if parsed.errors.length}
              <div class="imp-err">
                {#each parsed.errors as err (err)}{err}<br />{/each}
              </div>
            {/if}
            {#each parsed.mains as m (m.title)}
              <div class="imp-main">
                ▸ {m.title}
                {#if m.remind}<span class="rembadge" style="cursor:default">⏲ {m.remind.short}</span
                  >{/if}
                {#each m.subs as sub (sub.title)}
                  <div class="imp-sub">
                    ↳ {sub.title}
                    {#if sub.remind}<span class="rembadge" style="cursor:default"
                        >⏲ {sub.remind.short}</span
                      >{/if}
                  </div>
                {/each}
              </div>
            {:else}
              <div class="imp-note">No tasks found yet.</div>
            {/each}
            {#if parsed.backlog.length}
              <div class="imp-main" style="margin-top:8px;color:var(--ink-soft)">
                ▤ Backlog
                {#each parsed.backlog as b (b.title)}
                  <div class="imp-sub">• {b.title}</div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <div class="imp-actions">
          <button class="checkin-no" on:click={() => (open = false)}>Cancel</button>
          <button class="checkin-yes" disabled={!count} on:click={add}>
            {#if parsed && count}
              Add {parsed.mains.length} task{parsed.mains.length === 1 ? "" : "s"}{parsed.backlog
                .length
                ? ` + ${parsed.backlog.length} backlog`
                : ""}
            {:else}
              Add
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
