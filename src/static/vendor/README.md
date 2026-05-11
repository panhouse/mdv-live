# vendor/

This directory holds offline copies of third-party browser libraries that
index.html used to load from CDN. Regenerate it with:

    node scripts/sync-vendor.js

Sources and licenses (full text in vendor/licenses/):
- highlight.min.js / highlight/*.css — @highlightjs/cdn-assets (BSD-3-Clause)
- mermaid.min.js — mermaid (MIT)
- html2pdf.bundle.min.js — html2pdf.js (MIT); see also
  html2pdf.bundle.min.js.LICENSE.txt for embedded notices
- tailwind.min.js — Tailwind CSS Play CDN 3.4.17 (MIT)
