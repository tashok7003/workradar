import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Live AI locally: start the dev server with ANTHROPIC_API_KEY set.
// The key stays in this Node process; the browser only calls /api/claude,
// which this proxy forwards to the Anthropic Messages API with the key attached.
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
  const key = env.ANTHROPIC_API_KEY;

  return {
    base: "./",
    plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
    define: {
      __LIVE_PROXY__: JSON.stringify(Boolean(key)),
      __AI_MODEL__: JSON.stringify(env.ANTHROPIC_MODEL || "claude-sonnet-5-5"),
    },
    server: {
      proxy: key
        ? {
            "/api/claude": {
              target: "https://api.anthropic.com",
              changeOrigin: true,
              rewrite: () => "/v1/messages",
              headers: {
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
              },
            },
          }
        : undefined,
    },
    build: { outDir: mode === "single" ? "dist-single" : "dist" },
  };
});
