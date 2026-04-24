<!--
Keywords: character.ai exporter, character ai chat export, ai dungeon exporter,
ai dungeon adventure export, export character ai to json, download character ai
chats, character ai backup, ai dungeon backup, ai roleplay export, ai companion
chat export, chrome extension character ai, export ai conversations, ai chat
to png, story cards, wilds ai exporter.
-->

# Wilds AI Exporter — Export Character.AI Chats & AI Dungeon Adventures

> **Free Chrome extension to export, back up, and save your Character.AI chats and AI Dungeon adventures as JSON or beautiful PNG story cards. 100% local, privacy-first — nothing leaves your browser.**

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/)
[![Version](https://img.shields.io/badge/version-0.2.0-blue)](./public/manifest.json)
[![Made by Wilds AI](https://img.shields.io/badge/Made%20by-Wilds%20AI-6366f1)](https://wilds.ai)

<p align="center">
  <a href="https://wilds.ai/">
    <img src="public/wilds-logo.svg" alt="Wilds AI — Universal AI Chat & Story Exporter logo" width="120" />
  </a>
</p>

**Wilds AI Exporter** is a professional Chrome extension that lets roleplayers, writers, and researchers **export Character.AI chats**, **back up AI Dungeon adventures**, and **save AI roleplay transcripts** to clean, structured JSON — or render them as shareable PNG story cards. Everything runs in your browser: no accounts, no servers, no tracking.

Keywords: `character.ai exporter` · `export character ai to json` · `ai dungeon adventure export` · `ai chat backup` · `ai roleplay download` · `ai chat to png` · `character ai story cards`

---

## ✨ Features

- **One-Click Export** — A floating button appears on any chat or adventure page. Click once to extract everything.
- **Beautiful Story Cards** — Render chats and character profiles as shareable PNG cards (profile + paired message cards), bundled as a zip.
- **Multi-Platform** — Works with [Character.AI](https://character.ai) and [AI Dungeon](https://play.aidungeon.com) out of the box.
- **Rich Metadata** — Captures character name, description, greeting, creator, upvotes, likes, interactions, adventure memory, author's note, story cards, tags, and more.
- **Instant Preview** — See your export in-page before you save it.
- **Private by Design** — All processing happens locally in your browser. No analytics, no external servers, no data ever leaves your machine.
- **Open Format** — Export as portable `.json` (human-readable, easy to diff, easy to re-import).

## 🚀 Supported Platforms

| Platform | What gets exported |
|---|---|
| **Character.AI** | Full chat history, character profile (name, description, greeting, definition, avatar), likes, interactions, upvotes |
| **AI Dungeon** | Full adventure (actions + AI narration), memory, author's note, story cards, tags, cover image, author |

## 📦 Installation

### Chrome Web Store (recommended)
Install [Wilds AI Exporter](https://chromewebstore.google.com/) from the Chrome Web Store.

### From Source
```bash
git clone https://github.com/framersai/universal-ai-chat-story-exporter.git
cd universal-ai-chat-story-exporter
npm install
npm run build
```
Then open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the `dist/` folder.

## 🧑‍💻 How to Use

1. Open any chat on **Character.AI** or any adventure on **AI Dungeon**.
2. Click the **Export Chat** / **Export Adventure** button in the bottom-right corner.
3. Preview your export, then:
   - **Copy JSON** to your clipboard, or
   - **Download JSON** as a file, or
   - **Download Story Cards (ZIP)** — a pack of shareable PNG cards.

## 🗂 Data Structure

A Character.AI export looks like:

```json
{
  "timestamp": "2026-04-24T12:34:56.000Z",
  "url": "https://character.ai/chat/<id>",
  "site": "character",
  "messages": [
    { "name": "You", "role": "user", "text": "Hello!" },
    { "name": "Vegeta", "role": "character", "text": "Tch. What do you want?" }
  ],
  "characterMeta": {
    "name": "Vegeta",
    "creator": "bignoodle",
    "description": "Prince of all Saiyans…",
    "greeting": "What are you doing here?",
    "upvotes": 12345,
    "likes": 1700,
    "interactions": 7300000,
    "platform": "character.ai",
    "info": { "/* remaining API fields */": null }
  },
  "adventureMeta": null
}
```

AI Dungeon exports share the same shape with `adventureMeta` populated (title, description, memory, authorsNote, storyCards, tags, author, …) and `characterMeta` set to `null`.

## 🔒 Privacy

- No accounts, no sign-in, no telemetry.
- No data leaves your browser. API calls to `character.ai` / `aidungeon.com` only happen on pages you're already browsing, to fetch data the site itself exposes to your session.
- The only permissions the extension uses are `downloads` (to save files) and host access for the two supported sites.

## ❓ FAQ

**How do I export my Character.AI chat?**
Install the extension, open your chat on character.ai, and click the **Export Chat** button in the bottom-right corner. Pick JSON or PNG story cards.

**How do I back up an AI Dungeon adventure?**
Open the adventure on `play.aidungeon.com` and click **Export Adventure**. You'll get the full action log plus adventure metadata (memory, author's note, story cards, tags).

**Is Wilds AI Exporter free?**
Yes — completely free. No ads, no paywall, no data collection.

**Does it upload my chats anywhere?**
No. All extraction and rendering runs locally in your browser.

**What format are the exports?**
JSON (`.json`) or a ZIP of PNG story cards. Both are portable and easy to archive.

**Will this delete or modify my chats?**
No. The extension is read-only: it only reads what's already displayed on the page.

**Does it work with the Character.AI mobile app?**
No — it's a Chrome browser extension, so it works on the Character.AI website in Chrome on desktop.

## 🛠 Development

```bash
npm run dev     # Vite dev server for the popup
npm run build   # Build for production (outputs to dist/)
```

## 📄 License

&copy; 2026 [Wilds AI](https://wilds.ai). All rights reserved.

---

**Keywords:** Character.AI exporter, Character AI chat export, AI Dungeon exporter, AI Dungeon adventure export, export Character AI to JSON, download Character AI chats, Character AI backup, AI Dungeon backup, AI roleplay export, AI companion chat export, Chrome extension Character AI, export AI conversations, AI chat to PNG, story cards, Wilds AI exporter.

*Disclaimer: This extension is an independent project and is not affiliated with, endorsed by, or sponsored by Character.AI, AI Dungeon, Latitude, or any of their affiliates.*
