---
title: Embed hero image in extension PDF exports
date: 2026-04-27
status: approved
owner: wilds-ai
depends_on:
  - src/content/pdf-export.ts
  - src/content/index.ts
supersedes: none
---

# Embed hero image in extension PDF exports

The v0.3.0 PDF export (sub-project B in the wilds-ai monorepo
session) ships text-only documents with role-tinted message
headers. This loop adds an embedded hero image at the top of each
PDF: Character.AI / Janitor character avatars, AI Dungeon
adventure cover art.

The PDFs become visually richer without sacrificing the small
bundle footprint (jspdf is already in the extension; we just call
its `addImage` method on already-loaded jspdf instances).

## TL;DR

- New `fetchImageAsDataUrl(url)` helper in `src/content/pdf-export.ts`.
  Resolves to `{ dataUrl, format: 'PNG' | 'JPEG' } | null`. Returns
  `null` on any failure (CORS, 404, invalid mime, network).
- `renderPdfExport` becomes `async` and tries to fetch + embed the
  hero image before drawing the title. Text-only fallback when fetch
  returns `null`.
- Caller in `src/content/index.ts` already runs in an async click
  handler — minor signature change.

## Design principles

- **Graceful degradation.** External images are unreliable
  (CORS, expired signed URLs, transient 5xx). Image-fetch failure
  must never break the PDF — it falls back to text-only with a
  log warning.
- **Aspect-ratio preserved.** Hero clamps to a max box (200pt
  wide, 200pt tall). The shorter axis scales to fit.
- **Format auto-detected.** jspdf needs PNG vs JPEG hint; sniff
  the response `content-type` header.
- **Avatar gets a centered square; cover gets a banner.** Match
  source semantics — character avatars are typically square
  portraits, AI Dungeon covers are wider landscape banners.

## Architecture

### § 1. Image-fetch helper

```ts
async function fetchImageAsDataUrl(url: string): Promise<
  { dataUrl: string; format: 'PNG' | 'JPEG' } | null
> {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    let format: 'PNG' | 'JPEG' | null = null;
    if (contentType.includes('png')) format = 'PNG';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) format = 'JPEG';
    else if (contentType.includes('webp')) format = 'JPEG'; // jspdf accepts webp via JPEG path on most builds
    if (!format) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (!dataUrl) return null;
    return { dataUrl, format };
  } catch {
    return null;
  }
}
```

### § 2. Hero placement

Before `drawTitle` in `renderPdfExport`, attempt to fetch the
hero. If successful, reserve up to 160pt vertical space, draw the
image scaled-to-fit, then advance the cursor. If it fails or
there's no source URL, skip silently and proceed with the
text-only path.

For Character.AI / Janitor: hero is `characterMeta.avatarUrl`.
Drawn as a 120x120pt centered square.

For AI Dungeon: hero is `adventureMeta.image`. Drawn as a wide
banner (max 480pt wide, max 160pt tall, centered).

### § 3. Async signature change

`renderPdfExport(data): Blob` becomes
`renderPdfExport(data): Promise<Blob>`. Caller in `index.ts`
already wraps the call in an async click handler so it just needs
an `await`.

### § 4. Tests

RED-first:

1. `fetchImageAsDataUrl` returns null on a 404.
2. `fetchImageAsDataUrl` returns null on a non-image content-type.
3. `fetchImageAsDataUrl` returns `{ dataUrl: 'data:image/png;...', format: 'PNG' }` on a 200 PNG.
4. `renderPdfExport` still produces a valid `%PDF-` blob when
   `fetchImageAsDataUrl` returns null (text-only fallback path).
5. `renderPdfExport` still produces a valid `%PDF-` blob when
   `fetchImageAsDataUrl` returns a data URL (image-embedded path).

## Components + test strategy

| Path | Role |
|---|---|
| `src/content/pdf-export.ts` | New helper + async `renderPdfExport` + hero draw |
| `src/content/__tests__/pdf-export.test.ts` | New vitest cases (5) |
| `src/content/index.ts` | `await renderPdfExport(data)` |
| `package.json` | bump to 0.4.0 |
| `public/manifest.json` | bump to 0.4.0 |
| `README.md` | mention richer PDFs in the formats list |

## Non-goals

- Inline PNG story-card thumbnails (next-loop polish — they're
  already exported as separate PNG cards in a zip).
- Embedding multiple images per chat (for example, every selfie
  the companion sent). Bundle size + memory cost trade-off.
- Custom fonts. PDF stays Helvetica-only.
