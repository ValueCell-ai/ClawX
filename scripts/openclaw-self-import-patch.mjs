import fs from 'node:fs';
import path from 'node:path';

export const OPENCLAW_PLUGIN_SDK_PREFIX = 'openclaw/plugin-sdk/';

const OPENCLAW_PLUGIN_SDK_SPECIFIER_RE = /(["'])openclaw\/plugin-sdk\/([^"'\r\n]+)\1/g;

function assertSafePluginSdkSubpath(subpath) {
  if (!subpath || subpath.startsWith('/') || subpath.startsWith('\\')) {
    throw new Error(`Invalid OpenClaw plugin-sdk import subpath: ${JSON.stringify(subpath)}`);
  }

  const parts = subpath.split(/[\\/]+/);
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid OpenClaw plugin-sdk import subpath: ${JSON.stringify(subpath)}`);
  }
}

export function toImportSpecifier(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (normalized.startsWith('./') || normalized.startsWith('../')) {
    return normalized;
  }
  return `./${normalized}`;
}

export function resolvePluginSdkTarget(distDir, subpath) {
  assertSafePluginSdkSubpath(subpath);

  const targetSubpath = subpath.endsWith('.js') ? subpath : `${subpath}.js`;
  return path.join(distDir, 'plugin-sdk', ...targetSubpath.split(/[\\/]+/));
}

export function rewriteOpenClawPluginSdkSpecifiers(content, options) {
  const { filePath, distDir } = options;
  let replacements = 0;

  const nextContent = content.replace(
    OPENCLAW_PLUGIN_SDK_SPECIFIER_RE,
    (match, quote, subpath) => {
      const target = resolvePluginSdkTarget(distDir, subpath);
      if (!fs.existsSync(target)) {
        throw new Error(
          `Cannot rewrite ${match} in ${filePath}: missing bundled SDK target ${target}`,
        );
      }

      replacements++;
      const relativePath = path.relative(path.dirname(filePath), target);
      return `${quote}${toImportSpecifier(relativePath)}${quote}`;
    },
  );

  return {
    content: nextContent,
    replacements,
  };
}

function listJavaScriptFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      // OpenClaw 2026.10 emits bundled extensions as ESM (.mjs) alongside the
      // legacy CJS (.js) entries, and both can import the plugin-sdk facade.
      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export function patchExtensionOpenClawSelfImports(outputDir) {
  const distDir = path.join(outputDir, 'dist');
  const extensionsDir = path.join(distDir, 'extensions');
  if (!fs.existsSync(extensionsDir)) {
    return {
      filesScanned: 0,
      filesPatched: 0,
      specifiersPatched: 0,
    };
  }

  let filesScanned = 0;
  let filesPatched = 0;
  let specifiersPatched = 0;

  for (const filePath of listJavaScriptFiles(extensionsDir)) {
    filesScanned++;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(OPENCLAW_PLUGIN_SDK_PREFIX)) {
      continue;
    }

    const result = rewriteOpenClawPluginSdkSpecifiers(content, {
      filePath,
      distDir,
    });

    if (result.replacements > 0 && result.content !== content) {
      fs.writeFileSync(filePath, result.content, 'utf8');
      filesPatched++;
      specifiersPatched += result.replacements;
    }
  }

  return {
    filesScanned,
    filesPatched,
    specifiersPatched,
  };
}
