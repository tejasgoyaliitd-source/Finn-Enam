import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "icon.svg"],
      manifest: {
        name: "FINN — Portfolio & Corporate Guidance",
        short_name: "FINN",
        description: "What changed in your portfolio, what management promised and what they delivered, each figure traced to its filing.",
        theme_color: "#F5F7F6",
        background_color: "#F5F7F6",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/brief",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // The web app only ever talks to finn-api. Never to NSE, BSE or Supabase directly.
    proxy: { "/v1": "http://localhost:8787" },
  },
});
