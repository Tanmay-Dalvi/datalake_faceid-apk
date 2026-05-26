/**
 * Patch expo-sqlite for Node.js 22 ESM compatibility.
 * Node 22 requires explicit .js extensions in ESM imports.
 * This is a known issue with some Expo packages.
 */
const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'node_modules', 'expo-sqlite', 'build');

if (!fs.existsSync(buildDir)) {
  console.log('[postinstall] expo-sqlite not found, skipping patch');
  process.exit(0);
}

let patched = 0;

function walkDir(currentDir) {
  const files = fs.readdirSync(currentDir);
  for (const file of files) {
    const filePath = path.join(currentDir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath);
    } else if (file.endsWith('.js')) {
      let content = fs.readFileSync(filePath, 'utf8');
      const original = content;

      // Add .js to relative imports without extensions (excluding ExpoSQLiteNext)
      content = content.replace(/(import\s+[^;]*?from\s+['"]\.\/(?!ExpoSQLiteNext(?:['"]|\.))[^'"]+?)(?<!\.js)(['"])/g, '$1.js$2');
      content = content.replace(/(import\s+['"]\.\/(?!ExpoSQLiteNext(?:['"]|\.))[^'"]+?)(?<!\.js)(['"])/g, '$1.js$2');
      content = content.replace(/(export\s+\*\s+from\s+['"]\.\/(?!ExpoSQLiteNext(?:['"]|\.))[^'"]+?)(?<!\.js)(['"])/g, '$1.js$2');

      if (content !== original) {
        fs.writeFileSync(filePath, content);
        patched++;
      }
    }
  }
}

walkDir(buildDir);
console.log(`[postinstall] Patched ${patched} expo-sqlite files recursively for Node.js 22 ESM compat`);
