/**
 * Plain-text export renderer.
 *
 * Produces a human-readable transcript of the same data the JSON
 * export contains, formatted as:
 *
 *     {Title}
 *     ====================
 *     Platform: ...
 *     URL: ...
 *     Exported: ISO-8601
 *
 *     [character metadata block — name, creator, description, greeting]
 *     [adventure metadata block — title, memory, author's note, story cards]
 *
 *     ---
 *     Conversation ({N} messages)
 *     ---
 *
 *     [USER] You:
 *     message text wrapped at the natural newline boundary
 *
 *     [CHARACTER] Vegeta:
 *     response text
 *
 * Designed to round-trip cleanly into wilds-ai as a less-rich
 * fallback when JSON isn't available — the importer can pick out the
 * top metadata block, the per-message role markers, and the message
 * bodies even from a hand-edited copy.
 */

import type { AdventureMeta, CharacterMeta } from './metadata';

interface TextExportInput {
  timestamp: string;
  url: string;
  site: string | null;
  messages: Array<{ name?: string; role: string; text: string }>;
  characterMeta: CharacterMeta | null;
  adventureMeta: AdventureMeta | null;
}

/** Markdown-ish underline for the title line. */
function divider(char: string, length: number): string {
  return char.repeat(Math.max(3, Math.min(length, 80)));
}

/** Indent a multi-line message body so it visually associates with its role line. */
function indentBody(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `    ${line}` : ''))
    .join('\n');
}

function renderCharacterMetaBlock(meta: CharacterMeta): string {
  const parts: string[] = [];
  parts.push(`Character: ${meta.name}`);
  if (meta.title && meta.title !== meta.name) parts.push(`Tagline: ${meta.title}`);
  if (meta.creator) parts.push(`Creator: @${meta.creator}`);
  if (meta.platform) parts.push(`Platform: ${meta.platform}`);
  if (meta.likes > 0) parts.push(`Likes: ${meta.likes.toLocaleString()}`);
  if (meta.interactions > 0) parts.push(`Interactions: ${meta.interactions.toLocaleString()}`);
  if (meta.upvotes > 0) parts.push(`Upvotes: ${meta.upvotes.toLocaleString()}`);
  if (meta.description) {
    parts.push('');
    parts.push('Description:');
    parts.push(indentBody(meta.description));
  }
  if (meta.greeting) {
    parts.push('');
    parts.push('Greeting:');
    parts.push(indentBody(meta.greeting));
  }
  if (meta.definition) {
    parts.push('');
    parts.push('Definition:');
    parts.push(indentBody(meta.definition));
  }
  const altGreetings = meta.info && Array.isArray((meta.info as any).alternateGreetings)
    ? ((meta.info as any).alternateGreetings as string[])
    : [];
  if (altGreetings.length > 0) {
    parts.push('');
    parts.push(`Alternate greetings (${altGreetings.length}):`);
    altGreetings.forEach((g, i) => {
      parts.push(`  ${i + 1}. ${g.slice(0, 200)}${g.length > 200 ? '…' : ''}`);
    });
  }
  const personas = meta.info && Array.isArray((meta.info as any).personas)
    ? ((meta.info as any).personas as Array<{ name?: string; appearance?: string; pronouns?: string | null }>)
    : [];
  if (personas.length > 0) {
    parts.push('');
    parts.push(`Attached personas (${personas.length}):`);
    for (const p of personas) {
      const tag = [p.name, p.pronouns].filter(Boolean).join(', ');
      parts.push(`  - ${tag || 'Unnamed persona'}${p.appearance ? `: ${p.appearance}` : ''}`);
    }
  }
  return parts.join('\n');
}

function renderAdventureMetaBlock(meta: AdventureMeta): string {
  const parts: string[] = [];
  parts.push(`Adventure: ${meta.title}`);
  if (meta.author) parts.push(`Author: ${meta.author}`);
  if (meta.characterName) parts.push(`Player character: ${meta.characterName}`);
  if (meta.tags?.length) parts.push(`Tags: ${meta.tags.join(', ')}`);
  if (meta.description) {
    parts.push('');
    parts.push('Description:');
    parts.push(indentBody(meta.description));
  }
  if (meta.memory) {
    parts.push('');
    parts.push('Memory:');
    parts.push(indentBody(meta.memory));
  }
  if (meta.authorsNote) {
    parts.push('');
    parts.push("Author's note:");
    parts.push(indentBody(meta.authorsNote));
  }
  if (meta.storyCards?.length) {
    parts.push('');
    parts.push(`Story cards (${meta.storyCards.length}):`);
    for (const card of meta.storyCards) {
      const header = [card.type, card.title].filter(Boolean).join(' · ');
      parts.push(`  • ${header}`);
      if (card.keys) parts.push(`      Keys: ${card.keys}`);
      if (card.value) parts.push(indentBody(`    ${card.value}`));
    }
  }
  return parts.join('\n');
}

function roleLabel(role: string): string {
  const upper = role.toUpperCase();
  if (upper === 'USER' || upper === 'CHARACTER') return upper;
  return upper || 'MESSAGE';
}

/** Build the complete plain-text export string for the modal preview + download. */
export function renderTextExport(data: TextExportInput): string {
  const title =
    data.characterMeta?.name ||
    data.adventureMeta?.title ||
    'Wilds AI Export';

  const sections: string[] = [];

  sections.push(title);
  sections.push(divider('=', title.length));
  sections.push(`Platform: ${data.site ?? 'unknown'}`);
  sections.push(`URL: ${data.url}`);
  sections.push(`Exported: ${data.timestamp}`);

  if (data.characterMeta) {
    sections.push('');
    sections.push(renderCharacterMetaBlock(data.characterMeta));
  }

  if (data.adventureMeta) {
    sections.push('');
    sections.push(renderAdventureMetaBlock(data.adventureMeta));
  }

  sections.push('');
  sections.push(divider('-', 60));
  sections.push(`Conversation (${data.messages.length} messages)`);
  sections.push(divider('-', 60));
  sections.push('');

  for (const message of data.messages) {
    const speaker = message.name || 'Unknown';
    sections.push(`[${roleLabel(message.role)}] ${speaker}:`);
    sections.push(indentBody(message.text));
    sections.push('');
  }

  // Trailing single newline so the file ends cleanly.
  return sections.join('\n').replace(/\n+$/, '\n');
}
