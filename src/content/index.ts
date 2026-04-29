/**
 * Content script injected into character.ai and AI Dungeon pages.
 *
 * Responsibilities:
 *  - Detect the current site and whether we're on a chat/adventure page.
 *  - Inject the floating "Export" button and export modal.
 *  - Extract chat messages from the live DOM.
 *  - Orchestrate the export flow: collect messages + metadata, then hand off
 *    to the JSON / story-card renderers.
 *  - Respond to `EXPORT_CHAT` messages from the popup.
 *
 * Kept as a single bundle (see `vite.content.config.ts`) because MV3 content
 * scripts can't use top-level ESM imports — everything must be IIFE.
 */

import {
  buildJanitorCharacterMeta,
  buildJanitorMessages,
  extractAIDungeonAdventure,
  extractAdventureMetaAIDungeon,
  extractChaiConversation,
  extractCharacterMetaCharacterAI,
  type AdventureMessage,
  type AdventureMeta,
  type CharacterMeta,
  type JanitorRawMessage,
} from './metadata';
import {
  ADVENTURE_LORE_CARD,
  ADVENTURE_STORY_CARD,
  CHARACTER_PROFILE_CARD,
  buildAdventureLorePreviewSrcDoc,
  buildAdventurePreviewSrcDoc,
  buildAdventureStoryCardsZip,
  buildChatPreviewSrcDoc,
  buildProfilePreviewSrcDoc,
  buildStoryCardsZip,
  countAdventureCards,
  countAdventureLoreCards,
  countCards,
  type ChatMessage,
} from './story-cards';
import { renderTextExport } from './text-export';
import { renderPdfExport } from './pdf-export';

console.log('Wilds AI Exporter: Content script loaded');

const LOGO_URL = chrome.runtime.getURL('wilds-logo.svg');

/** Supported host shorthand used throughout the content script. */
type Site = 'character' | 'aidungeon' | 'janitor' | 'chai' | null;

/** Identify the current host; returns `null` if we're on an unknown site. */
function getSite(): Site {
  const host = window.location.hostname;
  if (host.includes('character.ai')) return 'character';
  if (host.includes('aidungeon.com')) return 'aidungeon';
  if (host.includes('janitorai.com')) return 'janitor';
  if (host.includes('chai-ai.com')) return 'chai';
  return null;
}

/**
 * Whether the current URL is a chat/adventure view (as opposed to the site's
 * homepage, search, profile, etc.). Used to decide whether to show the
 * floating Export button.
 */
function isChatPage() {
  const site = getSite();
  const path = window.location.pathname;

  if (site === 'character') {
    return /^\/chat\/[a-zA-Z0-9_-]+$/.test(path);
  }

  if (site === 'aidungeon') {
    return /^\/adventure\/[a-zA-Z0-9_-]+\/.*\/play$/.test(path);
  }

  if (site === 'janitor') {
    return /^\/chats\/[a-zA-Z0-9-]+$/.test(path);
  }

  if (site === 'chai') {
    return /^\/chat\/[a-zA-Z0-9_-]+$/.test(path);
  }

  return false;
}

/** Pull the chat id from /chats/:id on Janitor. Null if we're not on a chat. */
function getJanitorChatId(): string | null {
  if (getSite() !== 'janitor') return null;
  const m = window.location.pathname.match(/^\/chats\/([a-zA-Z0-9-]+)$/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Janitor AI: passive network capture
// ---------------------------------------------------------------------------
//
// `janitor-monitor.js` runs in the page's MAIN world and forwards captured
// fetch responses to us via window.postMessage. We accumulate them per chat
// id so the export flow can read a complete payload synchronously.

const JANITOR_MONITOR_TAG = 'wilds-janitor-monitor';

interface JanitorChatCache {
  initial: any | null;
  messages: Map<number, JanitorRawMessage>;
}

const janitorCache = new Map<string, JanitorChatCache>();

/** Get-or-create the cache slot for a given chat id. */
function getJanitorCache(chatId: string): JanitorChatCache {
  let entry = janitorCache.get(chatId);
  if (!entry) {
    entry = { initial: null, messages: new Map() };
    janitorCache.set(chatId, entry);
  }
  return entry;
}

/**
 * Merge any number of Janitor raw messages into the per-chat cache, keyed
 * by id so re-emissions and the initial+POST overlap don't produce dupes.
 */
function ingestJanitorMessages(chatId: string, raw: unknown) {
  if (!Array.isArray(raw)) return;
  const cache = getJanitorCache(chatId);
  for (const m of raw) {
    if (m && typeof m === 'object' && typeof (m as any).id === 'number') {
      cache.messages.set((m as JanitorRawMessage).id, m as JanitorRawMessage);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.source !== JANITOR_MONITOR_TAG) return;
    const chatId = String(data.chatId || '');
    if (!chatId) return;

    if (data.kind === 'chat' && data.data) {
      const cache = getJanitorCache(chatId);
      cache.initial = data.data;
      // The initial payload also embeds the first message(s); fold them in.
      ingestJanitorMessages(chatId, data.data?.chatMessages);
    } else if (data.kind === 'messages' && data.data) {
      ingestJanitorMessages(chatId, data.data);
    }
  });
}

/**
 * Ask the main-world monitor to actively re-fetch /hampter/chats/:id. Used
 * as a cold-start path when the user installs the extension mid-session and
 * we never observed the original GET. Resolves once the monitor reports
 * back, or rejects after a timeout.
 */
function requestJanitorReplay(chatId: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== window) return;
      const d = ev.data;
      if (
        !d ||
        d.source !== JANITOR_MONITOR_TAG ||
        d.kind !== 'replay-result' ||
        d.requestId !== requestId
      ) {
        return;
      }
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (d.ok) resolve();
      else reject(new Error(d.error || 'Janitor replay failed'));
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Janitor replay timed out'));
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage(
      {
        source: JANITOR_MONITOR_TAG,
        kind: 'replay-request',
        chatId,
        requestId,
      },
      window.location.origin
    );
  });
}

