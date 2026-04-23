/**
 * Story card rendering + zip packaging.
 *
 * The card templates live at /cards/<card-name>/index.html (+ styles.css) and
 * are authored so they work standalone with live-server. At export time we
 * fetch the template, inline the stylesheet, replace {{tokens}}, render the
 * populated HTML inside an off-screen iframe, and capture the .card element
 * with html2canvas.
 */

import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import type { AdventureMeta, CharacterMeta } from './metadata';

export interface CardDef {
  name: string; // folder name under /cards
  width: number;
  height: number;
  fileName: string; // export filename inside the zip
}

export const CHARACTER_PROFILE_CARD: CardDef = {
  name: 'character-profile',
  width: 720,
  height: 1000,
  fileName: '01-character-profile.png',
};

export const CHAT_MESSAGE_CARD: CardDef = {
  name: 'chat-message',
  width: 720,
  height: 1000,
  fileName: 'chat-message.png',
};

export const ADVENTURE_STORY_CARD: CardDef = {
  name: 'adventure-story',
  width: 1280,
  height: 720,
  fileName: 'adventure-story.png',
};

export interface ChatMessage {
  name?: string;
  role: string; // 'user' | 'character' | 'unknown'
  text: string;
}

const MAX_MESSAGE_CHARS = 420;

function replaceTokens(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data[key];
    return v != null ? String(v) : '';
  });
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(chrome.runtime.getURL(path));
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.text();
}

/**
 * Ask the background service worker to fetch an image and return it as a
 * data URL. This sidesteps CORS so html2canvas can paint it cleanly.
 */
function fetchImageAsDataUrl(url: string): Promise<string> {
  return new Promise((resolve) => {
    if (!url) return resolve('');
    chrome.runtime.sendMessage(
      { action: 'FETCH_IMAGE', url },
      (response: { success: boolean; dataUrl?: string }) => {
        if (chrome.runtime.lastError || !response?.success || !response.dataUrl) {
          resolve(''); // fall back to raw URL; html2canvas will still try
          return;
        }
        resolve(response.dataUrl);
      }
    );
  });
}

async function loadPopulatedTemplate(card: CardDef, data: Record<string, string>) {
  const [html, css] = await Promise.all([
    fetchText(`cards/${card.name}/index.html`),
    fetchText(`cards/${card.name}/styles.css`),
  ]);

  // Inline the stylesheet so the iframe does not need a network round-trip
  // (and so live-server paths never leak into the extension export).
  let populated = html.replace(
    /<link[^>]*href=["']styles\.css["'][^>]*>/i,
    `<style>${css}</style>${RENDER_NORMALIZATION_CSS}`
  );

  // Strip the standalone-preview fallback <script> if present — we always
  // ship real values at export time.
  populated = populated.replace(/<script[\s\S]*?<\/script>/gi, '');

  populated = replaceTokens(populated, data);
  return populated;
}

/**
 * Override the live-server-friendly .stage layout so that at rasterization
 * time the .card sits flush at (0,0) with no surrounding padding. This is
 * what keeps extra whitespace from appearing around the card in the PNG.
 */
const RENDER_NORMALIZATION_CSS = `<style>
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
    overflow: hidden !important;
  }
  .stage {
    min-height: 0 !important;
    padding: 0 !important;
    background: transparent !important;
    display: block !important;
  }
</style>`;

function createOffscreenIframe(width: number, height: number): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.style.cssText = [
    'position: fixed',
    'left: -10000px',
    'top: 0',
    `width: ${width}px`,
    `height: ${height}px`,
    'border: 0',
    'pointer-events: none',
    'opacity: 0',
  ].join(';');
  document.body.appendChild(iframe);
  return iframe;
}

function waitForImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images);
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })
    )
  ).then(() => undefined);
}

/** Render a single card template to a PNG Blob. */
export async function renderCardToBlob(
  card: CardDef,
  data: Record<string, string>
): Promise<Blob> {
  const populated = await loadPopulatedTemplate(card, data);
  const iframe = createOffscreenIframe(card.width, card.height);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('iframe contentDocument unavailable');
    doc.open();
    doc.write(populated);
    doc.close();

    // Allow layout + images to settle.
    await new Promise<void>((r) => {
      if (doc.readyState === 'complete') r();
      else doc.addEventListener('readystatechange', () => {
        if (doc.readyState === 'complete') r();
      });
    });
    await waitForImages(doc);
    // Give webfonts / gradients one frame to settle.
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const target = doc.querySelector<HTMLElement>('.card');
    if (!target) throw new Error('.card element not found in template');

    // Use the element's actual rendered rect so html2canvas crops exactly
    // to the card and never picks up surrounding whitespace.
    const rect = target.getBoundingClientRect();
    const w = Math.round(rect.width) || card.width;
    const h = Math.round(rect.height) || card.height;

    const canvas = await html2canvas(target, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      // Render text via the browser's own <foreignObject> path so word
      // spacing and kerning match the live preview instead of html2canvas's
      // manual text layout (which drops spaces at wrap boundaries).
      foreignObjectRendering: true,
      width: w,
      height: h,
      windowWidth: w,
      windowHeight: h,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
      scale: 2,
    });

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        'image/png'
      );
    });
  } finally {
    iframe.remove();
  }
}

