<script lang="ts">
  /**
   * The tag filter: chips, but only as many as are worth showing at once.
   *
   * It used to render EVERY distinct tag, unbounded, in both the Calendar
   * and the report builder. That is fine at six tags and a wall you scroll
   * past at forty - and forty is not a stretch, since a task may carry
   * twelve and nothing caps how many exist across a corpus.
   *
   * Two things keep it small without hiding anything:
   *
   *   1. `allTags` already sorts by how often a tag is used, so the first
   *      handful are the ones actually worth a click. The rest sit behind a
   *      count that says exactly how many there are.
   *   2. Past a dozen, a search box appears. Scanning forty chips for one
   *      name is slower than typing three letters of it.
   *
   * SELECTED tags always show, wherever they sort. A filter you cannot see
   * to turn off is the worst possible state for this control - the results
   * are wrong and the reason is off screen.
   */
  export let tags: string[];
  export let selected: string[] = [];
  export let onToggle: (tag: string) => void;
  /** Rendered after the chips - the report builder puts "clear" there. */
  export let label = "";

  /** How many chips a collapsed list shows. */
  const COLLAPSED = 10;
  /** Above this many tags, scanning beats reading - offer a search box. */
  const SEARCH_AT = 12;

  let expanded = false;
  let query = "";

  $: q = query.trim().toLowerCase();
  // Selected first, otherwise the frequency order `allTags` produced.
  // Array.prototype.sort is stable, so ties keep that order.
  $: ordered = [...tags].sort(
    (a, b) => Number(selected.includes(b)) - Number(selected.includes(a)),
  );
  $: matching = q ? ordered.filter((t) => t.includes(q)) : ordered;
  $: shown = expanded || q ? matching : matching.slice(0, COLLAPSED);
  $: hidden = matching.length - shown.length;
</script>

{#if tags.length}
  {#if tags.length > SEARCH_AT}
    <input
      class="tagfind"
      type="search"
      placeholder="Find a tag… ({tags.length})"
      bind:value={query}
    />
  {/if}
  <div class="tagpick">
    {#each shown as t (t)}
      <button class="tagchip" class:on={selected.includes(t)} on:click={() => onToggle(t)}>
        #{t}
      </button>
    {/each}
    {#if hidden > 0}
      <button class="tagchip more" on:click={() => (expanded = true)}>+{hidden} more</button>
    {:else if expanded && !q && matching.length > COLLAPSED}
      <button class="tagchip more" on:click={() => (expanded = false)}>show fewer</button>
    {/if}
    {#if q && !matching.length}
      <span class="tagnone">No tag matches “{query}”.</span>
    {/if}
    <slot />
  </div>
  {#if label}
    <p class="imp-note">{label}</p>
  {/if}
{/if}

<style>
  .tagfind {
    width: 100%;
    max-width: 260px;
    padding: 6px 10px;
    margin-bottom: 7px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--card);
    color: var(--ink);
    font-size: 12px;
  }
  .tagfind:focus {
    outline: none;
    border-color: var(--accent);
  }
  .tagpick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 4px;
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
  /* Reads as a control, not as another tag you could filter by. */
  .tagchip.more {
    background: none;
    border-style: dashed;
    color: var(--ink-faint);
  }
  .tagnone {
    font-size: 11.5px;
    color: var(--ink-faint);
    align-self: center;
  }
</style>
