<script lang="ts">
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  onMount(() => goto('/development'))
</script>

<svelte:head>
  <title>JSON Editor</title>
  <meta http-equiv="refresh" content="0;url=/development" />
</svelte:head>

<p>Redirecting to <a href="/development">JSON Editor</a>...</p>
