import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    root: 'demo',
    // GitHub Pages で /<repo>/ 配下にデプロイされるため、ベースパスを設定
    base: '/muse-jsx/',
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