// --- Chat message card helpers ---------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(s: string, max = MAX_MESSAGE_CHARS): string {
  if (!s) return '';
  const trimmed = s.trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1).trimEnd() + '…' : trimmed;
}

/** Escape text and convert newlines to <br> so we don't depend on CSS
 *  white-space: pre-wrap (which triggers html2canvas word-joining bugs). */
function escapeAndBreak(s: string): string {
  return escapeHtml(s)
    .split(/\r?\n/)
    .join('<br>');
}

/** Render one message as the bubble HTML consumed by the chat-message card. */
function messageBubbleHtml(msg: ChatMessage, defaultCharacterName: string): string {
  const role = msg.role === 'user' ? 'user' : 'character';
  const displayName =
    role === 'user'
      ? msg.name && msg.name !== 'You'
        ? msg.name
        : 'You'
      : msg.name || defaultCharacterName || 'Character';
  const text = truncate(msg.text);
  return `<div class="msg msg-${role}"><div class="msg-bubble"><div class="msg-head">${escapeHtml(
    displayName
  )}</div><div class="msg-text">${escapeAndBreak(text)}</div></div></div>`;
}

/** Group the extracted messages into sequential pairs (2 per card). */
export function pairMessages(
  messages: ChatMessage[]
): Array<{ first: ChatMessage; second: ChatMessage | null }> {
  const pairs: Array<{ first: ChatMessage; second: ChatMessage | null }> = [];
  for (let i = 0; i < messages.length; i += 2) {
    pairs.push({ first: messages[i], second: messages[i + 1] ?? null });
  }
  return pairs;
}

interface ChatCardTokenData extends Record<string, string> {
  characterName: string;
  characterAvatar: string;
  platform: string;
  cardIndex: string;
  messagesHtml: string;
  date: string;
}

function buildChatCardTokens(params: {
  meta: CharacterMeta;
  avatarDataUrl: string;
  date: string;
  pair: { first: ChatMessage; second: ChatMessage | null };
  index: number; // 1-based
  total: number;
}): ChatCardTokenData {
  const { meta, avatarDataUrl, date, pair, index, total } = params;
  const first = messageBubbleHtml(pair.first, meta.name);
  const second = pair.second ? messageBubbleHtml(pair.second, meta.name) : '';
  return {
    characterName: meta.name || 'Character',
    characterAvatar: avatarDataUrl || meta.avatarUrl || '',
    platform: meta.platform,
    cardIndex: `Part ${index} of ${total}`,
    messagesHtml: first + second,
    date,
  };
}

// --- Zip packaging ---------------------------------------------------------

const PROFILE_TOKENS = (meta: CharacterMeta, avatarDataUrl: string, date: string) => ({
  name: meta.name,
  creator: meta.creator ? `By @${meta.creator}` : '',
  description: meta.description || '',
  avatarUrl: avatarDataUrl || meta.avatarUrl,
  platform: meta.platform,
  date,
});

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export async function buildStoryCardsZip(
  meta: CharacterMeta,
  messages: ChatMessage[],
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const avatarDataUrl = await fetchImageAsDataUrl(meta.avatarUrl);
  const dateStr = `Exported ${new Date().toISOString().slice(0, 10)}`;

  const pairs = pairMessages(messages);
  const totalCards = 1 + pairs.length; // profile + chat pairs
  let done = 0;
  const progress = () => onProgress?.(++done, totalCards);

  const profileBlob = await renderCardToBlob(
    CHARACTER_PROFILE_CARD,
    PROFILE_TOKENS(meta, avatarDataUrl, dateStr)
  );
  progress();

  const chatBlobs: Array<{ name: string; blob: Blob }> = [];
  for (let i = 0; i < pairs.length; i++) {
    const tokens = buildChatCardTokens({
      meta,
      avatarDataUrl,
      date: dateStr,
      pair: pairs[i],
      index: i + 1,
      total: pairs.length,
    });
    const blob = await renderCardToBlob(CHAT_MESSAGE_CARD, tokens);
    chatBlobs.push({ name: `${pad2(i + 2)}-chat-${pad2(i + 1)}.png`, blob });
    progress();
  }

  const zip = new JSZip();
  zip.file(CHARACTER_PROFILE_CARD.fileName, profileBlob);
  for (const { name, blob } of chatBlobs) zip.file(name, blob);
  zip.file(
    'metadata.json',
    JSON.stringify(
      {
        character: meta,
        generatedAt: new Date().toISOString(),
        cards: [
          CHARACTER_PROFILE_CARD.fileName,
          ...chatBlobs.map((c) => c.name),
        ],
        messageCount: messages.length,
      },
      null,
      2
    )
  );
  return zip.generateAsync({ type: 'blob' });
}

// --- Previews --------------------------------------------------------------

