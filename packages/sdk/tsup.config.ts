import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // discord.js stays external (heavy, has native-ish deps); workspace deps are bundled.
  external: ['discord.js'],
  noExternal: ['@disco/core', '@disco/schema'],
});
