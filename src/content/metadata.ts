/**
 * Platform-specific metadata extraction.
 *
 * Responsible for turning live DOM + backend APIs into the normalized
 * `CharacterMeta` / `AdventureMeta` shapes consumed by the exporter (JSON
 * download + PNG story cards).
 *
 * Extraction strategy is two-tier:
 *  - **character.ai**: Reads the chat intro block for name/avatar (what the
 *    user actually sees) and calls the `get_character_info` API for
 *    authoritative description/greeting/definition/upvotes/interactions.
 *    The Like count is read from the DOM because it isn't exposed in the API.
 *  - **AI Dungeon**: Hits the GraphQL `GetGameplayAdventure` query for the
 *    full adventure (actions, memory, story cards, tags, author). DOM
 *    fallback via `extractAdventureMetaAIDungeon` handles logged-out users.
 *
 * Cross-origin fetches go through the background service worker — see
 * `src/background/index.ts`.
 */

/**
 * Normalized character metadata produced for character.ai exports.
 *
 * Fields at the top level are stable (promoted from the raw API); everything
 * else from `get_character_info` lives under `info` so JSON consumers can
 * still reach platform-specific data without polluting the root object.
 */
export interface CharacterMeta {
  /** Display name. */
  name: string;
  /** Character title/tagline shown below the name. */
  title: string;
  /** Creator's raw username (no "By @" prefix), e.g. "bignoodle". */
  creator: string;
  /** Long-form character description. */
  description: string;
  /** Opening line spoken by the character. */
  greeting: string;
  /** Creator-authored persona/definition. Empty unless `info.has_definition` is true. */
  definition: string;
  /** Number of upvotes reported by the API. */
  upvotes: number;
  /** Full-size avatar URL (upscaled where possible). */
  avatarUrl: string;
  /** Always "character.ai" for this shape. */
  platform: string;
  /** Likes count parsed from the Like button (supports "1.7k", "7.3M"). */
  likes: number;
  /** Cumulative interaction count from the API. */
  interactions: number;
  /** Remaining API fields minus those promoted above. */
  info: Record<string, unknown> | null;
}

/** One AI Dungeon story card (world info / character / custom entry). */
export interface AdventureStoryCard {
  id: string;
  type: string;
  title: string;
  /** Comma-separated trigger keys. */
  keys: string;
  /** Card body text injected into context when the keys match. */
  value: string;
  description: string;
  /** Whether the author marked this card as part of character creation. */
  useForCharacterCreation: boolean;
}

/**
 * Normalized AI Dungeon adventure metadata.
 *
 * Built from either the GraphQL `adventure` payload (preferred) or a DOM
 * fallback that only fills `title`.
 */
export interface AdventureMeta {
  title: string;
  /** Always "AI Dungeon" for this shape. */
  platform: string;
  description: string;
  /** Cover image URL. */
  image: string;
  /** Persistent memory string prepended to every prompt. */
  memory: string;
  /** Author's note string appended to every prompt. */
  authorsNote: string;
  /** Creator's display name (profile title or first player's username). */
  author: string;
  /** Creator's thumbnail URL, if available. */
  authorAvatar: string;
  /** Player's in-game character name. */
  characterName: string;
  tags: string[];
  storyCards: AdventureStoryCard[];
  /** Remaining GraphQL fields minus those promoted above. */
  info: Record<string, unknown> | null;
}

/** One rendered message/action in an AI Dungeon adventure. */
export interface AdventureMessage {
  id?: string;
  /** "You" for user actions, "Story/AI" for AI continuations. */
  name: string;
  /** "user" | "character". */
  role: string;
  text: string;
  /** Raw AI Dungeon action type: "start" | "continue" | "do" | "say" | "story". */
  type?: string;
  createdAt?: string;
}

/** The combined output of a GraphQL-based AI Dungeon extraction. */
export interface AIDungeonAdventure {
  meta: AdventureMeta;
  messages: AdventureMessage[];
}

/** Return an element's trimmed `textContent`, or `''` if the element is missing. */
function safeText(el: Element | null | undefined): string {
  return (el?.textContent || '').trim();
}

