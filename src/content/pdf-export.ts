/**
 * PDF export renderer.
 *
 * Builds a multi-page PDF with selectable text. The same content as
 * the JSON / plain-text exports, laid out as:
 *
 *  - Cover block: title, platform, URL, timestamp.
 *  - Metadata block: character profile (name, creator, description,
 *    greeting, alt greetings, personas) OR adventure metadata
 *    (memory, author's note, tags, story cards).
 *  - Conversation block: each message as a bold "[ROLE] Name" line
 *    plus the wrapped body, with subtle role-based color tinting.
 *
 * Why jsPDF (not puppeteer or html2canvas-on-canvas):
 *  - Pure-client, no extra Chrome permissions, runs in MV3 content
 *    script context.
 *  - Selectable text (html2canvas-to-PDF would render text as image
 *    pixels, which breaks copy-paste, search, and screen readers).
 *  - Small bundle footprint (~150KB gzipped).
 *
 * The renderer manages its own pagination cursor so multi-page
 * conversations break cleanly mid-message rather than cutting a
 * single line in half.
 */

import { jsPDF } from 'jspdf';

import type { AdventureMeta, CharacterMeta } from './metadata';
import { CHARACTER_PROFILE_CARD, renderProfileCardAsBlob } from './story-cards';

interface PdfExportInput {
  timestamp: string;
  url: string;
  site: string | null;
  messages: Array<{ name?: string; role: string; text: string }>;
  characterMeta: CharacterMeta | null;
  adventureMeta: AdventureMeta | null;
}

const PAGE_MARGIN = 48;
const LINE_GAP = 14;
const SECTION_GAP = 18;
const TITLE_SIZE = 22;
const HEADING_SIZE = 14;
const META_SIZE = 10;
const BODY_SIZE = 11;
const ROLE_COLORS: Record<string, [number, number, number]> = {
  USER: [37, 99, 235], // indigo-600
  CHARACTER: [217, 70, 239], // fuchsia-500
  ASSISTANT: [217, 70, 239],
};

/** Avatar (square portrait) draw box — Character.AI / Janitor. */
const AVATAR_BOX = 120;
/** Adventure cover banner box — AI Dungeon. */
const BANNER_MAX_WIDTH = 480;
const BANNER_MAX_HEIGHT = 160;
/**
 * Tall profile-card portrait box — Character.AI / Janitor PDF
 * exports use this when html2canvas can render the full character
 * profile card (avatar + name + bio + greeting + creator) in time.
 * Keeps aspect ratio of CHARACTER_PROFILE_CARD's 600 × 900
 * native size; clamps width to keep ~250pt of vertical space free
 * for the title + metadata block on letter paper.
 */
const PROFILE_CARD_WIDTH = 180;
const PROFILE_CARD_HEIGHT = Math.round(
  PROFILE_CARD_WIDTH * (CHARACTER_PROFILE_CARD.height / CHARACTER_PROFILE_CARD.width)
);

/**
 * Fetch a remote image URL and return its body as a data URL plus a
 * jspdf-friendly format hint, or `null` on any failure (CORS, 404,
 * unsupported mime, network). Treats failure as a non-event: the
 * caller falls back to the text-only PDF path.
 *
 * Uses `credentials: 'omit'` because every URL we'd hero-embed
 * (character avatars on public CDNs, AI Dungeon cover art on
 * `files.aidungeon.com`) is publicly accessible and we don't want
 * to leak the user's session into a CDN's logs.
 */
/** Hard ceiling on the hero-image fetch so a slow CDN can't stall
 *  the export. 8s is well past p99 for any of the public image
 *  hosts we hero-embed (character.ai, ella.janitorai.com,
 *  files.aidungeon.com). */
const HERO_FETCH_TIMEOUT_MS = 8000;

async function fetchImageAsDataUrl(url: string): Promise<
  { dataUrl: string; format: 'PNG' | 'JPEG' } | null
