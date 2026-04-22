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
import type { CharacterMeta } from './metadata';

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

export async function buildStoryCardsZip(meta: CharacterMeta): Promise<Blob> {
  const avatarDataUrl = await fetchImageAsDataUrl(meta.avatarUrl);
  const resolvedAvatar = avatarDataUrl || meta.avatarUrl;

  const data: Record<string, string> = {
    name: meta.name,
    creator: meta.creator,
    description:
      meta.description ||
      `An AI companion from ${meta.platform}. Exported with Wilds AI.`,
    avatarUrl: resolvedAvatar,
    platform: meta.platform,
    date: `Exported ${new Date().toISOString().slice(0, 10)}`,
  };

  const profileBlob = await renderCardToBlob(CHARACTER_PROFILE_CARD, data);

  const zip = new JSZip();
  zip.file(CHARACTER_PROFILE_CARD.fileName, profileBlob);
  zip.file(
    'metadata.json',
    JSON.stringify(
      {
        character: meta,
        generatedAt: new Date().toISOString(),
        cards: [CHARACTER_PROFILE_CARD.fileName],
      },
      null,
      2
    )
  );
  return zip.generateAsync({ type: 'blob' });
}

/** A lightweight HTML preview (no rasterization) for the export modal. */
export async function buildPreviewSrcDoc(meta: CharacterMeta): Promise<string> {
  const avatarDataUrl = await fetchImageAsDataUrl(meta.avatarUrl);
  const data: Record<string, string> = {
    name: meta.name,
    creator: meta.creator,
    description:
      meta.description ||
      `An AI companion from ${meta.platform}. Exported with Wilds AI.`,
    avatarUrl: avatarDataUrl || meta.avatarUrl,
    platform: meta.platform,
    date: `Exported ${new Date().toISOString().slice(0, 10)}`,
  };
  return loadPopulatedTemplate(CHARACTER_PROFILE_CARD, data);
}