/**
 * Parse the `__NEXT_DATA__` JSON blob that Next.js embeds on every page.
 *
 * character.ai is a Next.js app, so most initial props (including the full
 * character object) are available here without an extra network call. We use
 * it as a secondary source when the DOM or API can't produce a field.
 */
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

/** Coerce an unknown value to a finite number, defaulting to 0. */
function toFiniteNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/** Coerce an unknown value to a string, defaulting to ''. */
function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Keys from the `get_character_info` response that we promote to the top
 * level of `CharacterMeta`. Anything not in this set stays under `info` so
 * JSON consumers can still reach it without polluting the root object.
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

/** Return a shallow copy of `info` with promoted keys removed. */
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

/**
 * Construct a full avatar URL from the `avatar_file_name` stored in the API
 * payload. character.ai serves avatars from `/i/<size>/static/avatars/...`;
 * we request 400px which is large enough for the profile card.
 */
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

/**
 * Build a `CharacterMeta` for the currently-open character.ai chat page.
 *
 * Merges three data sources with the following precedence per field:
 *  - DOM intro block: name, avatar (matches what the user sees).
 *  - `get_character_info` API: everything else (title, description, greeting,
 *    definition, upvotes, interactions).
 *  - `__NEXT_DATA__` blob: fallback when the above are empty.
 *
 * Returns `null` if neither a name nor an avatar can be determined — that
 * usually means we're on a page that isn't actually a chat view.
 */
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

/** Create an empty `AdventureMeta` shell with just a title populated. */
function emptyAdventureMeta(title: string): AdventureMeta {
  return {
    title,
    platform: 'AI Dungeon',
    description: '',
    image: '',
    memory: '',
    authorsNote: '',
    author: '',
    authorAvatar: '',
    characterName: '',
    tags: [],
    storyCards: [],
    info: null,
  };
}

/**
 * AI Dungeon exposes the adventure name in document.title (typically
 * "Adventure Name - AI Dungeon"). Fall back to the URL slug so even
 * unlabeled adventures get a sensible title. Used only as fallback when
 * the GraphQL API isn't reachable (e.g. user is logged out).
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

  return emptyAdventureMeta(title || 'AI Dungeon Adventure');
}

/**
 * AI Dungeon URLs follow /adventure/:shortId/:slug/play.
 */
