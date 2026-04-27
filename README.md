<!--
Keywords: character.ai exporter, character ai chat export, ai dungeon exporter,
ai dungeon adventure export, janitor ai exporter, janitor ai chat export, save
janitor ai chats, export character ai to json, download character ai chats,
character ai backup, ai dungeon backup, janitor ai backup, ai roleplay export,
ai companion chat export, chrome extension character ai, chrome extension janitor
ai, export ai conversations, ai chat to png, story cards, wilds ai exporter.
-->

# Wilds AI Exporter — Export Character.AI, AI Dungeon & Janitor AI Chats

> **Free Chrome extension to export, back up, and save your Character.AI chats, AI Dungeon adventures, and Janitor AI conversations as JSON, plain text, PDF, or beautiful PNG story cards. 100% local, privacy-first — nothing leaves your browser.**

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/wilds-ai-universal-ai-cha/nblmojeghhciehfmjondiechgchfdfea)
[![Version](https://img.shields.io/badge/version-0.6.0-blue)](./public/manifest.json)
[![License](https://img.shields.io/badge/license-All%20rights%20reserved-lightgrey)](#-license)
[![Made by Wilds AI](https://img.shields.io/badge/Made%20by-Wilds%20AI-6366f1)](https://wilds.ai)

<p align="center">
  <a href="https://wilds.ai/">
    <img src="public/wilds-logo.svg" alt="Wilds AI — Universal AI Chat & Story Exporter logo" width="120" />
  </a>
</p>

**Wilds AI Exporter** is a free, open-source Chrome extension that lets roleplayers, writers, researchers, and AI enthusiasts **export Character.AI chats**, **back up AI Dungeon adventures**, **save Janitor AI conversations**, and archive AI roleplay transcripts to clean, structured JSON — or render them as shareable PNG story cards. Everything runs locally in your browser: no accounts, no servers, no tracking.

Built and maintained by the [Wilds AI](https://wilds.ai) team. Last updated April 2026.

---

## 📑 Table of Contents

- [Why Wilds AI Exporter?](#-why-wilds-ai-exporter)
- [Features](#-features)
- [Supported Platforms](#-supported-platforms)
- [Installation](#-installation)
- [How to Use](#-how-to-use)
- [Use Cases](#-use-cases)
- [Data Structure](#-data-structure)
- [Privacy](#-privacy)
- [FAQ](#-faq)
- [Development](#-development)
- [About Wilds AI](#-about-wilds-ai)
- [License](#-license)

---

## 🌟 Why Wilds AI Exporter?

If you've ever lost access to a Character.AI bot after a platform update, had an AI Dungeon adventure disappear, switched personas in Janitor AI and feared losing the chat, or wanted to share a favorite roleplay moment on social media — this extension is built for you.

- **One click, full export** — no copy-pasting messages by hand.
- **Works with the real backends** — Character.AI `get_character_info`, AI Dungeon GraphQL `GetGameplayAdventure`, and Janitor AI's `/hampter/chats/:id` payload, so you get the same data the site itself shows you (full character profile, adventure memory, lore/story cards, personas, alternate greetings, etc.).
- **Private by design** — unlike cloud-based exporters, nothing ever leaves your browser. No account required.
- **Two output formats** — portable JSON for archives and re-imports, or polished PNG story cards for sharing.
- **Actively maintained** — new features (Janitor AI integration, AI Dungeon story-card exports, rich metadata) ship regularly.

## ✨ Features

- **One-Click Export** — A floating button appears on any chat or adventure page. Click once to extract everything.
- **Four Output Formats** — Pick what fits the use case:
  - **JSON** (`.json`) — full-fidelity archive, easy to diff, re-import, or feed into other tools.
  - **Plain text** (`.txt`) — readable transcript with the same metadata block, designed to round-trip into wilds-ai or any text-based importer.
  - **PDF** (`.pdf`) — multi-page document with selectable text and role-tinted headers, generated client-side via jsPDF. v0.5.0 renders the full character profile card as the hero on Character.AI / Janitor AI exports; AI Dungeon exports get the adventure cover art as a banner. v0.6.0 adds an AI Dungeon story-card visual appendix at the end of the PDF — up to 6 lore cards rendered via the same template the Story Cards ZIP path uses.
  - **PNG story cards** (`.zip`) — shareable image cards for character profiles, chat highlights, and AI Dungeon world-info lore.
- **Multi-Platform** — Works with [Character.AI](https://character.ai), [AI Dungeon](https://play.aidungeon.com), and [Janitor AI](https://janitorai.com) out of the box. More platforms coming.
- **Rich Metadata Capture** — Name, description, greeting, creator, upvotes, likes, interactions for Character.AI; memory, author's note, tags, story cards (lore entries), author, and the full action log for AI Dungeon; character profile, alternate greetings, persona info, and the full message thread for Janitor AI.
- **Instant In-Page Preview** — Review the JSON, plain-text, or rendered PNG cards before you save them.
- **Private by Design** — All processing happens locally in your browser. Zero analytics, zero servers, zero data leaves your machine.
- **Open Format** — Every format is documented and importable: JSON for programmatic access, plain text for human reading, PDF for printing or sharing, PNG cards for social media.

## 🚀 Supported Platforms

| Platform | What gets exported |
| --- | --- |
| **Character.AI** (`character.ai`) | Full chat history, character profile (name, description, greeting, definition, avatar), likes, interactions, upvotes, creator username |
| **AI Dungeon** (`play.aidungeon.com`) | Full adventure (actions + AI narration), memory, author's note, **story cards / world-info lore entries**, tags, cover image, author profile |
| **Janitor AI** (`janitorai.com`) | Full chat thread, character profile (chat name, description, greeting, avatar), **alternate greetings**, NSFW flags, attached personas (name, appearance, pronouns), chat metadata |

## 📦 Installation

### Chrome Web Store (recommended)

Install [Wilds AI Exporter](https://chromewebstore.google.com/detail/wilds-ai-universal-ai-cha/nblmojeghhciehfmjondiechgchfdfea) from the Chrome Web Store — one click, auto-updating.

### From Source (for developers)

```bash
git clone https://github.com/framersai/universal-ai-chat-story-exporter.git
cd universal-ai-chat-story-exporter
npm install
npm run build
```

Then open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the `dist/` folder.

## 🧑‍💻 How to Use

1. Open any chat on **Character.AI**, any adventure on **AI Dungeon**, or any chat on **Janitor AI** (`janitorai.com/chats/:id`).
2. Click the **Export Chat** / **Export Adventure** button in the bottom-right corner.
3. Preview your export, then choose a format:
   - **JSON** — Copy to clipboard or download as `.json`.
   - **Text** — Preview the plain-text transcript, copy to clipboard, or download as `.txt`.
   - **PDF** — Download a multi-page `.pdf` with selectable text and role-tinted headers.
   - **Story Cards** — Download a ZIP of shareable PNG cards.

> **Note for Janitor AI:** the very first time you export a freshly-loaded chat, send any message in the chat first (or wait for the page to refresh) so the extension can capture your auth token. After that, exports work instantly. The extension never makes outbound requests on your behalf — it only re-uses the same authenticated request your browser already issues.

## 💡 Use Cases

- **Backup before a platform update** — save your favorite Character.AI chats and AI Dungeon adventures locally so you never lose them.
- **Archive roleplay chats** — keep a permanent record of long-running Character.AI roleplays for writing reference.
- **Share on social media** — turn your favorite AI chat moments into polished PNG story cards ready for Twitter, Reddit, or Discord.
- **Feed into other AI tools** — export as JSON and pipe it into your own scripts, LLM pipelines, or writing apps.
- **Document AI creative work** — writers, researchers, and educators can archive AI-assisted sessions for later citation or analysis.
- **Migrate between platforms** — export from one AI platform and import or reconstruct on another.

## 🗂 Data Structure

Every export — Character.AI, AI Dungeon, or Janitor AI — is a single JSON object with the same top-level shape. The platform-specific fields live under `characterMeta` (Character.AI / Janitor AI) or `adventureMeta` (AI Dungeon); the other is `null`. Janitor AI reuses the `CharacterMeta` shape with `platform: "Janitor AI"` and platform-specific extras under `info`.

### Schema

```ts
interface Export {
  /** ISO 8601 timestamp of when the export was generated. */
  timestamp: string;
  /** URL of the chat or adventure page the export was taken from. */
  url: string;
  /** Source platform. */
  site: "character" | "aidungeon" | "janitor";
  /** Ordered conversation/action log. */
  messages: Array<{
    name?: string;            // "You" / persona name for user, character name or "Story/AI" otherwise
    role: "user" | "character";
    text: string;
  }>;
  /** Present on Character.AI and Janitor AI exports, otherwise null. */
  characterMeta: CharacterMeta | null;
  /** Present on AI Dungeon exports, otherwise null. */
  adventureMeta: AdventureMeta | null;
}

interface CharacterMeta {
  name: string;
  title: string;               // tagline (Character.AI) or long pitch line (Janitor AI); empty when same as name
  creator: string;             // raw username, no "By @" prefix; empty for Janitor AI
  description: string;         // plain text; for Janitor AI the original HTML is preserved under info.descriptionHtml
  greeting: string;
  definition: string;          // empty unless info.has_definition is true (Character.AI only)
  upvotes: number;             // 0 for Janitor AI
  avatarUrl: string;
  platform: "character.ai" | "Janitor AI";
  likes: number;               // parsed from the Like button (supports "1.7k", "7.3M"); 0 for Janitor AI
  interactions: number;        // 0 for Janitor AI
  /** Remaining platform-specific fields. See the per-platform examples below. */
  info: Record<string, unknown> | null;
}

interface AdventureMeta {
  title: string;
  platform: "AI Dungeon";
  description: string;
  image: string;               // cover image URL
  memory: string;              // persistent memory prepended to every prompt
  authorsNote: string;         // author's note appended to every prompt
  author: string;
  authorAvatar: string;
  characterName: string;       // player's in-game character name
  tags: string[];
  storyCards: Array<{
    id: string;
    type: string;              // e.g. "location", "character", "faction"
    title: string;
    keys: string;              // comma-separated trigger keys
    value: string;              // card body injected when keys match
    description: string;
    useForCharacterCreation: boolean;
  }>;
  /** Remaining GraphQL fields minus those promoted above. */
  info: Record<string, unknown> | null;
}
```

### Example: Character.AI export

```json
{
  "timestamp": "2026-04-24T12:34:56.000Z",
  "url": "https://character.ai/chat/abc123xyz",
  "site": "character",
  "messages": [
    { "name": "You", "role": "user", "text": "Hello!" },
    { "name": "Vegeta", "role": "character", "text": "Tch. What do you want?" }
  ],
  "characterMeta": {
    "name": "Vegeta",
    "title": "Prince of all Saiyans",
    "creator": "bignoodle",
    "description": "The proud Saiyan prince from Dragon Ball Z. Fierce, competitive, and not one for small talk.",
    "greeting": "What are you doing here, earthling?",
    "definition": "",
    "upvotes": 12345,
    "avatarUrl": "https://characterai.io/i/400/static/avatars/uploaded/2024/3/vegeta.webp",
    "platform": "character.ai",
    "likes": 1700,
    "interactions": 7300000,
    "info": {
      "external_id": "abc123xyz",
      "participant__name": "Vegeta",
      "user__username": "bignoodle",
      "num_interactions": 7300000,
      "visibility": "PUBLIC",
      "copyable": false,
      "img_gen_enabled": true,
      "categories": ["Anime", "Dragon Ball"],
      "created_at": "2023-06-15T14:22:00.000Z"
    }
  }
}
```

### Example: AI Dungeon export

```json
{
  "timestamp": "2026-04-24T15:10:00.000Z",
  "url": "https://play.aidungeon.com/adventure/whisper-citadel/the-whispering-citadel/play",
  "site": "aidungeon",
  "messages": [
    { "name": "Story/AI", "role": "character", "text": "The wind howls through the ruined archway…" },
    { "name": "You", "role": "user", "text": "I draw my blade and step into the courtyard." }
  ],
  "adventureMeta": {
    "title": "The Whispering Citadel",
    "platform": "AI Dungeon",
    "description": "A dark fantasy adventure in a kingdom haunted by its own past.",
    "image": "https://files.aidungeon.com/adventures/abc.jpg",
    "memory": "You are Kael, a rogue sorcerer seeking redemption in the ruins of Vaelor.",
    "authorsNote": "Keep responses dark and atmospheric.",
    "author": "QuillSpinner",
    "authorAvatar": "https://files.aidungeon.com/users/qs.jpg",
    "characterName": "Kael",
    "tags": ["fantasy", "dark", "magic"],
    "storyCards": [
      {
        "id": "222653471",
        "type": "location",
        "title": "basement",
        "keys": "basement",
        "value": "The basement of Covenant House is full of defunct alchemical apparatus and broken orreries.",
        "description": "",
        "useForCharacterCreation": true
      }
    ],
    "info": {
      "id": "adv-abc123",
      "shortId": "whisper-citadel",
      "actionCount": 142,
      "contentType": "adventure",
      "createdAt": "2026-01-10T09:15:00.000Z",
      "published": false,
      "nsfw": false,
      "contentRating": "PG13"
    }
  }
}
```

### Example: Janitor AI export

```json
{
  "timestamp": "2026-04-25T12:34:56.000Z",
  "url": "https://janitorai.com/chats/2296186091",
  "site": "janitor",
  "messages": [
    { "name": "Ryuuko", "role": "character", "text": "The guild hall is loud as hell tonight…" },
    { "name": "Stark", "role": "user", "text": "Hey." },
    { "name": "Ryuuko", "role": "character", "text": "...Hey? Are you fucking serious right now?" }
  ],
  "characterMeta": {
    "name": "Ryuuko",
    "title": "Ryuuko - Your Guild Leader Loses A Bet And Becomes Your \"Personal Party Whore\"?!",
    "creator": "",
    "description": "The Azure Dragoness — silver hair, crimson eyes, fights with bare hands and magic. Guild leader of the Azure Dragon Guild.",
    "greeting": "The guild hall is absolutely loud as hell tonight…",
    "definition": "",
    "upvotes": 0,
    "avatarUrl": "https://ella.janitorai.com/bot-avatars/vZ_R8Vp1kU6oHUaINIV5k.webp",
    "platform": "Janitor AI",
    "likes": 0,
    "interactions": 0,
    "info": {
      "descriptionHtml": "<p style=\"text-align: center;\"><strong>\"You land a single clean hit on me before I drop your ass, you win.\"</strong></p>",
      "alternateGreetings": [
        "The grand ballroom of the noble estate is buzzing with elegant music…",
        "The guild's large open-air bathhouse is filled with steam…"
      ],
      "is_nsfw": true,
      "is_image_nsfw": false,
      "is_public": true,
      "character_id": "bdb9c0f3-5bac-4825-a230-8ce7cfa3d1de",
      "chat_id": 2296186091,
      "chat_created_at": "2026-04-25T12:06:25.540Z",
      "soundcloud_track_id": null,
      "allow_proxy": true,
      "personas": [
        {
          "id": "6130d720-a702-4a82-9928-9cd069c66bfe",
          "name": "Stark",
          "appearance": "A 32 yr old bearded man",
          "pronouns": null,
          "is_default": true,
          "avatar": ""
        }
      ]
    }
  }
}
```

> **Note:** for Janitor AI, `info.descriptionHtml` preserves the raw HTML description (which Janitor uses for in-app layout — images, links, formatted greetings), while `description` is the plain-text version used by the PNG cards. `info.alternateGreetings` mirrors the bot's `first_messages` array so the extra opening scenes survive the export. `info.personas` captures every persona attached to this chat (bots can be played from multiple persona perspectives).

## 🔒 Privacy

- **No accounts, no sign-in, no telemetry.** We don't know you installed this.
- **No data leaves your browser.** API calls to `character.ai`, `aidungeon.com`, and `janitorai.com` only happen on pages you're already browsing, to fetch data the site itself exposes to your session.
- **Janitor AI is read-only by observation.** Because Janitor sits behind Cloudflare, the extension does not initiate cross-origin requests against its API. Instead, a small in-page script passively observes the chat responses your browser already loads, and (for cold-start cases) can re-issue the same authenticated request the page itself would make. No credentials are stored.
- **Minimum permissions.** The extension requests only `downloads` (to save files) and host access for the supported sites.
- **Open source.** The full source is in this repository — you can audit exactly what it does.

## ❓ FAQ

### How do I export my Character.AI chat?

Install the extension, open your chat on character.ai, and click the **Export Chat** button in the bottom-right corner. Choose to download as JSON or a ZIP of PNG story cards.

### How do I back up an AI Dungeon adventure?

Open the adventure on `play.aidungeon.com` and click **Export Adventure**. You'll get the full action log plus adventure metadata (memory, author's note, story cards, tags), optionally as shareable PNG cards.

### How do I export my Janitor AI chat?

Open any chat at `janitorai.com/chats/:id` and click **Export Chat** in the bottom-right corner. The first time on a freshly-loaded chat, sending a message (or letting the page reload) helps the extension capture your auth token; after that, exports are instant. The export includes the character profile, all messages, alternate greetings, and any personas attached to the chat.

### Why does Janitor AI work differently from Character.AI?

Janitor AI's API is protected by Cloudflare, so the extension cannot make outbound API calls against it the way it can with the public Character.AI endpoint. Instead, a small in-page script watches the responses your browser already fetches and uses them to build the export — the same data, captured without any extra network traffic.

### Will my Janitor AI personas be exported?

Yes. Every persona attached to the chat (with `name`, `appearance`, `pronouns`, and avatar) is preserved under `characterMeta.info.personas`. Each user message in `messages` is labeled with the persona name that produced it.

### Can I save my Character.AI chats before they're deleted?

Yes — this extension is designed for exactly that. Character.AI has changed content policies and removed bots before. One click captures the full conversation plus character profile locally so you always have a copy.

### Is Wilds AI Exporter free?

Yes — completely free and open source. No ads, no paywall, no data collection, no subscription.

### Does it upload my chats anywhere?

No. All extraction and rendering runs locally in your browser. Your conversations never touch a Wilds AI server.

### What format are the exports?

Four formats, picked per export from the modal:

- **`.json`** — full-fidelity, machine-readable archive (the canonical re-import format for wilds-ai).
- **`.txt`** — plain-text transcript with the same metadata header, easy for humans to read or paste into another tool.
- **`.pdf`** — multi-page document with selectable text, role-tinted headers, and a metadata cover block.
- **`.zip`** of PNG story cards — for sharing chat highlights or character profiles on social media.

### Will this delete or modify my chats?

No. The extension is read-only: it only reads what's already displayed on the page.

### Does it work with the Character.AI mobile app?

No — it's a Chrome browser extension, so it works on the Character.AI website in Chrome (or any Chromium-based browser like Edge, Brave, Arc) on desktop.

### Does it work with AI Dungeon Scenarios?

The exporter reads adventures at `play.aidungeon.com/adventure/<id>/.../play`. Scenarios themselves are not directly supported yet, but any adventure created from a scenario exports normally.

### Which browsers are supported?

Chrome, Edge, Brave, Arc, Opera, and any other Chromium-based browser that supports Chrome extensions (MV3).

### What about Character.AI images or voice?

The current export captures text messages plus character metadata (including avatar URL). Generated images and voice clips are not extracted.

### Can I re-import my exported JSON somewhere?

The exported JSON is a clean, documented structure — you can feed it into your own scripts, use it as context for an LLM, or build a viewer. A companion web viewer on [wilds.ai](https://wilds.ai) is planned.

### Is this affiliated with Character.AI or AI Dungeon?

No. Wilds AI Exporter is an independent tool made by the Wilds AI team. See the disclaimer below.

## 🛠 Development

```bash
npm run dev     # Vite dev server for the popup
npm run build   # Build for production (outputs to dist/)
```

Contributions welcome — open an issue or PR on GitHub.

## 👥 About Wilds AI

Wilds AI builds tools for the AI roleplay, interactive fiction, and AI-assisted writing community. Learn more at [wilds.ai](https://wilds.ai). For feedback, bug reports, or feature requests, open an issue on this repository.

## 📄 License

&copy; 2026 [Wilds AI](https://wilds.ai). All rights reserved.

---

**Related keywords:** Character.AI exporter · Character AI chat export · AI Dungeon exporter · AI Dungeon adventure export · Janitor AI exporter · Janitor AI chat export · save Janitor AI chats · export Character AI to JSON · download Character AI chats · Character AI backup · AI Dungeon backup · Janitor AI backup · AI roleplay export · AI companion chat export · Chrome extension Character AI · Chrome extension Janitor AI · export AI conversations · AI chat to PNG · story cards · Wilds AI exporter.

*Disclaimer: This extension is an independent project and is not affiliated with, endorsed by, or sponsored by Character.AI, AI Dungeon, Latitude Games, Janitor AI, or any of their affiliates.*
