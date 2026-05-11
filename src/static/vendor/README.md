# vendor/

This directory holds offline copies of third-party browser libraries that
index.html used to load from CDN. Regenerate it with:

    node scripts/sync-vendor.js

Sources and licenses:
- highlight.min.js / highlight/*.css — @highlightjs/cdn-assets (BSD-3-Clause)
- mermaid.min.js — mermaid (MIT)
- html2pdf.bundle.min.js — html2pdf.js (MIT)
- tailwind.min.js — Tailwind Play CDN 3.4.17 (MIT)
