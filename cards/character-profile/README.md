# Character Profile Card

Standalone HTML template for the first story card (character profile).

Open `index.html` directly (double-click or with live-server) to preview the card
with placeholder tokens. The Wilds AI extension fills these in at export time.

## Placeholder tokens

| Token            | Meaning                                      |
| ---------------- | -------------------------------------------- |
| `{{name}}`       | Character name                               |
| `{{creator}}`    | Creator handle (e.g. `By @bignoodle`)        |
| `{{description}}`| Short description / tagline                  |
| `{{avatarUrl}}`  | Character avatar (data URL at export time)   |
| `{{platform}}`   | Source platform, e.g. `character.ai`         |
| `{{date}}`       | Export date string                           |

The card is designed at a fixed `720 × 1000` px size so it renders consistently
in the extension's off-screen canvas.
