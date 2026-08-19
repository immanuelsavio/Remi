<script lang="ts">
  import { toast } from "../../store";
</script>

{#if $toast}
  <div class="toast">
    <span class="grow">{$toast.msg}</span>
    {#if $toast.actionLabel}
      <button
        class="undo"
        on:click={() => {
          $toast?.action?.();
          toast.set(null);
        }}>{$toast.actionLabel}</button
      >
    {/if}
  </div>
{/if}

<style>
  .grow {
    flex: 1;
    min-width: 0;
  }
  .toast {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 50px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: var(--r-sm);
    background: var(--ink);
    color: var(--bg);
    font-size: 13px;
  }
  .undo {
    font: inherit;
    font-weight: 640;
    border: 0;
    background: none;
    color: var(--bg);
    text-decoration: underline;
    cursor: pointer;
    flex: none;
  }
</style>
