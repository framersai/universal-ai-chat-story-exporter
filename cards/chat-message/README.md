# Chat Message Card

Standalone template for a single pair of messages from a chat. The extension
generates one card per two consecutive messages (e.g. user message + reply).

Open `index.html` with live-server to preview.

## Placeholder tokens

| Token                | Meaning                                      |
| -------------------- | -------------------------------------------- |
| `{{characterName}}`  | Character name (for header)                  |
| `{{characterAvatar}}`| Character avatar URL or data URL             |
| `{{platform}}`       | Source platform, e.g. `character.ai`         |
| `{{cardIndex}}`      | Position label, e.g. `Part 3 of 12`          |
| `{{messagesHtml}}`   | Pre-rendered HTML for the two message bubbles|
| `{{date}}`           | Export date                                  |

The `{{messagesHtml}}` slot is filled with one or two `.msg` blocks of the form:

```html
<div class="msg msg-user|msg-character">
  <div class="msg-bubble">
    <div class="msg-head">Author</div>
    <div class="msg-text">Message body</div>
  </div>
</div>
```

Card size is fixed at `720 × 1000` px for consistency with the Character
Profile card.
