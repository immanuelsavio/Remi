<script lang="ts">
  import { toast } from "../../store";
</script>

{#if $toast}
  <div class="toast">
    <span class="tmsg">{$toast.msg}</span>
    {#if $toast.actionLabel}
      <button
        class="taction"
        on:click={() => {
          $toast?.action?.();
          toast.set(null);
        }}>{$toast.actionLabel}</button
      >
    {/if}
  </div>
{/if}
