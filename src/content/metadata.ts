/**
 * Character metadata extraction for supported platforms.
 */

export interface CharacterMeta {
  name: string;
  title: string;
  creator: string; // raw username from user__username (e.g. "bignoodle")
  description: string;
  greeting: string;
  definition: string; // empty unless info.has_definition is true
  upvotes: number;
  avatarUrl: string;
  platform: string;
  likes: number;
  interactions: number;
  info: Record<string, unknown> | null;
}

export interface AdventureMeta {
  title: string;
  platform: string; // e.g. "AI Dungeon"
}

function safeText(el: Element | null | undefined): string {
  return (el?.textContent || '').trim();
}

function readNextData(): any | null {
  const nextDataEl = document.getElementById('__NEXT_DATA__');
  if (!nextDataEl?.textContent) return null;
  try {
    return JSON.parse(nextDataEl.textContent);
  } catch {
    return null;
  }
}

/**
 * Parse a character.ai-style count string like "1.7k", "7.3M", "874",
 * "1,234". Returns 0 for empty / unparseable input.
 */
function parseCountString(raw: string): number {
  const s = (raw || '').trim();
  if (!s) return 0;
  const m = s.match(/([\d.,]+)\s*([kmb])?/i);
  if (!m) return 0;

  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(n)) return 0;

  const mult = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[
    (m[2] || '').toLowerCase() as 'k' | 'm' | 'b'
  ];
  return Math.round(mult ? n * mult : n);
}

/**
 * Read the like count from the chat page's Like button. The button's
 * innerText holds the count (e.g. "1.2K", "874"); an empty string means
 * zero likes.
 */
function readLikeCount(): number {
  const btn = document.querySelector<HTMLElement>('button[aria-label="Like"]');
  return parseCountString(btn?.innerText || '');
}

/**
 * character.ai URLs follow /chat/:external_id — pull the id out so we can
 * fetch authoritative character info from neo.character.ai.
 */