/**
 * Scrape the character.ai chat transcript from the live DOM.
 *
 * The chat list is rendered inside `#chat-messages` as a column of "message
 * groups". Each group may contain multiple completed-message nodes if the
 * user has used character.ai's "swipes" feature to regenerate a reply —
 * in that case we pick the active swipe slide so we get the version the
 * user currently sees. Finally, the list is reversed because character.ai
 * renders newest-first top-to-bottom.
 */
function extractCharacterAI() {
  const container = document.getElementById('chat-messages');
  if (!container) return null;

  const messageGroups = Array.from(container.children);
  const extractedMessages = [];

  for (const group of messageGroups) {
    const completedMessages = Array.from(
      group.querySelectorAll('[data-testid="completed-message"]')
    );
    if (completedMessages.length === 0) continue;

    let activeMessageEl: Element | null = null;
    if (completedMessages.length > 1 || group.querySelector('.swiper')) {
      activeMessageEl = group.querySelector(
        '.swiper-slide-active [data-testid="completed-message"]'
      );
      if (!activeMessageEl) activeMessageEl = completedMessages[0];
    } else {
      activeMessageEl = completedMessages[0];
    }

    if (!activeMessageEl) continue;
    const prose = activeMessageEl.querySelector('.prose');
    if (!prose) continue;

    const paragraphs = Array.from(prose.querySelectorAll('p'));
    const text =
      paragraphs.length > 0
        ? paragraphs
            .map((p) => p.textContent?.trim())
            .filter((t) => t)
            .join('\n')
        : prose.textContent?.trim() || '';

    const nameEl = group.querySelector('.text-sm');
    const name = nameEl ? nameEl.textContent?.trim() : 'Unknown';

    const isCharacter = !!group.querySelector('.bg-secondary');
    const isUser = !!group.querySelector('.flex-row-reverse');
    const role = isCharacter ? 'character' : isUser ? 'user' : 'unknown';

    extractedMessages.push({ name, role, text });
  }

  return extractedMessages.reverse();
}

/**
 * DOM-fallback extractor for AI Dungeon. The GraphQL API (see
 * `extractAIDungeonAdventure`) is the preferred path; this only runs when the
 * API call fails (logged out, rate limited, or network error). It relies on
 * the AI Dungeon DOM structure and will miss anything off-screen.
 */
function extractAIDungeon() {
  const container = document.getElementById('gameplay-output');
  if (!container) return null;

  const extractedMessages: Array<{ name: string; role: string; text: string }> = [];

  const elements = Array.from(
    container.querySelectorAll('span[role="document"], div#transition-opacity')
  );

  for (const el of elements) {
    if (el.tagName === 'SPAN' && el.getAttribute('role') === 'document') {
      const text = el.textContent?.trim();
      if (text) {
        extractedMessages.push({ name: 'Story/AI', role: 'character', text });
      }
    } else if (el.tagName === 'DIV' && el.id === 'transition-opacity') {
      const actionTextEl = el.querySelector('#action-text');
      const text = actionTextEl?.textContent?.trim();
      if (text) {
        extractedMessages.push({ name: 'You', role: 'user', text });
      }
    }
  }

  return extractedMessages;
}

/**
 * Gather every piece of data the exporter needs for the current page.
 *
 * Branches on site and returns exactly one of `characterMeta` /
 * `adventureMeta`. For AI Dungeon, it tries the GraphQL API first; if that
 * fails (no auth token, request error) it falls back to DOM scraping with
 * a title-only `AdventureMeta`.
 */
async function collectExportData(): Promise<{
  messages: Array<{ name?: string; role: string; text: string }>;
  characterMeta: CharacterMeta | null;
  adventureMeta: AdventureMeta | null;
}> {
  const site = getSite();

  if (site === 'character') {
    return {
      messages: extractCharacterAI() || [],
      characterMeta: await extractCharacterMetaCharacterAI(),
      adventureMeta: null,
    };
  }

  if (site === 'aidungeon') {
    const api = await extractAIDungeonAdventure();
    if (api) {
      return {
        messages: api.messages as AdventureMessage[],
        characterMeta: null,
        adventureMeta: api.meta,
      };
    }
    // Fallback: DOM-based extraction when the API isn't reachable
    // (logged out, network error, auth expired).
    return {
      messages: extractAIDungeon() || [],
      characterMeta: null,
      adventureMeta: extractAdventureMetaAIDungeon(),
    };
  }

  if (site === 'janitor') {
    const chatId = getJanitorChatId();
    if (!chatId) {
      return { messages: [], characterMeta: null, adventureMeta: null };
    }
    let cache = getJanitorCache(chatId);
    // Cold-start: nothing observed yet, ask the monitor to fetch live.
    if (!cache.initial) {
      try {
        await requestJanitorReplay(chatId);
      } catch (err) {
        console.error('Wilds AI: Janitor replay failed', err);
      }
      cache = getJanitorCache(chatId);
    }
    const characterMeta = cache.initial
      ? buildJanitorCharacterMeta(cache.initial)
      : null;
    const messages = buildJanitorMessages({
      initial: cache.initial,
      messages: Array.from(cache.messages.values()),
    });
    return { messages, characterMeta, adventureMeta: null };
  }

  if (site === 'chai') {
    const chai = await extractChaiConversation();
    if (!chai) {
      return { messages: [], characterMeta: null, adventureMeta: null };
    }
    return {
      messages: chai.messages,
      characterMeta: chai.meta,
      adventureMeta: null,
    };
  }

  return { messages: [], characterMeta: null, adventureMeta: null };
}

