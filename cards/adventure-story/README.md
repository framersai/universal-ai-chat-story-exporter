# Adventure Story Card

Landscape story card for AI Dungeon adventures. No profile card exists for
that platform — every card is a story beat (user action + AI narration, or a
pair of sequential story messages).

Open `index.html` with live-server to preview.

## Placeholder tokens

| Token               | Meaning                                       |
| ------------------- | --------------------------------------------- |
| `{{adventureTitle}}`| Adventure name (from document title)          |
| `{{platform}}`      | Source platform (`AI Dungeon`)                |
| `{{cardIndex}}`     | Position label, e.g. `Chapter 3 of 12`        |
| `{{messagesHtml}}`  | Pre-rendered HTML for one or two message cards|
| `{{date}}`          | Export date                                   |

Message slot layout:

```html
<div class="msg msg-user|msg-character">
  <div class="msg-inner">
    <div class="msg-label">Your Action | The Story Continues</div>
    <div class="msg-text">…</div>
  </div>
</div>
```

Card size is fixed at `1280 × 720` px (landscape) to give narrative passages
room to breathe.
