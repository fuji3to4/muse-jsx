const { fusebox, sparky, pluginTypeScript, pluginSass, pluginLink } = require('fuse-box');

sparky().task('default', async () => {
    const fuse = await fusebox({
        target: 'browser',
        entry: 'demo/src/main.ts',
        devServer: {
            httpServer: {
                port: 4445,
            },
            hmrServer: true,
        },
        cache: {
            enabled: true,
            root: '.fusebox',
        },
        webIndex: {
            template: 'demo/src/index.html',
        },
        plugins: [pluginTypeScript(), pluginSass()],
        sourceMap: true,
        watch: true,
    });

    await fuse.runDev();
});

sparky().exec();
