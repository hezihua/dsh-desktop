import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          delete process.env.ELECTRON_RUN_AS_NODE
          void startup()
        },
        vite: {
          build: {
            rollupOptions: {
              external: ['@deepseek-ai/dsh'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart({ reload }) {
          reload()
        },
      },
    ]),
  ],
})