> {
  if (!url || !/^https?:\/\//.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HERO_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    let format: 'PNG' | 'JPEG' | null = null;
    if (contentType.includes('png')) format = 'PNG';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) format = 'JPEG';
    else if (contentType.includes('webp')) {
      // jspdf builds since 2.5 accept webp via the JPEG path on
      // most browsers. Try it; if it errors during addImage the
      // outer catch in `drawHero` swallows it and the PDF ships
      // text-only.
      format = 'JPEG';
    }
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
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert a `Blob` (typically a PNG produced by `renderCardToBlob`)
 * to a data URL the jspdf `addImage` API consumes. Returns `null`
 * on FileReader failure so the PDF render falls back to the bare
 * avatar fetch path instead of breaking.
 */
async function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * State shared across the layout helpers — the doc, the current
 * vertical cursor (`y`), and cached page geometry. Wrapped in a
 * single object so helpers can advance the cursor and trigger page
 * breaks without arg-soup.
 */
interface LayoutCtx {
  doc: jsPDF;
  pageWidth: number;
  pageHeight: number;
  contentWidth: number;
  y: number;
}

function makeCtx(): LayoutCtx {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  return {
    doc,
    pageWidth,
    pageHeight,
    contentWidth: pageWidth - PAGE_MARGIN * 2,
    y: PAGE_MARGIN,
  };
}

/** Move the cursor down by `delta` and break to a new page if we'd overflow. */
function advance(ctx: LayoutCtx, delta: number) {
  ctx.y += delta;
  if (ctx.y > ctx.pageHeight - PAGE_MARGIN) {
    ctx.doc.addPage();
    ctx.y = PAGE_MARGIN;
  }
}

/** Reserve `height` pt of vertical space, paging if it wouldn't fit. */
function ensureSpace(ctx: LayoutCtx, height: number) {
  if (ctx.y + height > ctx.pageHeight - PAGE_MARGIN) {
    ctx.doc.addPage();
    ctx.y = PAGE_MARGIN;
  }
}

function setColor(ctx: LayoutCtx, rgb: [number, number, number]) {
  ctx.doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function resetColor(ctx: LayoutCtx) {
  ctx.doc.setTextColor(17, 24, 39); // slate-900
}

function drawTitle(ctx: LayoutCtx, title: string) {
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(TITLE_SIZE);
  resetColor(ctx);
  const lines = ctx.doc.splitTextToSize(title, ctx.contentWidth) as string[];
  for (const line of lines) {
    ensureSpace(ctx, TITLE_SIZE + 4);
    ctx.doc.text(line, PAGE_MARGIN, ctx.y + TITLE_SIZE);
    advance(ctx, TITLE_SIZE + 4);
  }
}

function drawMetaLine(ctx: LayoutCtx, label: string, value: string) {
  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(META_SIZE);
  ctx.doc.setTextColor(75, 85, 99); // slate-600
  const text = `${label}: ${value}`;
  const lines = ctx.doc.splitTextToSize(text, ctx.contentWidth) as string[];
  for (const line of lines) {
    ensureSpace(ctx, LINE_GAP);
    ctx.doc.text(line, PAGE_MARGIN, ctx.y + META_SIZE);
    advance(ctx, LINE_GAP);
  }
  resetColor(ctx);
}

function drawHeading(ctx: LayoutCtx, text: string) {
  advance(ctx, SECTION_GAP);
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(HEADING_SIZE);
  resetColor(ctx);
  const lines = ctx.doc.splitTextToSize(text, ctx.contentWidth) as string[];
  for (const line of lines) {
    ensureSpace(ctx, HEADING_SIZE + 4);
    ctx.doc.text(line, PAGE_MARGIN, ctx.y + HEADING_SIZE);
    advance(ctx, HEADING_SIZE + 4);
  }
}

function drawSubheading(ctx: LayoutCtx, text: string) {
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(BODY_SIZE);
  resetColor(ctx);
  const lines = ctx.doc.splitTextToSize(text, ctx.contentWidth) as string[];
  for (const line of lines) {
    ensureSpace(ctx, BODY_SIZE + 2);
    ctx.doc.text(line, PAGE_MARGIN, ctx.y + BODY_SIZE);
    advance(ctx, BODY_SIZE + 2);
  }
}

function drawBody(ctx: LayoutCtx, text: string, indent = 0) {
  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(BODY_SIZE);
  resetColor(ctx);
  const wrapWidth = ctx.contentWidth - indent;
  // Preserve intentional newlines from the source by splitting first
  // and wrapping each paragraph independently — `splitTextToSize` on
  // a multi-paragraph string collapses spacing.
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) {
      advance(ctx, LINE_GAP / 2);
      continue;
    }
    const lines = ctx.doc.splitTextToSize(paragraph, wrapWidth) as string[];
    for (const line of lines) {
      ensureSpace(ctx, LINE_GAP);
      ctx.doc.text(line, PAGE_MARGIN + indent, ctx.y + BODY_SIZE);
      advance(ctx, LINE_GAP);
    }
  }
}

function drawDivider(ctx: LayoutCtx) {
  advance(ctx, SECTION_GAP / 2);
  ctx.doc.setDrawColor(229, 231, 235); // slate-200
  ctx.doc.setLineWidth(0.5);
  ctx.doc.line(PAGE_MARGIN, ctx.y, ctx.pageWidth - PAGE_MARGIN, ctx.y);
  advance(ctx, SECTION_GAP / 2);
}

