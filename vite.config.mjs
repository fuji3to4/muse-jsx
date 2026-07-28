import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    plugins: [react()],
    root: 'demo',
    // GitHub Pages で /<repo>/ 配下にデプロイされるため、ベースパスを設定
    base: '/muse-jsx/',
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
            // @neurosity/pipes の browser エントリ(dist/browser)は Parcel ランタイム前提で
            // Vite の ESM 実行時に `parcelRequire is not defined` を起こすため ESM を強制する。
            '@neurosity/pipes': resolve(__dirname, './node_modules/@neurosity/pipes/dist/esm/index.js'),
        },
    },
    build: {
        outDir: '../dist-demo',
        emptyOutDir: true,
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
