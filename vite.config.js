import path from 'path'
import { sveltekit } from '@sveltejs/kit/vite'

/** @type {import('vite').UserConfig} */
const config = {
  plugins: [sveltekit()],
  server: {
    // Fixed port keeps the browser storage origin (IndexedDB) stable,
    // so the autosaved workspace is restored on every dev session.
    port: 5199,
    strictPort: true
  },
  resolve: {
    alias: {
      'svelte-jsoneditor': path.resolve('src/lib')
    }
  }
}

export default config