/**
 * Trigger a browser download for an in-memory Blob by programmatically
 * clicking a temporary anchor element. The object URL is revoked shortly
 * after to release memory (delayed so the download has a chance to start).
 */
function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Turn a display name into a filesystem-safe slug, capped at 40 chars. */
function sanitize(name: string) {
  return (name || 'export').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'export';
}

/** Serializable payload handed off to both the JSON download and the preview pane. */
interface ExportPayload {
  timestamp: string;
  url: string;
  site: Site;
  messages: Array<{ name?: string; role: string; text: string }>;
  characterMeta: CharacterMeta | null;
  adventureMeta: AdventureMeta | null;
}

/**
 * Open the export modal overlay. The modal has two tabs (JSON / Story Cards)
 * and shows the appropriate pane based on whether we have character or
 * adventure metadata. The modal returns itself by replacing the DOM on
 * close — no framework involved, just handwritten DOM.
 */
function showExportUI(data: ExportPayload) {
  if (document.getElementById('cai-exporter-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'cai-exporter-overlay';
  overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 99999;`;

  const modal = document.createElement('div');
  modal.id = 'cai-exporter-modal';
  modal.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 92%; max-width: 760px; max-height: 90vh; background: white; border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25); z-index: 100000; display: flex;
    flex-direction: column; padding: 22px; font-family: sans-serif; color: #111827;
    overflow: hidden;
  `;

  const header = document.createElement('div');
  header.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;`;
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <a href="https://wilds.ai/" target="_blank" rel="noopener noreferrer" style="display: inline-flex; line-height: 0;">
        <img src="${LOGO_URL}" style="width: 32px; height: 32px;" />
      </a>
      <div>
        <h2 style="margin:0; font-size: 1.35rem; font-weight: 700; color: #6366f1;">Export ${
          data.site === 'aidungeon' ? 'Adventure' : 'Chat'
        }</h2>
        <p style="margin: 4px 0 0; font-size: 0.85rem; color: #6b7280;">
          ${data.messages.length} messages${
    data.characterMeta ? ` · ${data.characterMeta.name}` : ''
  }${data.adventureMeta ? ` · ${data.adventureMeta.title}` : ''}
        </p>
      </div>
    </div>
  `;
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `border: none; background: none; font-size: 2rem; cursor: pointer; color: #9ca3af; line-height: 1; padding: 0;`;
  const closeModal = () => {
    modal.remove();
    overlay.remove();
  };
  closeBtn.onclick = closeModal;
  overlay.onclick = closeModal;
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Tab bar — JSON, Text, PDF, Story Cards. Default depends on
  // whether we have character/adventure metadata (Story Cards is the
  // most engaging starting point in that case).
  const tabs = document.createElement('div');
  tabs.style.cssText = `display: flex; gap: 6px; border-bottom: 1px solid #e5e7eb; margin-bottom: 14px; flex-wrap: wrap;`;
  const tabJson = document.createElement('button');
  const tabText = document.createElement('button');
  const tabPdf = document.createElement('button');
  const tabCards = document.createElement('button');
  const tabStyle = `
    background: none; border: none; padding: 10px 14px; cursor: pointer;
    font-size: 0.95rem; font-weight: 600; color: #6b7280; border-bottom: 2px solid transparent;
  `;
  tabJson.textContent = 'JSON';
  tabText.textContent = 'Text';
  tabPdf.textContent = 'PDF';
  tabCards.textContent = 'Story Cards';
  for (const tab of [tabJson, tabText, tabPdf, tabCards]) tab.style.cssText = tabStyle;
  tabs.appendChild(tabJson);
  tabs.appendChild(tabText);
  tabs.appendChild(tabPdf);
  tabs.appendChild(tabCards);
  modal.appendChild(tabs);

  const content = document.createElement('div');
  content.style.cssText = `flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;`;
  modal.appendChild(content);

  type TabKey = 'json' | 'text' | 'pdf' | 'cards';
  const tabsByKey: Record<TabKey, HTMLButtonElement> = {
    json: tabJson,
    text: tabText,
    pdf: tabPdf,
    cards: tabCards,
  };

  const setActiveTab = (which: TabKey) => {
    for (const t of Object.values(tabsByKey)) {
      t.style.color = '#6b7280';
      t.style.borderBottomColor = 'transparent';
    }
    const active = tabsByKey[which];
    active.style.color = '#6366f1';
    active.style.borderBottomColor = '#6366f1';
    content.innerHTML = '';
    switch (which) {
      case 'json':
        content.appendChild(renderJsonPane(data));
        break;
      case 'text':
        content.appendChild(renderTextPane(data));
        break;
      case 'pdf':
        content.appendChild(renderPdfPane(data));
        break;
      case 'cards':
        content.appendChild(renderCardsPane(data));
        break;
    }
  };

  for (const [key, btn] of Object.entries(tabsByKey)) {
    btn.onclick = () => setActiveTab(key as TabKey);
  }
  // Default tab depends on whether we have character metadata to show.
  setActiveTab(data.characterMeta || data.adventureMeta ? 'cards' : 'json');

  const modalFooter = document.createElement('div');
  modalFooter.style.cssText = `
    border-top: 1px solid #e5e7eb; margin-top: 16px; padding-top: 12px;
    text-align: center; font-size: 0.75rem; color: #6b7280;
  `;
  modalFooter.innerHTML = `
    &copy; 2026 <a href="https://wilds.ai/" target="_blank" rel="noopener noreferrer"
      style="color: #6366f1; text-decoration: none; font-weight: 600;">Wilds AI</a>
  `;
  modal.appendChild(modalFooter);

  document.body.appendChild(overlay);
  document.body.appendChild(modal);
}

/** Build the "JSON" tab: pretty-printed preview + Copy / Download buttons. */
function renderJsonPane(data: ExportPayload) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `display: flex; flex-direction: column; min-height: 0; flex: 1;`;

  const pre = document.createElement('pre');
  pre.style.cssText = `
    background: #f9fafb; padding: 14px; border-radius: 8px; overflow: auto; flex: 1;
    font-size: 0.8rem; border: 1px solid #e5e7eb; margin: 0 0 14px; white-space: pre-wrap;
    word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    max-height: 50vh;
  `;
  pre.textContent = JSON.stringify(data, null, 2);
  wrap.appendChild(pre);

  const footer = document.createElement('div');
  footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy JSON';
  copyBtn.style.cssText = primaryBtnStyle('#6366f1');
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy JSON'), 2000);
  };

  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = 'Download JSON';
  downloadBtn.style.cssText = primaryBtnStyle('#10b981');
  downloadBtn.onclick = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const slug = sanitize(
      data.characterMeta?.name || data.adventureMeta?.title || 'export'
    );
    triggerBlobDownload(blob, `${getSite()}-${slug}-${Date.now()}.json`);
  };

  footer.appendChild(copyBtn);
  footer.appendChild(downloadBtn);
  wrap.appendChild(footer);
  return wrap;
}

