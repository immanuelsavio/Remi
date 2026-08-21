<script lang="ts">
  /**
   * "Something came up" - the switch picker.
   *
   * A task with steps EXPANDS rather than switching straight away, so you
   * can land on the exact step instead of the task's head and then have to
   * switch again. The return stack remembers where you were, which is what
   * makes an interruption recoverable instead of just a context loss.
   */
  import { app, closeOverlay, startNewMain, switchToMain, switchToSub } from "../../../store";

  /** Shared with the router so the draft survives closing and reopening. */
  export let interruptDraft: string;

  let expanded: string | null = null;

  $: s = $app;
  $: cur = s.mains.find((m) => m.id === s.activeMainId) ?? null;
  $: openMains = s.mains.filter((m) => !m.done);

  function commitNew() {
    if (!interruptDraft.trim()) return;
    startNewMain(interruptDraft, true);
    interruptDraft = "";
  }

  function pick(id: string) {
    const m = s.mains.find((x) => x.id === id);
    if (!m) return;
    // Expand when there is something to choose between; otherwise just go.
    if (m.subs.some((x) => !x.done) || m.id === cur?.id) {
      expanded = expanded === id ? null : id;
      return;
    }
    switchToMain(id, true);
  }
</script>

<div class="scrim">
  <div class="sheet" role="dialog" aria-modal="true">
    <div class="s-in">
      <h3>Something came up</h3>
      <div class="s-text">
        {#if cur}I'll remember <b>{cur.title}</b> and bring you back.{:else}Pick what you're on now.{/if}
      </div>

      <div class="grouplbl">Your tasks</div>
      <div class="pick-list">
        {#each openMains as m (m.id)}
          {@const openSubs = m.subs.filter((x) => !x.done)}
          <div class="pick" class:open={expanded === m.id}>
            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
            <div class="pick-head" role="button" tabindex="0" on:click={() => pick(m.id)}>
              <span>
                <span class="pt">{m.title}</span>
                <span class="pd">
                  {#if m.id === cur?.id}you're here now{:else if m.subs.length}{m.subs.length} steps{:else}task{/if}
                </span>
              </span>
              <span class="tag">
                {#if m.subs.length}<span class="chev">▾</span>
                {:else if m.id === cur?.id}continue
                {:else}switch{/if}
              </span>
            </div>
            {#if expanded === m.id}
              <div class="pick-sub">
                <button
                  class="pshead"
                  class:cont={m.id === cur?.id && !s.activeSubId}
                  on:click={() =>
                    m.id === cur?.id && !s.activeSubId ? closeOverlay() : switchToMain(m.id, true)}
                >
                  {m.id === cur?.id && !s.activeSubId
                    ? "✓ Continue this task"
                    : "▸ Work on the task itself"}
                </button>
                {#each openSubs as sub (sub.id)}
                  <button
                    class="psrow"
                    class:oncur={sub.id === s.activeSubId}
                    on:click={() =>
                      sub.id === s.activeSubId ? closeOverlay() : switchToSub(m.id, sub.id, true)}
                  >
                    {sub.title}{#if sub.id === s.activeSubId}
                      · on now{/if}
                  </button>
                {:else}
                  <div class="psrow" style="color:var(--ink-faint);cursor:default">
                    no open steps
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="grouplbl">Or start something new</div>
      <div class="newmain-row">
        <input
          placeholder="New task…"
          autocomplete="off"
          bind:value={interruptDraft}
          on:keydown={(e) => e.key === "Enter" && commitNew()}
        />
        <button on:click={commitNew}>Add &amp; start</button>
      </div>

      <button class="checkin-no" style="margin-top:12px;" on:click={closeOverlay}>
        Never mind - stay here
      </button>
    </div>
  </div>
</div>
