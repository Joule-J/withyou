import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
      "/health": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
