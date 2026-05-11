#!/usr/bin/env node
// Populates src/static/vendor/ with offline copies of the libraries that
// index.html used to load from CDN. Run manually when bumping versions.
//
//   node scripts/sync-vendor.js
//
// Source map files are skipped to keep the npm tarball small.

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const vendorDir = resolve(repoRoot, 'src/static/vendor');

const TAILWIND_VERSION = '3.4.17';
const TAILWIND_URL = `https://cdn.tailwindcss.com/${TAILWIND_VERSION}`;

async function copyFromNodeModules(relSource, relDest) {
  const src = resolve(repoRoot, 'node_modules', relSource);
  const dest = resolve(vendorDir, relDest);
  if (!existsSync(src)) {
    throw new Error(`Missing source file: ${src} (did you run npm install?)`);
  }
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest);
  console.log(`copied  ${relSource} -> vendor/${relDest}`);
}

function downloadToString(url) {
  return new Promise((resolveDownload, rejectDownload) => {
    https.get(url, { headers: { 'User-Agent': 'mdv-live sync-vendor' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolveDownload(downloadToString(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) {
        rejectDownload(new Error(`GET ${url} -> ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolveDownload(Buffer.concat(chunks)));
      res.on('error', rejectDownload);
    }).on('error', rejectDownload);
  });
}

async function downloadTailwind() {
  const dest = resolve(vendorDir, 'tailwind.min.js');
  const body = await downloadToString(TAILWIND_URL);
  const header = `/*! Tailwind CSS Play CDN ${TAILWIND_VERSION} - downloaded from ${TAILWIND_URL} */\n`;
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, header + body.toString('utf8'));
  console.log(`downloaded tailwind ${TAILWIND_VERSION} -> vendor/tailwind.min.js (${body.length} bytes)`);
}

async function main() {
  if (existsSync(vendorDir)) {
    await rm(vendorDir, { recursive: true, force: true });
  }
  await mkdir(vendorDir, { recursive: true });

  await copyFromNodeModules('@highlightjs/cdn-assets/highlight.min.js', 'highlight.min.js');
  await copyFromNodeModules('@highlightjs/cdn-assets/styles/github.min.css', 'highlight/github.min.css');
  await copyFromNodeModules('@highlightjs/cdn-assets/styles/github-dark.min.css', 'highlight/github-dark.min.css');
  await copyFromNodeModules('mermaid/dist/mermaid.min.js', 'mermaid.min.js');
  await copyFromNodeModules('html2pdf.js/dist/html2pdf.bundle.min.js', 'html2pdf.bundle.min.js');

  await downloadTailwind();

  const readme = `# vendor/

This directory holds offline copies of third-party browser libraries that
index.html used to load from CDN. Regenerate it with:

    node scripts/sync-vendor.js

Sources and licenses:
- highlight.min.js / highlight/*.css — @highlightjs/cdn-assets (BSD-3-Clause)
- mermaid.min.js — mermaid (MIT)
- html2pdf.bundle.min.js — html2pdf.js (MIT)
- tailwind.min.js — Tailwind Play CDN ${TAILWIND_VERSION} (MIT)
`;
  await writeFile(resolve(vendorDir, 'README.md'), readme);
  console.log('wrote   vendor/README.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