/** HTML for the character profile card — used in the modal preview. */
export async function buildProfilePreviewSrcDoc(meta: CharacterMeta): Promise<string> {
  const avatarDataUrl = await fetchImageAsDataUrl(meta.avatarUrl);
  return loadPopulatedTemplate(
    CHARACTER_PROFILE_CARD,
    PROFILE_TOKENS(
      meta,
      avatarDataUrl,
      `Exported ${new Date().toISOString().slice(0, 10)}`
    )
  );
}

/** HTML for the first chat-message card — used in the modal preview. */
export async function buildChatPreviewSrcDoc(
  meta: CharacterMeta,
  messages: ChatMessage[]
): Promise<string | null> {
  const pairs = pairMessages(messages);
  if (pairs.length === 0) return null;
  const avatarDataUrl = await fetchImageAsDataUrl(meta.avatarUrl);
  const tokens = buildChatCardTokens({
    meta,
    avatarDataUrl,
    date: `Exported ${new Date().toISOString().slice(0, 10)}`,
    pair: pairs[0],
    index: 1,
    total: pairs.length,
  });
  return loadPopulatedTemplate(CHAT_MESSAGE_CARD, tokens);
}

export function countCards(messages: ChatMessage[]): number {
  return 1 + pairMessages(messages).length;
}

// --- Adventure story cards (AI Dungeon) -----------------------------------

const ADVENTURE_MAX_USER_CHARS = 240;
const ADVENTURE_MAX_STORY_CHARS = 900; // loose cap — CSS line-clamp trims visually

/** Collapse runs of blank lines into a single paragraph break so the
 *  landscape card doesn't waste its limited vertical space on empty rows. */
function collapseBlankLines(s: string): string {
  return s.replace(/(\r?\n[ \t]*){2,}/g, '\n');
}

/** Render one AI Dungeon message as an adventure-story bubble. */
function adventureBubbleHtml(msg: ChatMessage): string {
  const role = msg.role === 'user' ? 'user' : 'character';
  const label = role === 'user' ? 'Your Action' : 'The Story Continues';
  const max = role === 'user' ? ADVENTURE_MAX_USER_CHARS : ADVENTURE_MAX_STORY_CHARS;
  const text = truncate(collapseBlankLines(msg.text || ''), max);
  return `<div class="msg msg-${role}"><div class="msg-inner"><div class="msg-label">${escapeHtml(
    label
  )}</div><div class="msg-text">${escapeAndBreak(text)}</div></div></div>`;
}

interface AdventureCardTokenData extends Record<string, string> {
  adventureTitle: string;
  platform: string;
  cardIndex: string;
  messagesHtml: string;
  date: string;
}

function buildAdventureCardTokens(params: {
  meta: AdventureMeta;
  date: string;
  pair: { first: ChatMessage; second: ChatMessage | null };
  index: number;
  total: number;
}): AdventureCardTokenData {
  const { meta, date, pair, index, total } = params;
  const first = adventureBubbleHtml(pair.first);
  const second = pair.second ? adventureBubbleHtml(pair.second) : '';
  return {
    adventureTitle: meta.title,
    platform: meta.platform,
    cardIndex: `Chapter ${index} of ${total}`,
    messagesHtml: first + second,
    date,
  };
}

export async function buildAdventureStoryCardsZip(
  meta: AdventureMeta,
  messages: ChatMessage[],
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const dateStr = `Exported ${new Date().toISOString().slice(0, 10)}`;
  const pairs = pairMessages(messages);
  const total = pairs.length;
  let done = 0;

  const blobs: Array<{ name: string; blob: Blob }> = [];
  for (let i = 0; i < pairs.length; i++) {
    const tokens = buildAdventureCardTokens({
      meta,
      date: dateStr,
      pair: pairs[i],
      index: i + 1,
      total,
    });
    const blob = await renderCardToBlob(ADVENTURE_STORY_CARD, tokens);
    blobs.push({ name: `${pad2(i + 1)}-chapter-${pad2(i + 1)}.png`, blob });
    onProgress?.(++done, total);
  }

  const zip = new JSZip();
  for (const { name, blob } of blobs) zip.file(name, blob);
  zip.file(
    'metadata.json',
    JSON.stringify(
      {
        adventure: meta,
        generatedAt: new Date().toISOString(),
        cards: blobs.map((b) => b.name),
        messageCount: messages.length,
      },
      null,
      2
    )
  );
  return zip.generateAsync({ type: 'blob' });
}

export async function buildAdventurePreviewSrcDoc(
  meta: AdventureMeta,
  messages: ChatMessage[]
): Promise<string | null> {
  const pairs = pairMessages(messages);
  if (pairs.length === 0) return null;
  const tokens = buildAdventureCardTokens({
    meta,
    date: `Exported ${new Date().toISOString().slice(0, 10)}`,
    pair: pairs[0],
    index: 1,
    total: pairs.length,
  });
  return loadPopulatedTemplate(ADVENTURE_STORY_CARD, tokens);
}

export function countAdventureCards(messages: ChatMessage[]): number {
  return pairMessages(messages).length;
}
