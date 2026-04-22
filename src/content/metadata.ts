/**
 * Character metadata extraction for supported platforms.
 */

export interface CharacterMeta {
  name: string;
  creator: string; // e.g. "By @bignoodle"
  description: string;
  avatarUrl: string;
  platform: string;
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

export function extractCharacterMetaCharacterAI(): CharacterMeta | null {
  const dom = fromChatIntroDom();
  const nextData = readNextData();
  const char = nextData?.props?.pageProps?.character;

  // The DOM intro block is authoritative for what the user sees on screen
  // (name, creator, avatar). __NEXT_DATA__ fills in description + avatar
  // file name when the DOM didn't expose them.
  const name = dom?.name || char?.name || '';
  const creator =
    dom?.creator ||
    (char?.user__username ? `By @${char.user__username}` : '');
  const avatarUrl =
    dom?.avatarUrl ||
    (char?.avatar_file_name ? buildAvatarUrl(char.avatar_file_name) : '');
  const description =
    (char?.description && String(char.description).trim()) ||
    (char?.title && String(char.title).trim()) ||
    '';

  if (!name && !avatarUrl) return null;

  return {
    name,
    creator,
    description,
    avatarUrl,
    platform: 'character.ai',
  };
}