/**
 * Build the "Text" tab: live-rendered preview of the plain-text export
 * with Copy and Download .txt buttons. The format is the same one
 * `renderTextExport` produces for the file download, so what the user
 * sees is exactly what gets saved.
 */
function renderTextPane(data: ExportPayload) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `display: flex; flex-direction: column; min-height: 0; flex: 1;`;

  const text = renderTextExport(data);

  const pre = document.createElement('pre');
  pre.style.cssText = `
    background: #f9fafb; padding: 14px; border-radius: 8px; overflow: auto; flex: 1;
    font-size: 0.82rem; border: 1px solid #e5e7eb; margin: 0 0 14px; white-space: pre-wrap;
    word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    max-height: 50vh; line-height: 1.45; color: #1f2937;
  `;
  pre.textContent = text;
  wrap.appendChild(pre);

  const footer = document.createElement('div');
  footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Text';
  copyBtn.style.cssText = primaryBtnStyle('#6366f1');
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy Text'), 2000);
  };

  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = 'Download .txt';
  downloadBtn.style.cssText = primaryBtnStyle('#10b981');
  downloadBtn.onclick = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const slug = sanitize(
      data.characterMeta?.name || data.adventureMeta?.title || 'export'
    );
    triggerBlobDownload(blob, `${getSite()}-${slug}-${Date.now()}.txt`);
  };

  footer.appendChild(copyBtn);
  footer.appendChild(downloadBtn);
  wrap.appendChild(footer);
  return wrap;
}

/**
 * Build the "PDF" tab: a short description of the document layout
 * plus a single Download .pdf button. PDFs aren't usefully previewed
 * inside the modal (an iframe of a generated blob URL works but
 * jumps the page on Chrome and adds bundle weight), so we keep this
 * pane minimal and let the user open the saved file.
 *
 * Generation uses jsPDF and is synchronous-on-render, so the click
 * handler can build the blob inline without spinner choreography.
 */
