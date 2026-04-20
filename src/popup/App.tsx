import React, { useState } from 'react';
import './App.css';

const App: React.FC = () => {
  const [hasData, setHasData] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (tab.id) {
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
          <img src="/wilds-logo.svg" alt="Wilds AI Logo" className="main-logo" />
          <h1>Wilds AI</h1>
        </div>
        <p className="subtitle">Universal Chat & Story Exporter</p>
      </header>
      <main>
        <p className="info-text">
          Open a Character.ai chat and click the button below to extract your messages.
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
        <p>&copy; 2026 Wilds AI</p>
      </footer>
    </div>
  );
};

export default App;
