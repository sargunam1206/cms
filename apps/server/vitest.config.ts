import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test', TZ_NAME: 'Asia/Kolkata' },
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
