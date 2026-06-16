#!/usr/bin/env node

/**
 * Lightweight CI-callable guard for the embedded /creative boot fixes.
 *
 * It intentionally avoids starting a server or touching production. The check
 * verifies:
 * - embedded app shell source defaults Service Worker off unless ?sw=1;
 * - the boot shell has a bounded managed-script/cdn-config timeout;
 * - the final embedded dist postprocess creates missing Vite browser external
 *   shim files referenced from dist/assets chunks.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertSourceBootGuards() {
  const indexHtml = read('apps/web/index.html');
  const mainTsx = read('apps/web/src/main.tsx');

  assert.match(
    indexHtml,
    /BOOT_MANAGED_SCRIPT_TIMEOUT_MS/,
    'index.html must bound cdn-config/managed boot script loading'
  );
  assert.match(
    indexHtml,
    /swParam === '1'[\s\S]*return true/,
    'index.html must allow embedded early Service Worker only with ?sw=1'
  );
  assert.match(
    indexHtml,
    /isEmbeddedCreativeBoot\(\)[\s\S]*return false/,
    'index.html must default embedded /creative early Service Worker off'
  );

  assert.match(
    mainTsx,
    /isCreativeEmbeddedMode[\s\S]*isServiceWorkerExplicitlyEnabled/,
    'main.tsx must detect embedded mode and explicit ?sw=1'
  );
  assert.match(
    mainTsx,
    /shouldCleanupServiceWorker/,
    'main.tsx must unregister disabled embedded Service Worker registrations'
  );
}

function assertPostprocessCreatesMissingBrowserExternalShim() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentu-creative-dist-'));
  try {
    const assetsDir = path.join(tempDir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'version.json'),
      JSON.stringify({ version: 'test' })
    );
    fs.writeFileSync(path.join(tempDir, 'sw.js'), 'const name = "OpenTu";\n');
    fs.writeFileSync(
      path.join(assetsDir, 'entry.js'),
      'import fsShim, { readFileSync, promises } from "./__vite-browser-external-fs-test.js";\nconsole.log(fsShim, readFileSync, promises);\n'
    );

    execFileSync('node', [path.join(repoRoot, 'scripts/postprocess-embedded-creative-dist.js')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        VITE_BASE_URL: '/creative/',
        OPENTU_EMBEDDED_DIST_DIR: tempDir,
      },
      stdio: 'pipe',
    });

    const shimPath = path.join(
      assetsDir,
      '__vite-browser-external-fs-test.js'
    );
    assert.equal(fs.existsSync(shimPath), true, 'missing browser external shim');
    const shim = fs.readFileSync(shimPath, 'utf8');
    assert.match(shim, /export default shim/);
    assert.match(shim, /export const promises/);
    assert.match(shim, /export function readFileSync/);
    assert.match(shim, /export function writeFileSync/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

assertSourceBootGuards();
assertPostprocessCreatesMissingBrowserExternalShim();

console.log('[CreativeEmbeddedStartup] startup and postprocess guards passed');
