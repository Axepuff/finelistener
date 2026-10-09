import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
    stories: ['../renderer/src/**/*.stories.tsx'],
    addons: ['@storybook/addon-docs', '@storybook/addon-mcp', '@storybook/addon-vitest'],
    framework: '@storybook/react-vite',
    features: {
        componentsManifest: true,
    },
};

export default config;
