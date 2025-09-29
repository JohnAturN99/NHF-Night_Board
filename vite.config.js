// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// IMPORTANT: this MUST be your repo name with slashes
const GHP_BASE = "/NHF-Night_Board/";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // we put icons in /public/icons, list them so they're precached
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "favicon.ico"],
      manifest: {
        name: "Night Board",
        short_name: "NightBoard",
        start_url: ".",     // relative = works on GitHub Pages
        scope: ".",         // relative = works on GitHub Pages
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0ea5e9",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      }
    })
  ],
  base: GHP_BASE, // <-- CRUCIAL for GitHub Pages path
});
