<script lang="ts" generics="T extends string">
  /**
   * "What happens to each of these?" - one row per task, with a segmented
   * choice on the right.
   *
   * Shared by End Day (done / carry / backlog) and Start Day (keep /
   * backlog / drop), because they are the same question asked at two
   * different moments and should not drift apart visually or behaviourally.
   *
   * The caller owns the choices array and its default, so this component
   * decides nothing - it only shows and reports.
   */

  /** One row: a stable key, what to call it, and an optional detail line. */
  export let items: { key: string; title: string; detail?: string; warn?: boolean }[];
  /** Bound: `choices[key]` is the current selection for that row. */
  export let choices: Record<string, T>;
  /** The buttons, left to right. `tone` tints the selected state. */
  export let options: { value: T; label: string; tone?: "accent" | "done" }[];
</script>

{#each items as item (item.key)}
  <div class="carry-row" class:avoiding={item.warn}>
    <span class="ct">
      {item.title}
      {#if item.detail}<span class="cd">{item.detail}</span>{/if}
    </span>
    <span class="carry-seg" role="group" aria-label="What happens to “{item.title}”">
      {#each options as opt (opt.value)}
        <button
          class:on={choices[item.key] === opt.value}
          class:doneopt={opt.tone === "done"}
          aria-pressed={choices[item.key] === opt.value}
          on:click={() => (choices = { ...choices, [item.key]: opt.value })}
        >
          {opt.label}
        </button>
      {/each}
    </span>
  </div>
{/each}

<style>
  /* Everything else is `.carry-row` / `.carry-seg` in global.css, shared
     with the showcase. Only the detail line is new. */
  .cd {
    display: block;
    font-size: 11px;
    color: var(--ink-faint);
    font-family: var(--font-num);
    margin-top: 2px;
  }
</style>
