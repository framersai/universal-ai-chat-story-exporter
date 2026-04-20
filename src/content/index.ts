/**
 * Content script for character.ai and AI Dungeon
 */

console.log('Wilds AI Exporter: Content script loaded');

const LOGO_URL = chrome.runtime.getURL('wilds-logo.svg');

function getSite() {
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
    // Pattern: /adventure/:id/:slug/play
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
    const completedMessages = Array.from(group.querySelectorAll('[data-testid="completed-message"]'));
    if (completedMessages.length === 0) continue;

    let activeMessageEl = null;
    if (completedMessages.length > 1 || group.querySelector('.swiper')) {
      activeMessageEl = group.querySelector('.swiper-slide-active [data-testid="completed-message"]');
      if (!activeMessageEl) activeMessageEl = completedMessages[0];
    } else {
      activeMessageEl = completedMessages[0];
    }

    if (!activeMessageEl) continue;
    const prose = activeMessageEl.querySelector('.prose');
    if (!prose) continue;

    const paragraphs = Array.from(prose.querySelectorAll('p'));
    const text = paragraphs.length > 0
      ? paragraphs.map(p => p.textContent?.trim()).filter(t => t).join('\n')
      : prose.textContent?.trim() || '';

    const nameEl = group.querySelector('.text-sm');
    const name = nameEl ? nameEl.textContent?.trim() : 'Unknown';

    const isCharacter = !!group.querySelector('.bg-secondary');
    const isUser = !!group.querySelector('.flex-row-reverse');
    const role = isCharacter ? 'character' : (isUser ? 'user' : 'unknown');

    extractedMessages.push({ name, role, text });
  }

  return extractedMessages.reverse();
}

function extractAIDungeon() {
  const container = document.getElementById('gameplay-output');
  if (!container) return null;

  const extractedMessages = [];
  
  // AI Dungeon structure uses spans for story (AI) and divs for actions (User)
  // We'll iterate through all relevant children of the gameplay output
  const elements = Array.from(container.querySelectorAll('span[role="document"], div#transition-opacity'));

  for (const el of elements) {
    if (el.tagName === 'SPAN' && el.getAttribute('role') === 'document') {
      // AI / Story Section
      const text = el.textContent?.trim();
      if (text) {
        extractedMessages.push({
          name: 'Story/AI',
          role: 'character',
          text: text
        });
      }
    } else if (el.tagName === 'DIV' && el.id === 'transition-opacity') {
      // User Action Section
      const actionTextEl = el.querySelector('#action-text');
      if (actionTextEl) {
        const text = actionTextEl.textContent?.trim();
        if (text) {
          extractedMessages.push({
            name: 'You',
            role: 'user',
            text: text
          });
        }
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

function showExportUI(data: any) {
  if (document.getElementById('cai-exporter-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'cai-exporter-overlay';
  overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 99999;`;

  const modal = document.createElement('div');
  modal.id = 'cai-exporter-modal';
  modal.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 90%; max-width: 600px; max-height: 85vh; background: white; border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2); z-index: 100000; display: flex;
    flex-direction: column; padding: 24px; font-family: sans-serif; color: #111827;
  `;

  const header = document.createElement('div');
  header.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;`;
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <img src="${LOGO_URL}" style="width: 32px; height: 32px;" />
      <div>
        <h2 style="margin:0; font-size: 1.5rem; font-weight: 700; color: #6366f1;">Chat Extracted</h2>
        <p style="margin: 4px 0 0; font-size: 0.875rem; color: #6b7280;">${data.messages.length} messages found</p>
      </div>
    </div>
  `;
  
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `border: none; background: none; font-size: 2rem; cursor: pointer; color: #9ca3af; line-height: 1; padding: 0;`;
  
  const closeModal = () => { modal.remove(); overlay.remove(); };
  closeBtn.onclick = closeModal;
  overlay.onclick = closeModal;
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const pre = document.createElement('pre');
  pre.style.cssText = `
    background: #f9fafb; padding: 16px; border-radius: 8px; overflow: auto; flex-grow: 1;
    font-size: 0.875rem; border: 1px solid #e5e7eb; margin-bottom: 20px; white-space: pre-wrap;
    word-break: break-all; font-family: monospace;
  `;
  pre.textContent = JSON.stringify(data, null, 2);
  modal.appendChild(pre);

  const footer = document.createElement('div');
  footer.style.cssText = `display: flex; gap: 12px; justify-content: flex-end;`;

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy JSON';
  copyBtn.style.cssText = `padding: 10px 18px; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;`;
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = 'Copy JSON', 2000);
  };

  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = 'Download JSON';
  downloadBtn.style.cssText = `padding: 10px 18px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;`;
  downloadBtn.onclick = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getSite()}-export-${new Date().getTime()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  footer.appendChild(copyBtn);
  footer.appendChild(downloadBtn);
  modal.appendChild(footer);
  document.body.appendChild(overlay);
  document.body.appendChild(modal);
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
  btn.onmouseover = () => btn.style.transform = 'scale(1.05)';
  btn.onmouseout = () => btn.style.transform = 'scale(1)';
  btn.onclick = () => {
    const messages = extractChat();
    if (messages && messages.length > 0) {
      showExportUI({
        title: document.title,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        site: getSite(),
        messages: messages
      });
    } else {
      alert('No messages found to export.');
    }
  };
  document.body.appendChild(btn);
}

function handleUIVisibility() {
  const isChat = isChatPage();
  const hasMessages = !!(document.getElementById('chat-messages') || document.getElementById('gameplay-output'));
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXPORT_CHAT') {
    const messages = extractChat();
    if (!messages || messages.length === 0) {
      sendResponse({ success: false, error: 'No messages found.' });
      return;
    }
    const data = {
      title: document.title,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      site: getSite(),
      messages: messages
    };
    sendResponse({ success: true, data });
    showExportUI(data);
  }
  return true;
});
