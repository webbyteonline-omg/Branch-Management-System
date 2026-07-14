// vite.config.js
import { defineConfig } from "file:///sessions/lucid-eager-faraday/mnt/Branch%20Management%20System/web/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/lucid-eager-faraday/mnt/Branch%20Management%20System/web/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///sessions/lucid-eager-faraday/mnt/Branch%20Management%20System/web/node_modules/vite-plugin-pwa/dist/index.js";
var vite_config_default = defineConfig({
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
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Always fetch the latest HTML so new deploys show immediately.
        navigateFallback: "index.html",
        runtimeCaching: [{
          urlPattern: function(_a) {
            var request = _a.request;
            return request.mode === "navigate";
          },
          handler: "NetworkFirst",
          options: { cacheName: "html-cache" }
        }]
      }
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvbHVjaWQtZWFnZXItZmFyYWRheS9tbnQvQnJhbmNoIE1hbmFnZW1lbnQgU3lzdGVtL3dlYlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL2x1Y2lkLWVhZ2VyLWZhcmFkYXkvbW50L0JyYW5jaCBNYW5hZ2VtZW50IFN5c3RlbS93ZWIvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL2x1Y2lkLWVhZ2VyLWZhcmFkYXkvbW50L0JyYW5jaCUyME1hbmFnZW1lbnQlMjBTeXN0ZW0vd2ViL3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjtcbmltcG9ydCB7IFZpdGVQV0EgfSBmcm9tIFwidml0ZS1wbHVnaW4tcHdhXCI7XG4vLyBQV0E6IGluc3RhbGxzIG9uIHBob25lcywgd29ya3MgZnVsbHkgb2ZmbGluZSAoYXBwIHNoZWxsIGNhY2hlZCkuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICAgIHBsdWdpbnM6IFtcbiAgICAgICAgcmVhY3QoKSxcbiAgICAgICAgVml0ZVBXQSh7XG4gICAgICAgICAgICByZWdpc3RlclR5cGU6IFwiYXV0b1VwZGF0ZVwiLFxuICAgICAgICAgICAgaW5jbHVkZUFzc2V0czogW1wiaWNvbi5zdmdcIl0sXG4gICAgICAgICAgICBtYW5pZmVzdDoge1xuICAgICAgICAgICAgICAgIG5hbWU6IFwiQnJhbmNoIE1hbmFnZXJcIixcbiAgICAgICAgICAgICAgICBzaG9ydF9uYW1lOiBcIkJyYW5jaE1nclwiLFxuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIk11bHRpLWJyYW5jaCBzYWxlcyAmIHRyYWNraW5nIHN5c3RlbVwiLFxuICAgICAgICAgICAgICAgIHRoZW1lX2NvbG9yOiBcIiM0ZjQ2ZTVcIixcbiAgICAgICAgICAgICAgICBiYWNrZ3JvdW5kX2NvbG9yOiBcIiNmNGY2ZmFcIixcbiAgICAgICAgICAgICAgICBkaXNwbGF5OiBcInN0YW5kYWxvbmVcIixcbiAgICAgICAgICAgICAgICBvcmllbnRhdGlvbjogXCJwb3J0cmFpdFwiLFxuICAgICAgICAgICAgICAgIGljb25zOiBbeyBzcmM6IFwiaWNvbi5zdmdcIiwgc2l6ZXM6IFwiYW55XCIsIHR5cGU6IFwiaW1hZ2Uvc3ZnK3htbFwiLCBwdXJwb3NlOiBcImFueSBtYXNrYWJsZVwiIH1dLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHdvcmtib3g6IHtcbiAgICAgICAgICAgICAgICBnbG9iUGF0dGVybnM6IFtcIioqLyoue2pzLGNzcyxodG1sLHN2Zyx3b2ZmMn1cIl0sXG4gICAgICAgICAgICAgICAgY2xpZW50c0NsYWltOiB0cnVlLFxuICAgICAgICAgICAgICAgIHNraXBXYWl0aW5nOiB0cnVlLFxuICAgICAgICAgICAgICAgIGNsZWFudXBPdXRkYXRlZENhY2hlczogdHJ1ZSxcbiAgICAgICAgICAgICAgICAvLyBBbHdheXMgZmV0Y2ggdGhlIGxhdGVzdCBIVE1MIHNvIG5ldyBkZXBsb3lzIHNob3cgaW1tZWRpYXRlbHkuXG4gICAgICAgICAgICAgICAgbmF2aWdhdGVGYWxsYmFjazogXCJpbmRleC5odG1sXCIsXG4gICAgICAgICAgICAgICAgcnVudGltZUNhY2hpbmc6IFt7XG4gICAgICAgICAgICAgICAgICAgICAgICB1cmxQYXR0ZXJuOiBmdW5jdGlvbiAoX2EpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVxdWVzdCA9IF9hLnJlcXVlc3Q7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlcXVlc3QubW9kZSA9PT0gXCJuYXZpZ2F0ZVwiO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZXI6IFwiTmV0d29ya0ZpcnN0XCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zOiB7IGNhY2hlTmFtZTogXCJodG1sLWNhY2hlXCIgfSxcbiAgICAgICAgICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICBdLFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWdYLFNBQVMsb0JBQW9CO0FBQzdZLE9BQU8sV0FBVztBQUNsQixTQUFTLGVBQWU7QUFFeEIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDeEIsU0FBUztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sUUFBUTtBQUFBLE1BQ0osY0FBYztBQUFBLE1BQ2QsZUFBZSxDQUFDLFVBQVU7QUFBQSxNQUMxQixVQUFVO0FBQUEsUUFDTixNQUFNO0FBQUEsUUFDTixZQUFZO0FBQUEsUUFDWixhQUFhO0FBQUEsUUFDYixhQUFhO0FBQUEsUUFDYixrQkFBa0I7QUFBQSxRQUNsQixTQUFTO0FBQUEsUUFDVCxhQUFhO0FBQUEsUUFDYixPQUFPLENBQUMsRUFBRSxLQUFLLFlBQVksT0FBTyxPQUFPLE1BQU0saUJBQWlCLFNBQVMsZUFBZSxDQUFDO0FBQUEsTUFDN0Y7QUFBQSxNQUNBLFNBQVM7QUFBQSxRQUNMLGNBQWMsQ0FBQyw4QkFBOEI7QUFBQSxRQUM3QyxjQUFjO0FBQUEsUUFDZCxhQUFhO0FBQUEsUUFDYix1QkFBdUI7QUFBQTtBQUFBLFFBRXZCLGtCQUFrQjtBQUFBLFFBQ2xCLGdCQUFnQixDQUFDO0FBQUEsVUFDVCxZQUFZLFNBQVUsSUFBSTtBQUN0QixnQkFBSSxVQUFVLEdBQUc7QUFDakIsbUJBQU8sUUFBUSxTQUFTO0FBQUEsVUFDNUI7QUFBQSxVQUNBLFNBQVM7QUFBQSxVQUNULFNBQVMsRUFBRSxXQUFXLGFBQWE7QUFBQSxRQUN2QyxDQUFDO0FBQUEsTUFDVDtBQUFBLElBQ0osQ0FBQztBQUFBLEVBQ0w7QUFDSixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
