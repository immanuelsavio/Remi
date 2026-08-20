<script lang="ts">
  /**
   * The TASK MAP: every task with its steps as branches, and the two things
   * you can do from here - switch to any node, or PROMOTE a step into a task
   * of its own.
   *
   * Promotion is the point. A step that turns out to be the real work should
   * not stay buried one level down where it can't be started, estimated or
   * carried; ⤴ lifts it out, keeping the time it has already accrued.
   *
   * Read-only otherwise: no completing, no deleting. This is the "where am
   * I?" view.
   */
  import { app, promoteSub, setPhase, startTask, switchToMain, switchToSub } from "../../../store";
  import TopStrip from "../TopStrip.svelte";

  /** Leave the map and go back to where the user came from. */
  export let onBack: () => void;

  $: s = $app;
</script>

<div class="popover">
  <div class="pop-body">
    <TopStrip back showWork={false} {onBack} />
    <div class="mapwrap">
      <div class="pad" style="padding-bottom:2px;"><h2 class="mid">Task map</h2></div>
      <div class="mapcanvas">
        <div class="mtree">
          {#each s.mains as m (m.id)}
            {@const isCurMain = m.id === s.activeMainId && !s.activeSubId}
            <div class="mmain" class:active={m.id === s.activeMainId} class:done={m.done}>
              <div class="mmain-head">
                <span class="mt">{m.title}</span>
                <span class="brgt">
                  {#if m.done}
                    <span class="badge">done</span>
                  {:else if isCurMain}
                    <button class="mgo" on:click={() => setPhase("active")}>Continue</button>
                  {:else}
                    <button
                      class="mgo switch"
                      on:click={() => (s.activeMainId ? switchToMain(m.id, true) : startTask(m.id))}
                    >
                      {s.activeMainId ? "Switch" : "Start"}
                    </button>
                  {/if}
                </span>
              </div>
              {#if m.subs.length}
                <div class="mbranches">
                  {#each m.subs as sub (sub.id)}
                    {@const isCurSub = sub.id === s.activeSubId}
                    <div class="mbranch" class:done={sub.done}>
                      <span class="bt">
                        <span class="glyph" aria-hidden="true">↳</span>
                        <span class="txt">{sub.title}</span>
                      </span>
                      <span class="brgt">
                        {#if sub.done}
                          <span class="badge">done</span>
                        {:else if isCurSub}
                          <button class="mgo" on:click={() => setPhase("active")}>Continue</button>
                        {:else}
                          <button
                            class="mgo switch"
                            on:click={() => switchToSub(m.id, sub.id, true)}>Switch</button
                          >
                        {/if}
                        {#if !sub.done}
                          <button
                            class="promote"
                            title="Make its own task"
                            aria-label="Make “{sub.title}” its own task"
                            on:click={() => promoteSub(m.id, sub.id)}>⤴</button
                          >
                        {/if}
                      </span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <div class="empty">
              <p class="empty-t">Nothing to map yet</p>
              <p class="empty-sub">Add a task and its steps will branch off it here.</p>
            </div>
          {/each}
        </div>
      </div>
      <div class="maplegend"><span>↳ step</span><span>⤴ make its own task</span></div>
    </div>
  </div>
</div>
