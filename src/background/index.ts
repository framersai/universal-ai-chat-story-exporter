/**
 * Background Service Worker
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Wilds AI Exporter: Extension installed');
});

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const blob = await res.blob();
  return blobToDataUrl(blob);
}

async function fetchCharacterInfo(externalId: string): Promise<any> {
  const res = await fetch(
    'https://neo.character.ai/character/v1/get_character_info',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ external_id: externalId, lang: 'en' }),
    }
  );
  if (!res.ok) throw new Error(`get_character_info -> ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action === 'FETCH_IMAGE' && typeof request.url === 'string') {
    fetchImageAsDataUrl(request.url)
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((err) =>
        sendResponse({ success: false, error: String(err?.message || err) })
      );
    return true; // async response
  }

  if (
    request?.action === 'FETCH_CHARACTER_INFO' &&
    typeof request.externalId === 'string'
  ) {
    fetchCharacterInfo(request.externalId)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) =>
        sendResponse({ success: false, error: String(err?.message || err) })
      );
    return true; // async response
  }

  if (request?.action === 'DOWNLOAD_DATA') {
    const { data, filename } = request as { data: unknown; filename: string };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    blobToDataUrl(blob).then((dataUrl) => {
      chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
      sendResponse({ success: true });
    });
    return true;
  }

  return false;
});
