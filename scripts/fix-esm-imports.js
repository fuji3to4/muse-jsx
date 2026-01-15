// Fix ESM imports by adding .js extensions
const fs = require('fs');
const path = require('path');

function addJsExtensions(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
        const fullPath = path.join(dir, file.name);

        if (file.isDirectory()) {
            addJsExtensions(fullPath);
        } else if (file.name.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');

            // Add .js to relative imports that don't have an extension
            content = content.replace(/(from\s+['"])(\.[^'"]+)(?<!\.js)(['"])/g, '$1$2.js$3');
            content = content.replace(/(export\s+\*\s+from\s+['"])(\.[^'"]+)(?<!\.js)(['"])/g, '$1$2.js$3');

            fs.writeFileSync(fullPath, content, 'utf8');
        }
    }
}

const distEsmPath = path.join(__dirname, '..', 'dist-esm');
if (fs.existsSync(distEsmPath)) {
    console.log('Adding .js extensions to ESM imports...');
    addJsExtensions(distEsmPath);
    console.log('Done!');
} else {
    console.error('dist-esm directory not found');
    process.exit(1);
}
