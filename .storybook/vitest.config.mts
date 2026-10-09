import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(configDir, '..');

export default defineProject({
    root: projectRoot,
    resolve: {
        alias: {
            '@~': path.join(projectRoot, 'renderer/src/features'),
            renderer: path.join(projectRoot, 'renderer'),
        },
    },
    optimizeDeps: {
        include: [
            'react/jsx-dev-runtime', '@mantine/core', 'mobx-react-lite', 'mobx',
            '@tabler/icons-react', 'wavesurfer.js',
            'wavesurfer.js/dist/plugins/regions.esm.js', 'wavesurfer.js/dist/plugins/timeline.esm.js',
        ],
    },
    plugins: [storybookTest({ configDir })],
    test: {
        name: 'storybook',
        browser: {
            enabled: true,
            api: { host: '127.0.0.1' },
            headless: true,
            provider: playwright({
                launchOptions: { channel: process.env.STORYBOOK_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) },
            }),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1440, height: 900 },
        },
    },
});