function renderPdfPane(data: ExportPayload) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `display: flex; flex-direction: column; min-height: 0; flex: 1; gap: 14px;`;

  const summary = document.createElement('div');
  summary.style.cssText = `
    background: #f9fafb; padding: 18px; border-radius: 8px; border: 1px solid #e5e7eb;
    color: #374151; font-size: 0.92rem; line-height: 1.5;
  `;
  const messageCount = data.messages.length;
  const characterLine = data.characterMeta
    ? `Character profile (${data.characterMeta.name})`
    : null;
  const adventureLine = data.adventureMeta
    ? `Adventure metadata (${data.adventureMeta.title}${data.adventureMeta.storyCards?.length ? `, ${data.adventureMeta.storyCards.length} story cards` : ''})`
    : null;
  const items = [
    'Title and source URL',
    characterLine,
    adventureLine,
    `${messageCount} message${messageCount === 1 ? '' : 's'}, role-tinted, selectable text`,
  ].filter(Boolean) as string[];
  summary.innerHTML = `
    <strong style="display: block; margin-bottom: 8px; color: #111827; font-size: 1rem;">PDF document</strong>
    A multi-page PDF with selectable text. Includes:
    <ul style="margin: 8px 0 0; padding-left: 20px;">
      ${items.map((it) => `<li style="margin-bottom: 4px;">${it}</li>`).join('')}
    </ul>
  `;
  wrap.appendChild(summary);

  // Lore-card cap control. AI Dungeon adventures with many story
  // cards render slowly (each card is an html2canvas pass) and can
  // bloat the PDF; let the user dial down or up. Hidden when the
  // export carries no story cards. Default 6, capped at 20 — matches
  // LORE_APPENDIX_CAP_MAX in pdf-export.ts. Reading the input at
  // click time keeps "edit then click Download" feeling native.
  const storyCardCount = data.adventureMeta?.storyCards?.length ?? 0;
  let loreCapInput: HTMLInputElement | null = null;
  if (storyCardCount > 0) {
    const capRow = document.createElement('div');
    capRow.style.cssText = `
      display: flex; align-items: center; gap: 10px;
      padding: 12px 14px; background: #fffbeb;
      border: 1px solid #fde68a; border-radius: 8px;
      color: #78350f; font-size: 0.88rem;
    `;
    const capLabel = document.createElement('label');
    capLabel.style.cssText = `display: flex; align-items: center; gap: 8px; flex: 1;`;
    capLabel.textContent = 'Story cards to embed as portraits:';

    loreCapInput = document.createElement('input');
    loreCapInput.type = 'number';
    loreCapInput.min = '0';
    loreCapInput.max = '20';
    loreCapInput.step = '1';
    loreCapInput.value = String(Math.min(6, storyCardCount));
    loreCapInput.style.cssText = `
      width: 64px; padding: 4px 8px; border: 1px solid #fcd34d;
      border-radius: 4px; font-size: 0.92rem; background: #fff;
    `;
    capLabel.appendChild(loreCapInput);

    const capHint = document.createElement('span');
    capHint.style.cssText = `font-size: 0.78rem; color: #92400e;`;
    capHint.textContent = `(0–20, this adventure has ${storyCardCount})`;

    capRow.appendChild(capLabel);
    capRow.appendChild(capHint);
    wrap.appendChild(capRow);
  }

  const footer = document.createElement('div');
  footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; align-items: center;`;
  const status = document.createElement('span');
  status.style.cssText = `font-size: 0.8rem; color: #6b7280; margin-right: auto;`;
  footer.appendChild(status);

  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = 'Download .pdf';
  downloadBtn.style.cssText = primaryBtnStyle('#dc2626');
  downloadBtn.onclick = async () => {
    const original = downloadBtn.textContent;
    downloadBtn.disabled = true;
    downloadBtn.style.opacity = '0.7';
    status.textContent = 'Building PDF…';
    try {
      // renderPdfExport is async since v0.4.0 — it best-effort
      // fetches the character avatar / adventure cover image and
      // embeds it as a hero at the top of the PDF. Image fetch
      // failure is non-fatal (text-only fallback).
      const rawCap = loreCapInput?.value;
      const parsedCap =
        rawCap !== undefined && rawCap !== '' ? Number(rawCap) : undefined;
      const blob = await renderPdfExport(data, {
        loreCardCap: parsedCap,
      });
      const slug = sanitize(
        data.characterMeta?.name || data.adventureMeta?.title || 'export'
      );
      triggerBlobDownload(blob, `${getSite()}-${slug}-${Date.now()}.pdf`);
      status.textContent = 'Downloaded.';
    } catch (err) {
      console.error('PDF export failed', err);
      status.textContent = 'PDF export failed — check console.';
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.style.opacity = '1';
      downloadBtn.textContent = original!;
    }
  };
  footer.appendChild(downloadBtn);
  wrap.appendChild(footer);

  return wrap;
}

/** Dispatch to the platform-specific story-cards pane, or show an empty state. */
function renderCardsPane(data: ExportPayload) {
  if (data.characterMeta) return renderCharacterCardsPane(data);
  if (data.adventureMeta) return renderAdventureCardsPane(data);

  const wrap = document.createElement('div');
  wrap.style.cssText = `display: flex; flex-direction: column; min-height: 0; flex: 1;`;
  const msg = document.createElement('p');
  msg.style.cssText = `padding: 24px; color: #6b7280; text-align: center;`;
  msg.textContent = 'Story cards are not available on this page.';
  wrap.appendChild(msg);
  return wrap;
}

/**
 * Create an iframe that renders at the card's full native size but visually
 * scales down to `targetW` CSS pixels. Using a scaled iframe (rather than a
 * small iframe with responsive CSS) keeps the preview pixel-perfect with the
 * final html2canvas output.
 *
 * The iframe is wrapped in an explicitly-sized clipping div so it lays out as
 * a `targetW × scaledH` box in any container — flex row, flex column, or
 * normal flow. (An earlier version used negative margins on the iframe to
 * compensate for `transform: scale()` not shrinking the layout box, but those
 * margins caused overlapping cards in `flex-direction: column` on mobile.)
 */