function drawCharacterMeta(ctx: LayoutCtx, meta: CharacterMeta) {
  drawHeading(ctx, 'Character');
  drawMetaLine(ctx, 'Name', meta.name);
  if (meta.title && meta.title !== meta.name) drawMetaLine(ctx, 'Tagline', meta.title);
  if (meta.creator) drawMetaLine(ctx, 'Creator', `@${meta.creator}`);
  if (meta.platform) drawMetaLine(ctx, 'Platform', meta.platform);
  if (meta.likes > 0) drawMetaLine(ctx, 'Likes', meta.likes.toLocaleString());
  if (meta.interactions > 0) drawMetaLine(ctx, 'Interactions', meta.interactions.toLocaleString());
  if (meta.upvotes > 0) drawMetaLine(ctx, 'Upvotes', meta.upvotes.toLocaleString());
  if (meta.description) {
    advance(ctx, LINE_GAP / 2);
    drawSubheading(ctx, 'Description');
    drawBody(ctx, meta.description);
  }
  if (meta.greeting) {
    advance(ctx, LINE_GAP / 2);
    drawSubheading(ctx, 'Greeting');
    drawBody(ctx, meta.greeting);
  }
  if (meta.definition) {
    advance(ctx, LINE_GAP / 2);
    drawSubheading(ctx, 'Definition');
    drawBody(ctx, meta.definition);
  }
  const altGreetings =
    meta.info && Array.isArray((meta.info as any).alternateGreetings)
      ? ((meta.info as any).alternateGreetings as string[])
      : [];
  if (altGreetings.length > 0) {
    advance(ctx, LINE_GAP / 2);
    drawSubheading(ctx, `Alternate greetings (${altGreetings.length})`);
    altGreetings.forEach((g, i) => {
      drawBody(ctx, `${i + 1}. ${g}`);
    });
  }
  const personas =
    meta.info && Array.isArray((meta.info as any).personas)
      ? ((meta.info as any).personas as Array<{
          name?: string;
          appearance?: string;
          pronouns?: string | null;
        }>)
      : [];
  if (personas.length > 0) {
    advance(ctx, LINE_GAP / 2);
    drawSubheading(ctx, `Attached personas (${personas.length})`);
    for (const p of personas) {
      const tag = [p.name, p.pronouns].filter(Boolean).join(', ');
      const line = `${tag || 'Unnamed persona'}${p.appearance ? `: ${p.appearance}` : ''}`;
      drawBody(ctx, line);
    }
  }
}

function drawAdventureMeta(ctx: LayoutCtx, meta: AdventureMeta) {
  drawHeading(ctx, 'Adventure');
  drawMetaLine(ctx, 'Title', meta.title);
  if (meta.author) drawMetaLine(ctx, 'Author', meta.author);
  if (meta.characterName) drawMetaLine(ctx, 'Player character', meta.characterName);
  if (meta.tags?.length) drawMetaLine(ctx, 'Tags', meta.tags.join(', '));
  if (meta.description) {
    advance(ctx, LINE_GAP / 2);
    drawSubheading(ctx, 'Description');
    drawBody(ctx, meta.description);
  }
  if (meta.memory) {
    advance(ctx, LINE_GAP / 2);
    drawSubheading(ctx, 'Memory');
    drawBody(ctx, meta.memory);
  }
  if (meta.authorsNote) {
    advance(ctx, LINE_GAP / 2);
    drawSubheading(ctx, "Author's note");
    drawBody(ctx, meta.authorsNote);
  }
  if (meta.storyCards?.length) {
    advance(ctx, LINE_GAP / 2);
    drawSubheading(ctx, `Story cards (${meta.storyCards.length})`);
    for (const card of meta.storyCards) {
      const header = [card.type, card.title].filter(Boolean).join(' · ');
      drawBody(ctx, `• ${header}`);
      if (card.keys) drawBody(ctx, `  Keys: ${card.keys}`, 12);
      if (card.value) drawBody(ctx, card.value, 12);
    }
  }
}

function drawConversation(
  ctx: LayoutCtx,
  messages: PdfExportInput['messages']
) {
  drawHeading(ctx, `Conversation (${messages.length} messages)`);
  drawDivider(ctx);

  for (const message of messages) {
    const speaker = message.name || 'Unknown';
    const role = (message.role || 'message').toUpperCase();

    ctx.doc.setFont('helvetica', 'bold');
    ctx.doc.setFontSize(BODY_SIZE);
    const tint = ROLE_COLORS[role];
    if (tint) setColor(ctx, tint);
    else resetColor(ctx);
    const headerLine = `[${role}] ${speaker}`;
    ensureSpace(ctx, LINE_GAP * 2);
    ctx.doc.text(headerLine, PAGE_MARGIN, ctx.y + BODY_SIZE);
    advance(ctx, LINE_GAP);
    resetColor(ctx);

    drawBody(ctx, message.text, 12);
    advance(ctx, LINE_GAP / 2);
  }
}

