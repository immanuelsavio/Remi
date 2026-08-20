<script lang="ts">
  /** Shown after finishing a task with nothing to return to: what's next? */
  import { app, closeOverlay, startBreak, startTask } from "../../../store";

  $: s = $app;
  $: open = s.mains.filter((m) => !m.done);
</script>

<div class="scrim">
  <div class="sheet" role="dialog" aria-modal="true">
    <div class="s-in">
      <h3>Nice. What's next?</h3>
      <div class="pick-list">
        {#each open as m (m.id)}
          <button class="pick" on:click={() => startTask(m.id)}>
            <span class="pick-head">
              <span>
                <span class="pt">{m.title}</span>
                <span class="pd">{m.subs.length ? `${m.subs.length} steps` : "task"}</span>
              </span>
              <span class="tag">start</span>
            </span>
          </button>
        {:else}
          <div class="s-text">Everything on today's list is done.</div>
        {/each}
      </div>
      <button class="checkin-no" style="margin-top:12px;" on:click={() => startBreak(15)}>
        ☕ Take a break
      </button>
      <button class="checkin-no" on:click={closeOverlay}>Just stop for now</button>
    </div>
  </div>
</div>
