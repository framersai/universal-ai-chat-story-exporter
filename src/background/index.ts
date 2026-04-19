/**
 * Background Service Worker
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Character.ai Exporter: Extension installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'DOWNLOAD_DATA') {
    const { data, filename } = request;
    
    // Convert data to a Blob URL
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    
    // In Manifest V3 background workers, we can't use window.URL.createObjectURL directly.
    // However, we can use the downloads API if we have the permission.
    
    // For large data, we might need a different approach, but for a boilerplate,
    // we'll use a data URL for simplicity if it's small, or just initiate download.
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: true
      });
    };
    reader.readAsDataURL(blob);
    
    sendResponse({ success: true });
  }
});
