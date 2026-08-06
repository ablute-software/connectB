// Item #15 — added solely to alias the 'server-only' package (see
// src/test/server-only-stub.ts for why it's otherwise unresolvable under
// vitest). No other vitest defaults are touched or overridden here.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, 'src/test/server-only-stub.ts'),
    },
  },
});
