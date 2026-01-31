import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['electron/src/**/*.test.ts'],
        restoreMocks: true,
    },
});
