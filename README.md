# Wilds AI: Character.ai Chat Exporter

A Chrome extension to export your Character.ai chat histories into clean, structured JSON format. Developed by Wilds AI.

![Wilds AI Logo](public/wilds-logo.svg)

## Features

- **Chronological Export**: Automatically handles Character.ai's dynamic layout to ensure messages are exported in the correct order.
- **Smart Role Detection**: Accurately distinguishes between the User and the Character.
- **Swipe Support**: Captures the active response when multiple "swipes" are available.
- **Modern UI**: Features a floating action button on the chat page and a sleek extension popup.
- **Instant Preview**: View your extracted JSON in a formatted modal directly on the page.
- **One-Click Actions**: Copy to clipboard or download as a `.json` file instantly.

## Installation

### From Source
1. Clone the repository:
   ```bash
   git clone https://github.com/framersai/character-ai-chat-exporter.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Open Chrome and navigate to `chrome://extensions/`.
5. Enable "Developer mode" in the top right.
6. Click "Load unpacked" and select the `dist` folder in this project directory.

## Usage

1. Open a chat on [character.ai](https://character.ai).
2. Look for the floating **Export Chat** button in the bottom-right corner:
   
   ![Export Chat Button](https://res.cloudinary.com/djaqusrpx/image/upload/v1776609944/Screenshot_from_2026-04-19_15-43-09_sbvfnc.png)

3. Click it to extract the chat.
4. A modal will appear showing the JSON. You can then:
   - **Copy JSON**: Copies the raw data to your clipboard.
   - **Download JSON**: Saves the data as a timestamped file.

## Data Structure

The exported JSON follows this structure:

```json
{
  "title": "Character Name",
  "timestamp": "2026-04-19T...",
  "url": "https://character.ai/chat/...",
  "messages": [
    {
      "name": "User",
      "role": "user",
      "text": "Hello!"
    },
    {
      "name": "Vegeta",
      "role": "character",
      "text": "Tch. What do you want?"
    }
  ]
}
```

## Development

- `npm run dev`: Start Vite development server.
- `npm run build`: Build the extension for production (output to `dist/`).

## License

&copy; 2026 Wilds AI. All rights reserved.

---
*Disclaimer: This extension is not affiliated with, authorized, maintained, sponsored or endorsed by Character.ai or any of its affiliates or subsidiaries.*
