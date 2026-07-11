import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    blooio: "src/blooio.ts",
    photon: "src/photon.ts",
    sendblue: "src/sendblue.ts",
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

