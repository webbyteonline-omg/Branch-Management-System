import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA: installs on phones, works fully offline (app shell cached).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Branch Manager",
        short_name: "BranchMgr",
        description: "Multi-branch sales & tracking system",
        theme_color: "#4f46e5",
        background_color: "#f4f6fa",
        display: "standalone",
        orientation: "portrait",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,woff2}"] },
    }),
  ],
});
