import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    root: 'demo',
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
    build: {
        outDir: '../dist-demo',
    },
    server: {
        port: 4445,
        fs: {
            strict: false,
        },
    },
    optimizeDeps: {
        exclude: ['muse-js'],
        esbuildOptions: {
            target: 'es2015',
        },
    },
});
