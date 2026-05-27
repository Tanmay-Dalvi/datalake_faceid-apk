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

// Patch react-native-fast-tflite to support file:// protocol on Android in release builds
const tfliteModulePath = path.join(__dirname, '..', 'node_modules', 'react-native-fast-tflite', 'android', 'src', 'main', 'java', 'com', 'tflite', 'TfliteModule.java');

if (fs.existsSync(tfliteModulePath)) {
  let content = fs.readFileSync(tfliteModulePath, 'utf8');
  if (!content.includes('url.startsWith("file:/")')) {
    const target = '  @DoNotStrip\n  public static byte[] fetchByteDataFromUrl(String url) {\n    OkHttpClient';
    const replacement = `  @DoNotStrip
  public static byte[] fetchByteDataFromUrl(String url) {
    if (url.startsWith("file:/") || url.startsWith("/")) {
      try {
        String path = url;
        if (path.startsWith("file://")) {
          path = path.substring(7);
        } else if (path.startsWith("file:")) {
          path = path.substring(5);
        }
        java.io.File file = new java.io.File(path);
        int size = (int) file.length();
        byte[] bytes = new byte[size];
        try (java.io.FileInputStream fis = new java.io.FileInputStream(file)) {
          int bytesRead = 0;
          while (bytesRead < size) {
            int read = fis.read(bytes, bytesRead, size - bytesRead);
            if (read == -1) break;
            bytesRead += read;
          }
        }
        return bytes;
      } catch (Exception e) {
        Log.e(NAME, "Failed to read local file " + url + "!", e);
        return null;
      }
    }

    OkHttpClient`;
    
    if (content.includes(target)) {
      content = content.replace(target, replacement);
      fs.writeFileSync(tfliteModulePath, content);
      console.log('[postinstall] Patched react-native-fast-tflite for local file URI support on Android');
    }
  }
}