function makeScaledIframe(width: number, height: number, targetW: number): {
  wrapper: HTMLDivElement;
  iframe: HTMLIFrameElement;
} {
  const scale = targetW / width;
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    width: ${targetW}px; height: ${Math.round(height * scale)}px;
    overflow: hidden; flex: 0 0 auto; background: transparent;
  `;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `
    width: ${width}px; height: ${height}px; border: 0;
    transform: scale(${scale}); transform-origin: top left;
    background: transparent; display: block;
  `;
  wrapper.appendChild(iframe);
  return { wrapper, iframe };
}

/** Story Cards pane for character.ai: shows profile + first chat preview. */
function renderCharacterCardsPane(data: ExportPayload) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `display: flex; flex-direction: column; min-height: 0; flex: 1;`;

  const totalCards = countCards(data.messages as ChatMessage[]);

  const header = document.createElement('div');
  header.style.cssText = `margin-bottom: 10px; font-size: 0.85rem; color: #6b7280;`;
  header.textContent = `${totalCards} cards — profile + ${
    totalCards - 1
  } chat ${totalCards - 1 === 1 ? 'card' : 'cards'} (2 messages each).`;
  wrap.appendChild(header);

  const isNarrow = window.innerWidth < 640;
  const cardTargetW = isNarrow ? Math.min(280, window.innerWidth - 80) : 300;

  const previewShell = document.createElement('div');
  previewShell.style.cssText = `
    flex: 1; min-height: 320px; max-height: 55vh; overflow: auto; border: 1px solid #e5e7eb;
    border-radius: 10px; background: #0b1020; display: flex;
    flex-direction: ${isNarrow ? 'column' : 'row'};
    justify-content: ${isNarrow ? 'flex-start' : 'center'};
    align-items: center; gap: ${isNarrow ? '16px' : '20px'}; padding: 16px;
  `;

  const profile = makeScaledIframe(
    CHARACTER_PROFILE_CARD.width,
    CHARACTER_PROFILE_CARD.height,
    cardTargetW
  );
  const chat = makeScaledIframe(
    CHARACTER_PROFILE_CARD.width,
    CHARACTER_PROFILE_CARD.height,
    cardTargetW
  );
  previewShell.appendChild(profile.wrapper);
  previewShell.appendChild(chat.wrapper);
  wrap.appendChild(previewShell);

  const { footer, status } = makeFooter();
  const downloadZipBtn = document.createElement('button');
  downloadZipBtn.textContent = 'Download Story Cards (ZIP)';
  downloadZipBtn.style.cssText = primaryBtnStyle('#6366f1');
  downloadZipBtn.onclick = async () => {
    if (!data.characterMeta) return;
    const original = downloadZipBtn.textContent;
    downloadZipBtn.disabled = true;
    downloadZipBtn.style.opacity = '0.7';
    try {
      const zip = await buildStoryCardsZip(
        data.characterMeta,
        data.messages as ChatMessage[],
        (done, total) => {
          downloadZipBtn.textContent = `Rendering ${done}/${total}…`;
          status.textContent = `Rendering card ${done} of ${total}…`;
        }
      );
      const slug = sanitize(data.characterMeta.name);
      triggerBlobDownload(zip, `wilds-${slug}-story-cards.zip`);
      status.textContent = 'Downloaded.';
    } catch (err) {
      console.error('Story card export failed', err);
      status.textContent = 'Export failed — check console.';
    } finally {
      downloadZipBtn.disabled = false;
      downloadZipBtn.style.opacity = '1';
      downloadZipBtn.textContent = original!;
    }
  };
  footer.appendChild(downloadZipBtn);
  wrap.appendChild(footer);

  buildProfilePreviewSrcDoc(data.characterMeta!)
    .then((html) => {
      profile.iframe.srcdoc = html;
    })
    .catch((err) => console.error('profile preview failed', err));

  buildChatPreviewSrcDoc(data.characterMeta!, data.messages as ChatMessage[])
    .then((html) => {
      if (html) chat.iframe.srcdoc = html;
      else chat.wrapper.remove();
    })
    .catch((err) => {
      console.error('chat preview failed', err);
      chat.wrapper.remove();
    });

  return wrap;
}

