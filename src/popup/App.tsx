import React, { useState } from 'react';
import './App.css';

/**
 * Toolbar popup UI.
 *
 * The popup is a thin shell — its only real job is to dispatch an
 * `EXPORT_CHAT` message to the active tab's content script, which then opens
 * the actual export modal on the page. That split keeps the popup simple and
 * ensures the preview renders in a full-width layout rather than a tiny
 * 300px-wide popup.
 */
const App: React.FC = () => {
  /** Set to `true` after a successful export round-trip to show a hint. */
  const [hasData, setHasData] = useState<boolean>(false);
  /** Error string shown inline if the content script couldn't export. */
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab.id) {
        // The content script handles the actual extraction + UI. We just
        // need confirmation that it worked so the popup can show feedback.
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'EXPORT_CHAT' });
        if (response && response.success) {
          setHasData(true);
        } else {
          setError(response?.error || 'Unknown error');
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="container">
      <header>
        <div className="logo-container">
          <a href="https://wilds.ai/" target="_blank" rel="noopener noreferrer">
            <img src="/wilds-logo.svg" alt="Wilds AI Logo" className="main-logo" />
          </a>
          <h1>Wilds AI</h1>
        </div>
        <p className="subtitle">Universal Chat & Story Exporter</p>
      </header>
      <main>
        <p className="info-text">
          Open a chat on Character.AI, AI Dungeon, Janitor AI, or Chai AI and click below to extract your messages.
        </p>
        
        <button className="export-btn" onClick={handleExport}>
          Export Current Chat
        </button>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {hasData && !error && (
          <p className="success-hint">
            ✓ Chat displayed on page
          </p>
        )}
      </main>
      <footer>
        <p>
          &copy; 2026{' '}
          <a href="https://wilds.ai/" target="_blank" rel="noopener noreferrer">
            Wilds AI
          </a>
        </p>
      </footer>
    </div>
  );
};

export default App;
