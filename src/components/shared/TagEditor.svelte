<script lang="ts">
  /**
   * Tags on one task: the chips, an X on each, and a box to add more.
   *
   * Suggestions come from tags already in use, because the value of a tag
   * is entirely in reusing it - a project you label three different ways
   * cannot be reported on.
   */
  import { addTag, removeTag, tourAnchor } from "../../store";
  import { parseTags } from "../../view";

  export let mainId: string;
  export let tags: string[];
  /** Every tag already in use, for the datalist. */
  export let suggestions: string[] = [];
  /** Registers this row as the tour's target, when a caller names one. */
  export let tourId: string | undefined = undefined;

  let draft = "";
  const listId = `tags-${Math.random().toString(36).slice(2, 8)}`;

  function commit() {
    // Accept "a, b" in one go - people paste as often as they type.
    parseTags(draft).forEach((t) => addTag(mainId, t));
    draft = "";
  }
</script>

<div class="tagrow" use:tourAnchor={tourId}>
  {#each tags as t (t)}
    <span class="tag">
      #{t}
      <button
        class="x"
        title="Remove #{t}"
        aria-label="Remove tag {t}"
        on:click={() => removeTag(mainId, t)}>✕</button
      >
    </span>
  {/each}
  <input
    class="taginput"
    list={listId}
    placeholder={tags.length ? "+ tag" : "+ add a tag…"}
    autocomplete="off"
    bind:value={draft}
    on:keydown={(e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit();
      }
    }}
    on:blur={commit}
  />
  <datalist id={listId}>
    {#each suggestions.filter((x) => !tags.includes(x)) as s (s)}
      <option value={s}></option>
    {/each}
  </datalist>
</div>

<style>
  .tagrow {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 6px;
    padding-left: 2px;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-family: var(--font-num);
    font-size: 10px;
    font-weight: 600;
    color: var(--accent-ink);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line));
    border-radius: 999px;
    padding: 2px 4px 2px 8px;
    white-space: nowrap;
  }
  .tag .x {
    border: none;
    background: none;
    color: inherit;
    opacity: 0.55;
    cursor: pointer;
    font-size: 9px;
    line-height: 1;
    padding: 2px 3px;
    border-radius: 999px;
  }
  .tag .x:hover {
    opacity: 1;
    color: var(--danger);
  }
  .taginput {
    border: 1px dashed var(--line);
    background: transparent;
    color: var(--ink);
    border-radius: 999px;
    padding: 3px 9px;
    font: inherit;
    font-size: 11px;
    outline: none;
    width: 96px;
  }
  .taginput:focus {
    border-style: solid;
    border-color: var(--accent);
    width: 140px;
  }
</style>
