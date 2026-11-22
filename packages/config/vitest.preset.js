// Shared Vitest settings. Use with: defineConfig(mergeConfig(preset, { ... })) or as is.
/** @type {import('vitest/config').UserConfig} */
export default {
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
};
