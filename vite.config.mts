import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    root: path.resolve(__dirname, 'renderer'),
    base: './',
    build: {
        outDir: path.resolve(__dirname, 'dist/renderer')
    },
    plugins: [react()]
});
