import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "providers/blooio": "src/providers/blooio.ts",
    "providers/photon": "src/providers/photon.ts",
  },
  format: ["esm"],
  target: "es2022",
  platform: "neutral",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
});
