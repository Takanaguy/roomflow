import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Meme resolution que "paths" dans tsconfig.json : sans ca, les imports
    // "@/lib/..." des fichiers testes ne seraient pas trouves par Vitest.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Logique pure de src/lib/ : pas de DOM, donc pas de jsdom.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
