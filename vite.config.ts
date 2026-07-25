import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'child_process', 'fs', 'path', 'os', 'node-pty', 'ssh2', 'better-sqlite3'],
            },
          },
          plugins: [
            {
              name: 'copy-splash',
              closeBundle() {
                // 在构建完成后将 splash.html 复制到 dist-electron
                const src = path.join(__dirname, 'electron', 'splash.html')
                const dest = path.join(__dirname, 'dist-electron', 'splash.html')
                if (fs.existsSync(src)) {
                  fs.copyFileSync(src, dest)
                  console.log('✓ splash.html copied to dist-electron')
                }
              },
            },
          ],
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 55173,
    strictPort: true,
  },
})