/**
 * Draw a hero image at the top of the document.
 *
 *  - `kind: 'avatar'` centers a square portrait of fixed
 *    {@link AVATAR_BOX} side. Used for Character.AI / Janitor
 *    character avatars.
 *  - `kind: 'banner'` centers a wide image clamped to
 *    {@link BANNER_MAX_WIDTH} × {@link BANNER_MAX_HEIGHT}, scaled
 *    proportionally. Used for AI Dungeon adventure cover art.
 *
 * Both paths advance the cursor by the drawn height plus a section
 * gap so subsequent `drawTitle` lands cleanly below the hero. Any
 * `addImage` exception (corrupt blob, unsupported codec) is
 * swallowed and the PDF falls through to the text-only path.
 */
function drawHero(
  ctx: LayoutCtx,
  dataUrl: string,
  format: 'PNG' | 'JPEG',
  kind: 'avatar' | 'banner' | 'profile-card'
) {
  let drawWidth: number;
  let drawHeight: number;
  if (kind === 'avatar') {
    drawWidth = AVATAR_BOX;
    drawHeight = AVATAR_BOX;
  } else if (kind === 'profile-card') {
    drawWidth = PROFILE_CARD_WIDTH;
    drawHeight = PROFILE_CARD_HEIGHT;
  } else {
    drawWidth = BANNER_MAX_WIDTH;
    drawHeight = BANNER_MAX_HEIGHT;
  }
  // Clamp to the page's content width minus margins so a 480pt
  // banner doesn't bleed past the edge on letter-size paper.
  if (drawWidth > ctx.contentWidth) {
    const scale = ctx.contentWidth / drawWidth;
    drawWidth = ctx.contentWidth;
    drawHeight = drawHeight * scale;
  }
  const x = PAGE_MARGIN + (ctx.contentWidth - drawWidth) / 2;
  ensureSpace(ctx, drawHeight + SECTION_GAP);
  try {
    ctx.doc.addImage(dataUrl, format, x, ctx.y, drawWidth, drawHeight);
    advance(ctx, drawHeight + SECTION_GAP);
  } catch {
    /* fall through to text-only */
  }
}

/**
 * Build the PDF and return it as a Blob ready for download.
 *
 * Asynchronous so the renderer can fetch + embed a hero image
 * (character avatar or adventure cover) when one is available.
 * Image fetch failure is non-fatal — the PDF still ships with
 * the rest of the content.
 */
export async function renderPdfExport(data: PdfExportInput): Promise<Blob> {
  const ctx = makeCtx();
  const title =
    data.characterMeta?.name ||
    data.adventureMeta?.title ||
    'Wilds AI Export';

  // Hero (best-effort, three-tier fallback for character / janitor;
  // single-tier fetch for AI Dungeon):
  //
  //   1. Character.AI / Janitor → render the full profile card via
  //      html2canvas (avatar + name + creator + description +
  //      greeting). Visually richer than a bare avatar — the same
  //      treatment users get from the Story Cards ZIP path.
  //   2. If the card render fails, fall back to v0.4.0's bare
  //      avatar fetch (smaller, square hero).
  //   3. AI Dungeon → cover-image fetch as the wide banner. The
  //      adventure card would also work via renderCardToBlob, but
  //      adventures already publish a cover image we can embed
  //      directly without the html2canvas round-trip.
  let heroDrawn = false;
  if (data.characterMeta) {
    const cardBlob = await renderProfileCardAsBlob(data.characterMeta);
    if (cardBlob) {
      const dataUrl = await blobToDataUrl(cardBlob);
      if (dataUrl) {
        drawHero(ctx, dataUrl, 'PNG', 'profile-card');
        heroDrawn = true;
      }
    }
  }
  if (!heroDrawn) {
    const heroUrl =
      data.characterMeta?.avatarUrl || data.adventureMeta?.image || '';
    const heroKind: 'avatar' | 'banner' = data.adventureMeta ? 'banner' : 'avatar';
    if (heroUrl) {
      const fetched = await fetchImageAsDataUrl(heroUrl);
      if (fetched) {
        drawHero(ctx, fetched.dataUrl, fetched.format, heroKind);
      }
    }
  }

  drawTitle(ctx, title);
  drawMetaLine(ctx, 'Platform', data.site ?? 'unknown');
  drawMetaLine(ctx, 'URL', data.url);
  drawMetaLine(ctx, 'Exported', data.timestamp);

  if (data.characterMeta) drawCharacterMeta(ctx, data.characterMeta);
  if (data.adventureMeta) drawAdventureMeta(ctx, data.adventureMeta);

  drawConversation(ctx, data.messages);

  return ctx.doc.output('blob');
}
