/**
 * Content script for character.ai and AI Dungeon
 */

import {
  extractAdventureMetaAIDungeon,
  extractCharacterMetaCharacterAI,
  type AdventureMeta,
  type CharacterMeta,
} from './metadata';
import {
  ADVENTURE_STORY_CARD,
  CHARACTER_PROFILE_CARD,
  buildAdventurePreviewSrcDoc,
  buildAdventureStoryCardsZip,
  buildChatPreviewSrcDoc,
  buildProfilePreviewSrcDoc,
  buildStoryCardsZip,
  countAdventureCards,
  countCards,
  type ChatMessage,
} from './story-cards';

console.log('Wilds AI Exporter: Content script loaded');

const LOGO_URL = chrome.runtime.getURL('wilds-logo.svg');

type Site = 'character' | 'aidungeon' | null;

function getSite(): Site {
  const host = window.location.hostname;
  if (host.includes('character.ai')) return 'character';
  if (host.includes('aidungeon.com')) return 'aidungeon';
  return null;
}

function isChatPage() {
  const site = getSite();
  const path = window.location.pathname;

  if (site === 'character') {
    return /^\/chat\/[a-zA-Z0-9_-]+$/.test(path);
  }

  if (site === 'aidungeon') {
    return /^\/adventure\/[a-zA-Z0-9_-]+\/.*\/play$/.test(path);
  }

  return false;
}

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

function extractChat() {
  const site = getSite();
  if (site === 'character') return extractCharacterAI();
  if (site === 'aidungeon') return extractAIDungeon();
  return null;
}

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

function sanitize(name: string) {
  return (name || 'export').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'export';
}

interface ExportPayload {
  timestamp: string;
  url: string;
  site: Site;
  messages: Array<{ name?: string; role: string; text: string }>;
  characterMeta: CharacterMeta | null;
  adventureMeta: AdventureMeta | null;
}

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
      <img src="${LOGO_URL}" style="width: 32px; height: 32px;" />
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

  // Tab bar
  const tabs = document.createElement('div');
  tabs.style.cssText = `display: flex; gap: 6px; border-bottom: 1px solid #e5e7eb; margin-bottom: 14px;`;
  const tabJson = document.createElement('button');
  const tabCards = document.createElement('button');
  const tabStyle = `
    background: none; border: none; padding: 10px 14px; cursor: pointer;
    font-size: 0.95rem; font-weight: 600; color: #6b7280; border-bottom: 2px solid transparent;
  `;
  tabJson.textContent = 'JSON';
  tabCards.textContent = 'Story Cards';
  tabJson.style.cssText = tabStyle;
  tabCards.style.cssText = tabStyle;
  tabs.appendChild(tabJson);
  tabs.appendChild(tabCards);
  modal.appendChild(tabs);

  const content = document.createElement('div');
  content.style.cssText = `flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;`;
  modal.appendChild(content);

  const setActiveTab = (which: 'json' | 'cards') => {
    [tabJson, tabCards].forEach((t) => {
      t.style.color = '#6b7280';
      t.style.borderBottomColor = 'transparent';
    });
    const active = which === 'json' ? tabJson : tabCards;
    active.style.color = '#6366f1';
    active.style.borderBottomColor = '#6366f1';
    content.innerHTML = '';
    if (which === 'json') content.appendChild(renderJsonPane(data));
    else content.appendChild(renderCardsPane(data));
  };

  tabJson.onclick = () => setActiveTab('json');
  tabCards.onclick = () => setActiveTab('cards');
  // Default tab depends on whether we have character metadata to show.
  setActiveTab(data.characterMeta || data.adventureMeta ? 'cards' : 'json');

  document.body.appendChild(overlay);
  document.body.appendChild(modal);
}

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

