import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Short commit sha baked into the bundle so testers can report which build
// they're on ("v2.0.0 · a1b2c3d" in Settings → Support).
let buildSha = 'dev'
try { buildSha = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* no git (CI tarball) */ }

export default defineConfig({
  define: { __BUILD_SHA__: JSON.stringify(buildSha) },
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    }
  },
  build: {
    rollupOptions: {
      external: ["firebase-admin"],
    }
  },
})
