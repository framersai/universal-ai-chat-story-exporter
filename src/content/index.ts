/**
 * Content script for character.ai
 */

console.log('Character.ai Exporter: Content script loaded');

const LOGO_URL = chrome.runtime.getURL('wilds-logo.svg');

function isChatPage() {
  const path = window.location.pathname;
  // Strictly match /chat/<id> where <id> is an alphanumeric string (with underscores/hyphens)
  // This avoids matching general /chat or other non-specific pages
  return /^\/chat\/[a-zA-Z0-9_-]+$/.test(path);
}

function extractChat() {
  const container = document.getElementById('chat-messages');
  if (!container) {
    console.log('Character.ai Exporter: Chat container not found');
    return null;
  }

  const messageGroups = Array.from(container.children);
  const extractedMessages = [];

  for (const group of messageGroups) {
    // Look for message content
    const completedMessages = Array.from(group.querySelectorAll('[data-testid="completed-message"]'));
    if (completedMessages.length === 0) continue;

    let activeMessageEl = null;

    // Check for swiper (character responses)
    if (completedMessages.length > 1 || group.querySelector('.swiper')) {
      activeMessageEl = group.querySelector('.swiper-slide-active [data-testid="completed-message"]');
      // Fallback if swiper is not yet fully initialized or class names differ
      if (!activeMessageEl) {
        activeMessageEl = completedMessages[0];
      }
    } else {
      activeMessageEl = completedMessages[0];
    }

    if (!activeMessageEl) continue;

    const prose = activeMessageEl.querySelector('.prose');
    if (!prose) continue;

    // Extract text from paragraphs or direct content
    const paragraphs = Array.from(prose.querySelectorAll('p'));
    const text = paragraphs.length > 0
      ? paragraphs.map(p => p.textContent?.trim()).filter(t => t).join('\n')
      : prose.textContent?.trim() || '';

    // Find sender name
    const nameEl = group.querySelector('.text-sm');
    const name = nameEl ? nameEl.textContent?.trim() : 'Unknown';

    // Determine role
    const isCharacter = !!group.querySelector('.bg-secondary'); // 'c.ai' badge
    const isUser = !!group.querySelector('.flex-row-reverse');
    const role = isCharacter ? 'character' : (isUser ? 'user' : 'unknown');

    extractedMessages.push({
      name,
      role,
      text
    });
  }

  // Filter out any messages that don't have text (like the intro card if it somehow got through)
  const finalMessages = extractedMessages.filter(m => m.text).reverse();
  
  return finalMessages;
}

function showExportUI(data: any) {
  // Check if UI already exists
  if (document.getElementById('cai-exporter-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'cai-exporter-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    z-index: 99999;
  `;

  const modal = document.createElement('div');
  modal.id = 'cai-exporter-modal';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 600px;
    max-height: 85vh;
    background: white;
    border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 100000;
    display: flex;
    flex-direction: column;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111827;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  `;
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
  closeBtn.style.cssText = `
    border: none;
    background: none;
    font-size: 2rem;
    cursor: pointer;
    color: #9ca3af;
    line-height: 1;
    padding: 0;
  `;
  
  const closeModal = () => {
    modal.remove();
    overlay.remove();
  };

  closeBtn.onclick = closeModal;
  overlay.onclick = closeModal;
  
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const pre = document.createElement('pre');
  pre.style.cssText = `
    background: #f9fafb;
    padding: 16px;
    border-radius: 8px;
    overflow: auto;
    flex-grow: 1;
    font-size: 0.875rem;
    border: 1px solid #e5e7eb;
    margin-bottom: 20px;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  `;
  pre.textContent = JSON.stringify(data, null, 2);
  modal.appendChild(pre);

  const footer = document.createElement('div');
  footer.style.cssText = `
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  `;

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy JSON';
  copyBtn.style.cssText = `
    padding: 10px 18px;
    background: #6366f1;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.2s;
  `;
  copyBtn.onmouseover = () => copyBtn.style.background = '#4f46e5';
  copyBtn.onmouseout = () => copyBtn.style.background = '#6366f1';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = originalText, 2000);
  };

  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = 'Download JSON';
  downloadBtn.style.cssText = `
    padding: 10px 18px;
    background: #10b981;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.2s;
  `;
  downloadBtn.onmouseover = () => downloadBtn.style.background = '#059669';
  downloadBtn.onmouseout = () => downloadBtn.style.background = '#10b981';
  downloadBtn.onclick = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cai-chat-${new Date().getTime()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  footer.appendChild(copyBtn);
  footer.appendChild(downloadBtn);
  modal.appendChild(footer);

  document.body.appendChild(overlay);
  document.body.appendChild(modal);
}

// Function to add a floating export button to the page
function addFloatingButton() {
  if (document.getElementById('cai-exporter-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'cai-exporter-btn';
  btn.innerHTML = `<img src="${LOGO_URL}" style="width: 20px; height: 20px;" /><span>Export Chat</span>`;
  btn.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9998;
    background: #6366f1;
    color: white;
    border: none;
    border-radius: 50px;
    padding: 12px 20px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: sans-serif;
    transition: transform 0.2s, background 0.2s;
  `;
  btn.onmouseover = () => {
    btn.style.transform = 'scale(1.05)';
    btn.style.background = '#4f46e5';
  };
  btn.onmouseout = () => {
    btn.style.transform = 'scale(1)';
    btn.style.background = '#6366f1';
  };

  btn.onclick = () => {
    const messages = extractChat();
    if (messages && messages.length > 0) {
      const chatData = {
        title: document.title,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        messages: messages
      };
      showExportUI(chatData);
    } else {
      alert('No messages found to export.');
    }
  };

  document.body.appendChild(btn);
}

function handleUIVisibility() {
  const isChat = isChatPage();
  const hasMessages = !!document.getElementById('chat-messages');
  const existingBtn = document.getElementById('cai-exporter-btn');

  if (isChat && hasMessages) {
    addFloatingButton();
  } else if (existingBtn) {
    existingBtn.remove();
  }
}

// Watch for DOM changes (common in SPAs)
const observer = new MutationObserver(() => {
  handleUIVisibility();
});

observer.observe(document.body, { childList: true, subtree: true });

// Also listen for URL changes that don't trigger a reload
window.addEventListener('popstate', handleUIVisibility);

// Initial check
handleUIVisibility();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXPORT_CHAT') {
    console.log('Character.ai Exporter: Received export request');
    
    try {
      const messages = extractChat();
      
      if (!messages || messages.length === 0) {
        sendResponse({ success: false, error: 'No messages found. Are you in a chat?' });
        return;
      }

      const chatData = {
        title: document.title,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        messages: messages
      };

      sendResponse({ success: true, data: chatData });
      
      // Also show the in-page UI if requested from popup
      showExportUI(chatData);
    } catch (error) {
      console.error('Extraction error:', error);
      sendResponse({ success: false, error: (error as Error).message });
    }
  }
  return true;
});
