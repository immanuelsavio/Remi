<script lang="ts">
  /**
   * Notes: a free-text field beside every task and step.
   *
   * The promise is that a note STAYS attached to its task - which is why
   * `CarrySnapshot` carries notes across a day boundary rather than
   * rebuilding tasks from titles alone.
   */
  import { app, setNote } from "../../../store";

  $: s = $app;
</script>

<div class="dsec-title">Notes</div>
{#if !s.mains.length}
  <div class="hist-empty">
    No tasks yet today. Notes you add here stay attached to the task or step.
  </div>
{:else}
  <div class="dsec-sub">Jot a reminder next to any task or step — it travels with your backup.</div>
  {#each s.mains as m (m.id)}
    <div class="dtask">
      <div class="dtask-head"><span class="dt-t">{m.title}</span></div>
      <div class="dtask-note">
        <textarea
          placeholder="Note for this task…"
          value={m.note}
          on:input={(e) => setNote(m.id, null, e.currentTarget.value)}
        ></textarea>
      </div>
      {#if m.subs.length}
        <div class="dtask-sub">
          {#each m.subs as sub (sub.id)}
            <div class="dnote-sub">
              <span class="ds-t" title={sub.title}>↳ {sub.title}</span>
              <textarea
                placeholder="Note…"
                value={sub.note}
                on:input={(e) => setNote(m.id, sub.id, e.currentTarget.value)}
              ></textarea>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
{/if}
