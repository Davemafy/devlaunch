import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  // electron-store v10 is ESM-only. Bundle it into the Electron main process
  // instead of leaving a CommonJS require() that crashes in the packaged app.
  main: { plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