function getCharacterIdFromUrl(): string | null {
  const m = window.location.pathname.match(/^\/chat\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * Call the neo.character.ai get_character_info endpoint via the background
 * service worker (which has host_permissions for *.character.ai). Returns
 * the raw `character` object from the response, or null on any failure.
 */
function fetchCharacterInfoViaBackground(
  externalId: string
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { action: 'FETCH_CHARACTER_INFO', externalId },
        (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            resolve(null);
            return;
          }
          const char = response.data?.character;
          resolve(char && typeof char === 'object' ? char : null);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

function toFiniteNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Strip the fields we promote to top-level from the raw API character
 * object so the `info` payload only carries the remaining API-specific
 * metadata.
 */
const PROMOTED_INFO_FIELDS = new Set([
  'title',
  'name',
  'greeting',
  'description',
  'user__username',
  'definition',
  'upvotes',
]);

function stripPromotedFromInfo(
  info: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!info) return null;
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(info)) {
    if (!PROMOTED_INFO_FIELDS.has(k)) rest[k] = v;
  }
  return rest;
}

function buildAvatarUrl(avatarFileName: string): string {
  if (!avatarFileName) return '';
  return `https://characterai.io/i/400/static/avatars/${avatarFileName}`;
}

/**
 * Upscale a character.ai avatar URL to the largest sharp size (they serve
 * the same filename at any `/i/<size>/` prefix). Falls back to the original
 * URL when the pattern doesn't match.
 */
function upscaleCaiAvatar(url: string, size = 400): string {
  if (!url) return '';
  return url.replace(/characterai\.io\/i\/\d+\//, `characterai.io/i/${size}/`);
}

/**
 * Pull character info from the chat intro block visible on every chat page:
 *
 *   <div class="flex flex-col items-center justify-center ...">
 *     <a href="/character/..."><span><img src=".../static/avatars/uploaded/..."/></span></a>
 *     <a href="/character/..."><p class="bold text-lg">Name</p></a>
 *     <div class="text-sm ..."><a href="/profile/user">By @user</a></div>
 *   </div>
 */
function fromChatIntroDom():
  | Pick<CharacterMeta, 'name' | 'creator' | 'avatarUrl'>
  | null {
  const introBlocks = Array.from(
    document.querySelectorAll<HTMLElement>(
      'div.flex.flex-col.items-center.justify-center'
    )
  );

  for (const block of introBlocks) {
    const nameEl = block.querySelector<HTMLElement>(
      'a[href^="/character/"] p.bold.text-lg'
    );
    const avatarEl = block.querySelector<HTMLImageElement>(
      'img[src*="/static/avatars/uploaded/"]'
    );
    const creatorEl = block.querySelector<HTMLAnchorElement>(
      'div.text-sm a[href^="/profile/"]'
    );

    if (!nameEl && !avatarEl && !creatorEl) continue;

    const name = safeText(nameEl);
    const avatarUrl = upscaleCaiAvatar(avatarEl?.src || '', 400);
    const creator = safeText(creatorEl);

    if (name || avatarUrl || creator) {
      return { name, creator, avatarUrl };
    }
  }
  return null;
}

export async function extractCharacterMetaCharacterAI(): Promise<CharacterMeta | null> {
  const dom = fromChatIntroDom();
  const nextData = readNextData();
  const char = nextData?.props?.pageProps?.character;

  const externalId = getCharacterIdFromUrl();
  const info = externalId
    ? await fetchCharacterInfoViaBackground(externalId)
    : null;

  // The DOM intro block is authoritative for what the user sees on screen
  // (name, avatar). The neo.character.ai API is authoritative for the rest.
  // __NEXT_DATA__ backfills when either is unavailable.
  const name = dom?.name || toStr(info?.name) || char?.name || '';
  const title = toStr(info?.title);
  const creator =
    toStr(info?.user__username) ||
    char?.user__username ||
    (dom?.creator || '').replace(/^By\s+@/i, '') ||
    '';
  const greeting = toStr(info?.greeting);
  const description =
    toStr(info?.description).trim() ||
    (char?.description && String(char.description).trim()) ||
    '';
  const hasDefinition = Boolean(info?.has_definition);
  const definition = hasDefinition ? toStr(info?.definition) : '';
  const upvotes = toFiniteNumber(info?.upvotes);
  const avatarUrl =
    dom?.avatarUrl ||
    (char?.avatar_file_name ? buildAvatarUrl(char.avatar_file_name) : '') ||
    (typeof info?.avatar_file_name === 'string'
      ? buildAvatarUrl(info.avatar_file_name as string)
      : '');

  if (!name && !avatarUrl) return null;

  const likes = readLikeCount();
  const interactions = toFiniteNumber(info?.participant__num_interactions);

  return {
    name,
    title,
    creator,
    description,
    greeting,
    definition,
    upvotes,
    avatarUrl,
    platform: 'character.ai',
    likes,
    interactions,
    info: stripPromotedFromInfo(info),
  };
}

/**
 * AI Dungeon exposes the adventure name in document.title (typically
 * "Adventure Name - AI Dungeon"). Fall back to the URL slug so even
 * unlabeled adventures get a sensible title.
 */
export function extractAdventureMetaAIDungeon(): AdventureMeta {
  const raw = document.title || '';
  let title = raw.replace(/\s*[-–—|]\s*AI Dungeon.*$/i, '').trim();

  if (!title || title.toLowerCase() === 'ai dungeon') {
    // URL pattern: /adventure/:id/:slug/play
    const m = window.location.pathname.match(
      /^\/adventure\/[^/]+\/([^/]+)\/play/
    );
    if (m) {
      title = decodeURIComponent(m[1]).replace(/-/g, ' ').trim();
    }
  }

  return {
    title: title || 'AI Dungeon Adventure',
    platform: 'AI Dungeon',
  };
}
