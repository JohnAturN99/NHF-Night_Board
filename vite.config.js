// vite.config.js
<<<<<<< HEAD
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// For GH Pages, your repo name becomes the base path.
// Set base via build script (see package.json below). Default here is '/' for dev.
const BASE = process.env.BUILD_BASE || '/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png'
      ],
      manifest: {
        name: 'Night Dash',
        short_name: 'NightDash',
        description: 'Nightly RTS/HOTO & servicing dashboard',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
      devOptions: {
        enabled: true, // enables SW during `npm run dev` on localhost
      }
    })
  ]
})
=======
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // MUST match your repo name exactly (case-sensitive)
  base: "/NHF-Night_Board/",
});
>>>>>>> aa58d1e669c1eee08387c46296b920f19d243875
