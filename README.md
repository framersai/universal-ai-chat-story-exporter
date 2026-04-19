# Character.ai Exporter by Wilds AI

A Chrome extension to export chat history from Character.ai.

## Tech Stack
- **Framework:** React 18
- **Language:** TypeScript
- **Build Tool:** Vite
- **Manifest:** Version 3

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Extension
```bash
npm run build
```
This will create a `dist` folder.

### 3. Load in Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable "Developer mode" in the top right.
3. Click "Load unpacked" and select the `dist` folder in this project.

## Project Structure
- `src/popup`: The extension UI.
- `src/content`: Script injected into Character.ai pages.
- `src/background`: Service worker for background tasks (downloads, etc.).
- `public/manifest.json`: Extension configuration.

## License
MIT
