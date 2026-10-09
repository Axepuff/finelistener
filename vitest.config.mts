import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@~': path.resolve(__dirname, 'renderer/src/features'),
            renderer: path.resolve(__dirname, 'renderer'),
        },
    },
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    environment: 'node',
                    include: ['electron/src/**/*.test.ts', 'renderer/src/**/*.test.ts'],
                    restoreMocks: true,
                },
            },
            '.storybook/vitest.config.mts',
        ],
    },
});
