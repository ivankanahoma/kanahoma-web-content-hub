import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` matches the GitHub Pages project path. Change it alongside the repo name.
export default defineConfig({
  plugins: [react()],
  base: "/kanahoma-web-content-hub/",
  server: { port: 5175 },
});
