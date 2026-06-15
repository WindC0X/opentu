#!/usr/bin/env node

/**
 * Final pass for the New API embedded Creative build.
 *
 * `vite build` emits the app shell first and `vite build -c vite.sw.config.ts`
 * writes sw.js afterwards. The Vite app plugin therefore cannot sanitize the
 * service worker or stale copied public artifacts in its own closeBundle hook.
 */
const fs = require('node:fs');
const path = require('node:path');

function normalizeBasePath(baseUrl) {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed || trimmed === '.' || trimmed === './') {
    return '';
  }

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return '';
    }
  }

  if (!pathname.startsWith('/')) {
    return '';
  }

  const normalized = pathname.replace(/\/+$/, '');
  return normalized === '' || normalized === '/' ? '' : normalized;
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeText(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}

function rewriteFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  let body = fs.readFileSync(filePath, 'utf8');
  const before = body;
  for (const [pattern, replacement] of replacements) {
    body = body.replace(pattern, replacement);
  }

  if (body !== before) {
    writeText(filePath, body);
    return true;
  }
  return false;
}

const basePath = normalizeBasePath(process.env.VITE_BASE_URL || './');
if (basePath !== '/creative') {
  process.exit(0);
}

const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'dist/apps/web');
const versionJSON = readJSON(path.join(outDir, 'version.json')) || {};
const version = typeof versionJSON.version === 'string' ? versionJSON.version : '0.0.0';

let touched = 0;

// sw.js is emitted after the app Vite closeBundle hook. Keep it same-origin and
// scrub standalone package names from the embedded artifact.
if (
  rewriteFile(path.join(outDir, 'sw.js'), [
    [/opentu\.local/gi, 'new-api.local'],
    [/OpenTu/gi, 'New API Creative'],
    [/aitu-app/g, 'new-api-creative'],
    [
      /https:\/\/cdn\.jsdelivr\.net\/npm\/new-api-creative@\{version\}\/\{path\}/g,
      '/creative/{path}',
    ],
    [
      /https:\/\/cdn\.jsdelivr\.net\/npm\/new-api-creative@/g,
      '/creative/',
    ],
  ])
) {
  touched += 1;
}

// Vite prod SW build no longer references a sourcemap, but a stale public
// sw.js.map can be copied by the app build before build-sw overwrites sw.js.
const staleSWMap = path.join(outDir, 'sw.js.map');
if (fs.existsSync(staleSWMap)) {
  fs.rmSync(staleSWMap, { force: true });
  touched += 1;
}

// Embedded deployments should not serve the standalone OpenTU changelog. Keep a
// tiny valid changelog shape for any defensive fetch path.
writeText(
  path.join(outDir, 'changelog.json'),
  `${JSON.stringify(
    {
      versions: [
        {
          version,
          date: new Date().toISOString().slice(0, 10),
          changes: {
            features: ['New API managed Creative embedded build'],
            fixes: [],
            improvements: ['Standalone release notes are hidden in embedded mode'],
          },
          type: 'patch',
          highlights: 'New API Creative embedded build',
        },
      ],
    },
    null,
    2
  )}\n`
);
touched += 1;

console.log(`[EmbeddedCreative] Postprocessed embedded dist final artifacts (${touched} updates)`);
