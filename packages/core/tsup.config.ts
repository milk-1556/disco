import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // workspace deps are bundled so the built artifact is self-contained
  noExternal: ['@disco/schema'],
});
