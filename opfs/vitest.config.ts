import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/benchmark/**'],
    environment: 'node',
    globals: true,
  },
});
