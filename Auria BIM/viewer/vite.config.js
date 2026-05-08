import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:  "index.html",
        floor: "floor.html",
      },
    },
  },
  server: {
    port: 3000,
  },
});