/** Story Cards pane for AI Dungeon: chapter preview + optional lore preview. */
function renderAdventureCardsPane(data: ExportPayload) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `display: flex; flex-direction: column; min-height: 0; flex: 1;`;

  const chapterCount = countAdventureCards(data.messages as ChatMessage[]);
  const loreCount = countAdventureLoreCards(data.adventureMeta);

  const header = document.createElement('div');
  header.style.cssText = `margin-bottom: 10px; font-size: 0.85rem; color: #6b7280;`;
  if (chapterCount === 0 && loreCount === 0) {
    header.textContent = 'No story messages or story cards found to export.';
  } else {
    const parts: string[] = [];
    if (chapterCount > 0) {
      parts.push(
        `${chapterCount} chapter ${chapterCount === 1 ? 'card' : 'cards'} (2 messages each)`
      );
    }
    if (loreCount > 0) {
      parts.push(
        `${loreCount} story ${loreCount === 1 ? 'card' : 'cards'} (lore entries)`
      );
    }
    header.textContent = parts.join(' · ');
  }
  wrap.appendChild(header);

  // Render both previews at a shared display height so they sit on the same
  // baseline even though one is landscape (chapter) and one is portrait (lore).
  // On narrow viewports drop the height so the chapter (landscape) card still
  // fits the modal width without horizontal clipping.
  const isNarrow = window.innerWidth < 640;
  const chapterAspect = ADVENTURE_STORY_CARD.width / ADVENTURE_STORY_CARD.height;
  const PREVIEW_H = isNarrow
    ? Math.max(140, Math.floor((window.innerWidth - 80) / chapterAspect))
    : 260;
  const chapterW = Math.round(chapterAspect * PREVIEW_H);
  const loreW = Math.round(
    (ADVENTURE_LORE_CARD.width / ADVENTURE_LORE_CARD.height) * PREVIEW_H
  );

  const previewShell = document.createElement('div');
  previewShell.style.cssText = `
    flex: 0 0 auto; min-height: ${PREVIEW_H + 32}px;
    overflow-x: ${isNarrow ? 'hidden' : 'auto'}; overflow-y: ${isNarrow ? 'auto' : 'hidden'};
    border: 1px solid #e5e7eb; border-radius: 10px; background: #0b0714;
    display: flex;
    flex-direction: ${isNarrow ? 'column' : 'row'};
    justify-content: ${
      isNarrow ? 'flex-start' : loreCount > 0 ? 'flex-start' : 'center'
    };
    align-items: center; gap: 16px; padding: 16px;
  `;
  const adventure = makeScaledIframe(
    ADVENTURE_STORY_CARD.width,
    ADVENTURE_STORY_CARD.height,
    chapterW
  );
  previewShell.appendChild(adventure.wrapper);

  const lore =
    loreCount > 0
      ? makeScaledIframe(
          ADVENTURE_LORE_CARD.width,
          ADVENTURE_LORE_CARD.height,
          loreW
        )
      : null;
  if (lore) previewShell.appendChild(lore.wrapper);
  wrap.appendChild(previewShell);

  const { footer, status } = makeFooter();
  const downloadZipBtn = document.createElement('button');
  downloadZipBtn.textContent = 'Download Story Cards (ZIP)';
  downloadZipBtn.style.cssText = primaryBtnStyle('#f59e0b');
  const hasAny = chapterCount > 0 || loreCount > 0;
  downloadZipBtn.disabled = !hasAny;
  downloadZipBtn.style.opacity = hasAny ? '1' : '0.5';
  downloadZipBtn.onclick = async () => {
    if (!data.adventureMeta || !hasAny) return;
    const original = downloadZipBtn.textContent;
    downloadZipBtn.disabled = true;
    downloadZipBtn.style.opacity = '0.7';
    try {
      const zip = await buildAdventureStoryCardsZip(
        data.adventureMeta,
        data.messages as ChatMessage[],
        (done, totalCount) => {
          downloadZipBtn.textContent = `Rendering ${done}/${totalCount}…`;
          status.textContent = `Rendering card ${done} of ${totalCount}…`;
        }
      );
      const slug = sanitize(data.adventureMeta.title);
      triggerBlobDownload(zip, `wilds-${slug}-story-cards.zip`);
      status.textContent = 'Downloaded.';
    } catch (err) {
      console.error('Adventure story card export failed', err);
      status.textContent = 'Export failed — check console.';
    } finally {
      downloadZipBtn.disabled = false;
      downloadZipBtn.style.opacity = '1';
      downloadZipBtn.textContent = original!;
    }
  };
  footer.appendChild(downloadZipBtn);
  wrap.appendChild(footer);

  buildAdventurePreviewSrcDoc(data.adventureMeta!, data.messages as ChatMessage[])
    .then((html) => {
      if (html) adventure.iframe.srcdoc = html;
      else adventure.wrapper.remove();
    })
    .catch((err) => {
      console.error('adventure preview failed', err);
      adventure.wrapper.remove();
    });

  if (lore) {
    buildAdventureLorePreviewSrcDoc(data.adventureMeta!)
      .then((html) => {
        if (html) lore.iframe.srcdoc = html;
        else lore.wrapper.remove();
      })
      .catch((err) => {
        console.error('adventure lore preview failed', err);
        lore.wrapper.remove();
      });
  }

  return wrap;
}

/**
 * Shared footer row used by both card panes: left-aligned status text +
 * right-aligned action buttons (buttons are appended by the caller).
 */
function makeFooter() {
  const footer = document.createElement('div');
  footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; align-items: center;`;
  const status = document.createElement('span');
  status.style.cssText = `font-size: 0.8rem; color: #6b7280; margin-right: auto;`;
  footer.appendChild(status);
  return { footer, status };
}

/** Shared inline style for the modal's primary (filled) buttons. */
function primaryBtnStyle(color: string) {
  return `padding: 10px 16px; background: ${color}; color: white; border: none;
          border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;`;
}

/**
 * Show a lightweight loading modal while we collect export data. Returns a
 * `close` function the caller must invoke before rendering the real modal.
 * Used because AI Dungeon's GraphQL fetch can take ~1–2 seconds and an
 * immediate modal feels more responsive than a delayed one.
 */
