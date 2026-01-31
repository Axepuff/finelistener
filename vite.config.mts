import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const featuresRoot = path.resolve(__dirname, 'renderer/src/features');

export default defineConfig({
    root: path.resolve(__dirname, 'renderer'),
    base: './',
    resolve: {
        alias: {
            '@~': featuresRoot,
            renderer: path.resolve(__dirname, 'renderer'),
        },
    },
    build: {
        outDir: path.resolve(__dirname, 'dist/renderer')
    },
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
    },
    plugins: [react()]
});
