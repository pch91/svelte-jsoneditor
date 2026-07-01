<script lang="ts">
  import { browser } from '$app/environment'
  if (browser) {
    window.location.replace('./development/')
  }
</script>

<svelte:head>
  <title>JSON Editor</title>
  <meta http-equiv="refresh" content="0;url=./development/" />
</svelte:head>

<p>Redirecting to <a href="./development/">JSON Editor</a>...</p>