function showLoadingModal(site: Site): () => void {
  if (document.getElementById('cai-exporter-modal')) {
    return () => {};
  }

  const overlay = document.createElement('div');
  overlay.id = 'cai-exporter-overlay';
  overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 99999;`;

  const modal = document.createElement('div');
  modal.id = 'cai-exporter-modal';
  modal.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 92%; max-width: 420px; background: white; border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25); z-index: 100000;
    padding: 28px 24px; font-family: sans-serif; color: #111827;
    display: flex; flex-direction: column; align-items: center; gap: 16px;
  `;

  // Inject the spin keyframes once (idempotent) so the spinner rotates.
  if (!document.getElementById('cai-exporter-keyframes')) {
    const style = document.createElement('style');
    style.id = 'cai-exporter-keyframes';
    style.textContent = `@keyframes cai-spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }

  const label =
    site === 'aidungeon' ? 'Fetching adventure…' : 'Reading chat…';

  modal.innerHTML = `
    <img src="${LOGO_URL}" style="width: 40px; height: 40px;" />
    <div style="width: 36px; height: 36px; border: 3px solid #e5e7eb; border-top-color: #6366f1; border-radius: 50%; animation: cai-spin 0.8s linear infinite;"></div>
    <div style="font-weight: 600; color: #111827;">${label}</div>
    <div style="font-size: 0.85rem; color: #6b7280; text-align: center;">Preparing your export. This usually takes a moment.</div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  return () => {
    modal.remove();
    overlay.remove();
  };
}

/**
 * Inject the floating "Export Chat/Adventure" button anchored to the bottom
 * right of the viewport. No-op if the button already exists.
 */
function addFloatingButton() {
  if (document.getElementById('cai-exporter-btn')) return;

  const site = getSite();
  const label = site === 'aidungeon' ? 'Export Adventure' : 'Export Chat';

  const btn = document.createElement('button');
  btn.id = 'cai-exporter-btn';
  btn.innerHTML = `<img src="${LOGO_URL}" style="width: 20px; height: 20px;" /><span>${label}</span>`;
  btn.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9998; background: #6366f1;
    color: white; border: none; border-radius: 50px; padding: 12px 20px; cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-weight: 600; display: flex;
    align-items: center; gap: 8px; font-family: sans-serif; transition: transform 0.2s;
  `;
  btn.onmouseover = () => (btn.style.transform = 'scale(1.05)');
  btn.onmouseout = () => (btn.style.transform = 'scale(1)');
  btn.onclick = async () => {
    const closeLoading = showLoadingModal(getSite());
    try {
      const { messages, characterMeta, adventureMeta } = await collectExportData();
      closeLoading();
      if (!messages || messages.length === 0) {
        alert('No messages found to export.');
        return;
      }
      showExportUI({
        timestamp: new Date().toISOString(),
        url: window.location.href,
        site: getSite(),
        messages,
        characterMeta,
        adventureMeta,
      });
    } catch (err) {
      closeLoading();
      console.error('Export failed', err);
      alert('Export failed — check the console for details.');
    }
  };
  document.body.appendChild(btn);
}

/**
 * Add or remove the floating Export button based on the current route.
 *
 * character.ai and AI Dungeon are both SPAs, so client-side navigation
 * doesn't fire `popstate` reliably — we also hook into a `MutationObserver`
 * on `<body>` to re-evaluate whenever the DOM changes. The `hasMessages`
 * check also prevents the button from showing on an empty chat shell.
 */
function handleUIVisibility() {
  const isChat = isChatPage();
  const site = getSite();
  // For Character.AI / AI Dungeon we wait until the message container is
  // actually painted so the button doesn't briefly flash on an empty shell.
  // Janitor renders its chat through a virtualized component without a stable
  // id we can latch onto; the URL pattern alone is enough since the network
  // monitor is already running by the time the user can interact. Chai pulls
  // its transcript over the API at click time, so the URL pattern is all we
  // need there too.
  const hasMessages =
    site === 'janitor' || site === 'chai'
      ? true
      : !!(
          document.getElementById('chat-messages') ||
          document.getElementById('gameplay-output')
        );
  const existingBtn = document.getElementById('cai-exporter-btn');

  if (isChat && hasMessages) {
    addFloatingButton();
  } else if (existingBtn) {
    existingBtn.remove();
  }
}

const observer = new MutationObserver(() => handleUIVisibility());
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('popstate', handleUIVisibility);
handleUIVisibility();

// Handle "Export" triggers originating from the toolbar popup. The popup
// dispatches EXPORT_CHAT to the active tab; we respond with the collected
// data and open the modal in the page as a courtesy.
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'EXPORT_CHAT') {
    (async () => {
      const closeLoading = showLoadingModal(getSite());
      try {
        const { messages, characterMeta, adventureMeta } = await collectExportData();
        closeLoading();
        if (!messages || messages.length === 0) {
          sendResponse({ success: false, error: 'No messages found.' });
          return;
        }
        const data: ExportPayload = {
          timestamp: new Date().toISOString(),
          url: window.location.href,
          site: getSite(),
          messages,
          characterMeta,
          adventureMeta,
        };
        sendResponse({ success: true, data });
        showExportUI(data);
      } catch (err) {
        closeLoading();
        console.error('Export failed', err);
        sendResponse({ success: false, error: String((err as Error)?.message || err) });
      }
    })();
  }
  return true;
});
