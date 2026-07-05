# dogfood-ui plan — mdv-live 0.5.18 offline conversion

**Target**: http://localhost:8071/
**Test files**: `/tmp/mdv-offline-test/{test,marp}.md`
**Regression focus**: every 0.5.16 / 0.5.17 feature must keep working after the CDN→vendor swap.

| # | Area | Procedure | PASS criteria |
|---|---|---|---|
| 1 | server boot | navigate / | page loads, no missing vendor 404 |
| 2 | no external CDN | inspect network log | zero requests to cdnjs / jsdelivr / cdn.tailwindcss.com |
| 3 | file tree | open / | test.md + marp.md visible |
| 4 | tab open | click test.md | tab appears, content rendered |
| 5 | markdown render | inspect content | H1/H2/lists rendered |
| 6 | code highlight (Python) | inspect `pre code.hljs` | tokens colored by github theme |
| 7 | mermaid render | inspect `.mermaid svg` | svg present, nodes visible |
| 8 | Tailwind UI | inspect computed style of `.toolbar-btn` | non-default padding/color from Tailwind |
| 9 | theme toggle | click `#themeToggle` | `data-theme` flips, hljs href flips github↔github-dark |
| 10 | Marp split layout | open marp.md | `.marp-split` exists with slide + notes areas |
| 11 | inline notes (0.5.16) | inspect notes area | speaker notes from `<!--...-->` shown |
| 12 | inline notes autosave (0.5.16) | edit notes textarea, wait 1s | file mtime advances; reload preserves edit |
| 13 | edit mode (0.5.17) | click `#editToggle` on test.md | textarea visible, status `Ready` |
| 14 | edit autosave (0.5.17) | type, wait 2s | status transitions Modified→Saving→Saved, file content updated |
| 15 | revert to original | undo edits, save | file restored, diff clean |
| 16 | PDF button | click `#printBtn` | hands off to print path (skip actual print) |
| 17 | sidebar toggle | click `#sidebarToggle` | sidebar hides/shows |
| 18 | offline 真值 | block all non-localhost via route interception, reload | page still renders + features 1-9 work |