function getAIDungeonShortId(): string | null {
  const m = window.location.pathname.match(/^\/adventure\/([^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * The AI Dungeon web app stores its Firebase session in localStorage under
 * `auth_state_production`. Its `accessToken` field already includes the
 * "firebase " scheme prefix and is passed through verbatim as the
 * Authorization header.
 */
function getAIDungeonAccessToken(): string | null {
  try {
    const raw = window.localStorage.getItem('auth_state_production');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = typeof parsed?.accessToken === 'string' ? parsed.accessToken : '';
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Dispatch the GraphQL adventure fetch to the background service worker.
 *
 * The service worker has `host_permissions` for api.aidungeon.com; calling
 * `fetch` directly from the content script would fail CORS preflight on a
 * non-aidungeon page. Returns the `adventure` object or null on any failure.
 */
function fetchAdventureViaBackground(
  shortId: string,
  accessToken: string
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { action: 'FETCH_AIDUNGEON_ADVENTURE', shortId, accessToken },
        (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            resolve(null);
            return;
          }
          const adv = response.data;
          resolve(adv && typeof adv === 'object' ? adv : null);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Keys from the GraphQL `adventure` payload that we promote to the top level
 * of `AdventureMeta`. `actionWindow` isn't promoted to `AdventureMeta` (it
 * becomes `messages`), but we still strip it from `info` to avoid duplicating
 * the full action history in the JSON export.
 */
const PROMOTED_ADVENTURE_FIELDS = new Set([
  'title',
  'description',
  'image',
  'memory',
  'authorsNote',
  'tags',
  'storyCards',
  'actionWindow',
]);

/** Return a shallow copy of the adventure object with promoted keys removed. */
function stripPromotedFromAdventure(
  adv: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!adv) return null;
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(adv)) {
    if (!PROMOTED_ADVENTURE_FIELDS.has(k)) rest[k] = v;
  }
  return rest;
}

/** Normalize the GraphQL `storyCards` array into our simpler shape. */
function buildAdventureStoryCards(adv: any): AdventureStoryCard[] {
  const cards = Array.isArray(adv?.storyCards) ? adv.storyCards : [];
  return cards.map((c: any) => ({
    id: toStr(c?.id),
    type: toStr(c?.type),
    title: toStr(c?.title),
    keys: toStr(c?.keys),
    value: toStr(c?.value),
    description: toStr(c?.description),
    useForCharacterCreation: Boolean(c?.useForCharacterCreation),
  }));
}

/**
 * Map a raw GraphQL `adventure` object into our `AdventureMeta` shape.
 *
 * Author lookup falls back through a chain: `user.profile.title` is the
 * displayed creator for published scenarios; `allPlayers[0].user.username` is
 * used for private adventures where the profile block is absent.
 */
function buildAdventureMetaFromApi(adv: any): AdventureMeta {
  const creatorUsername =
    toStr(adv?.user?.profile?.title) ||
    toStr(adv?.allPlayers?.[0]?.user?.username) ||
    '';
  const creatorAvatar =
    toStr(adv?.user?.profile?.thumbImageUrl) ||
    toStr(adv?.allPlayers?.[0]?.user?.profile?.thumbImageUrl);
  const tags = Array.isArray(adv?.tags)
    ? adv.tags.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
    : [];

  return {
    title: toStr(adv?.title) || 'AI Dungeon Adventure',
    platform: 'AI Dungeon',
    description: toStr(adv?.description),
    image: toStr(adv?.image),
    memory: toStr(adv?.memory),
    authorsNote: toStr(adv?.authorsNote),
    author: creatorUsername,
    authorAvatar: creatorAvatar,
    characterName: toStr(adv?.allPlayers?.[0]?.characterName),
    tags,
    storyCards: buildAdventureStoryCards(adv),
    info: stripPromotedFromAdventure(adv),
  };
}

/**
 * Turn the GraphQL `actionWindow` array into a flat, chronologically-ordered
 * message list.
 *
 * The request asks for `desc: true`, so we re-sort ascending by numeric id
 * (falling back to `createdAt` if ids aren't parseable). Actions that were
 * undone or deleted are dropped — they shouldn't appear in the exported
 * transcript. Action `type` determines role:
 *  - `do` / `say` / `story` → user input
 *  - `start` / `continue`   → AI-generated narration
 */
function buildAdventureMessagesFromApi(adv: any): AdventureMessage[] {
  const actions = Array.isArray(adv?.actionWindow) ? adv.actionWindow : [];
  const sorted = [...actions].sort((a: any, b: any) => {
    const ai = Number(a?.id);
    const bi = Number(b?.id);
    if (isFinite(ai) && isFinite(bi) && ai !== bi) return ai - bi;
    const at = String(a?.createdAt || '');
    const bt = String(b?.createdAt || '');
    return at.localeCompare(bt);
  });

  const out: AdventureMessage[] = [];
  for (const a of sorted) {
    if (a?.undoneAt || a?.deletedAt) continue;
    const text = typeof a?.text === 'string' ? a.text : '';
    if (!text.trim()) continue;
    const type = toStr(a?.type);
    const isUser = type === 'do' || type === 'say' || type === 'story';
    out.push({
      id: toStr(a?.id),
      name: isUser ? 'You' : 'Story/AI',
      role: isUser ? 'user' : 'character',
      text,
      type,
      createdAt: toStr(a?.createdAt),
    });
  }
  return out;
}

/**
 * Pull the full adventure via the AI Dungeon GraphQL API. Returns null when
 * the page URL doesn't match an adventure, when no access token is present
 * in localStorage, or when the request fails — callers should fall back to
 * the DOM-based extractors in that case.
 */
export async function extractAIDungeonAdventure(): Promise<AIDungeonAdventure | null> {
  const shortId = getAIDungeonShortId();
  const token = getAIDungeonAccessToken();
  if (!shortId || !token) return null;

  const adv = await fetchAdventureViaBackground(shortId, token);
  if (!adv) return null;

  return {
    meta: buildAdventureMetaFromApi(adv),
    messages: buildAdventureMessagesFromApi(adv),
  };
}