function makeScaledIframe(width: number, height: number, targetW: number) {
  const scale = targetW / width;
  const f = document.createElement('iframe');
  f.style.cssText = `
    width: ${width}px; height: ${height}px; border: 0;
    transform: scale(${scale}); transform-origin: top left;
    margin-right: ${-(width - width * scale)}px;
    margin-bottom: ${-(height - height * scale)}px;
    background: transparent;
  `;
  return f;
}

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

  const previewShell = document.createElement('div');
  previewShell.style.cssText = `
    flex: 1; min-height: 320px; max-height: 55vh; overflow: auto; border: 1px solid #e5e7eb;
    border-radius: 10px; background: #0b1020; display: flex; justify-content: center;
    gap: 20px; padding: 16px;
  `;

  const profileFrame = makeScaledIframe(
    CHARACTER_PROFILE_CARD.width,
    CHARACTER_PROFILE_CARD.height,
    300
  );
  const chatFrame = makeScaledIframe(
    CHARACTER_PROFILE_CARD.width,
    CHARACTER_PROFILE_CARD.height,
    300
  );
  previewShell.appendChild(profileFrame);
  previewShell.appendChild(chatFrame);
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
      profileFrame.srcdoc = html;
    })
    .catch((err) => console.error('profile preview failed', err));

  buildChatPreviewSrcDoc(data.characterMeta!, data.messages as ChatMessage[])
    .then((html) => {
      if (html) chatFrame.srcdoc = html;
      else chatFrame.remove();
    })
    .catch((err) => {
      console.error('chat preview failed', err);
      chatFrame.remove();
    });

  return wrap;
}

function renderAdventureCardsPane(data: ExportPayload) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `display: flex; flex-direction: column; min-height: 0; flex: 1;`;

  const total = countAdventureCards(data.messages as ChatMessage[]);

  const header = document.createElement('div');
  header.style.cssText = `margin-bottom: 10px; font-size: 0.85rem; color: #6b7280;`;
  header.textContent =
    total === 0
      ? 'No story messages found to export.'
      : `${total} story ${total === 1 ? 'card' : 'cards'} (2 messages each).`;
  wrap.appendChild(header);

  const previewShell = document.createElement('div');
  previewShell.style.cssText = `
    flex: 1; min-height: 300px; max-height: 55vh; overflow: auto; border: 1px solid #e5e7eb;
    border-radius: 10px; background: #0b0714; display: flex; justify-content: center;
    padding: 16px;
  `;
  const adventureFrame = makeScaledIframe(
    ADVENTURE_STORY_CARD.width,
    ADVENTURE_STORY_CARD.height,
    640
  );
  previewShell.appendChild(adventureFrame);
  wrap.appendChild(previewShell);

  const { footer, status } = makeFooter();
  const downloadZipBtn = document.createElement('button');
  downloadZipBtn.textContent = 'Download Story Cards (ZIP)';
  downloadZipBtn.style.cssText = primaryBtnStyle('#f59e0b');
  downloadZipBtn.disabled = total === 0;
  downloadZipBtn.style.opacity = total === 0 ? '0.5' : '1';
  downloadZipBtn.onclick = async () => {
    if (!data.adventureMeta || total === 0) return;
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
      if (html) adventureFrame.srcdoc = html;
      else adventureFrame.remove();
    })
    .catch((err) => {
      console.error('adventure preview failed', err);
      adventureFrame.remove();
    });

  return wrap;
}

function makeFooter() {
  const footer = document.createElement('div');
  footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; align-items: center;`;
  const status = document.createElement('span');
  status.style.cssText = `font-size: 0.8rem; color: #6b7280; margin-right: auto;`;
  footer.appendChild(status);
  return { footer, status };
}

function primaryBtnStyle(color: string) {
  return `padding: 10px 16px; background: ${color}; color: white; border: none;
          border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;`;
}

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
    const messages = extractChat();
    if (!messages || messages.length === 0) {
      alert('No messages found to export.');
      return;
    }
    const site = getSite();
    const characterMeta =
      site === 'character' ? await extractCharacterMetaCharacterAI() : null;
    const adventureMeta =
      site === 'aidungeon' ? extractAdventureMetaAIDungeon() : null;
    showExportUI({
      timestamp: new Date().toISOString(),
      url: window.location.href,
      site,
      messages,
      characterMeta,
      adventureMeta,
    });
  };
  document.body.appendChild(btn);
}

function handleUIVisibility() {
  const isChat = isChatPage();
  const hasMessages = !!(
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

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'EXPORT_CHAT') {
    (async () => {
      const messages = extractChat();
      if (!messages || messages.length === 0) {
        sendResponse({ success: false, error: 'No messages found.' });
        return;
      }
      const site = getSite();
      const characterMeta =
        site === 'character' ? await extractCharacterMetaCharacterAI() : null;
      const adventureMeta =
        site === 'aidungeon' ? extractAdventureMetaAIDungeon() : null;
      const data: ExportPayload = {
        timestamp: new Date().toISOString(),
        url: window.location.href,
        site,
        messages,
        characterMeta,
        adventureMeta,
      };
      sendResponse({ success: true, data });
      showExportUI(data);
    })();
  }
  return true;
});
