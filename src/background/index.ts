/**
 * Background service worker for Wilds AI Exporter.
 *
 * Its primary job is to act as a privileged fetch proxy for the content script.
 * Content scripts run in the page's origin and are subject to CORS, while the
 * service worker runs in the extension's origin and can make cross-origin
 * requests to any host listed under `host_permissions` in the manifest.
 *
 * It also owns the `chrome.downloads` API (which is unavailable to content
 * scripts) and is used to trigger file downloads with a "Save As…" dialog.
 *
 * Message protocol (all sent via `chrome.runtime.sendMessage`):
 *  - `FETCH_IMAGE`               — cross-origin image → data URL.
 *  - `FETCH_CHARACTER_INFO`      — character.ai `get_character_info` API call.
 *  - `FETCH_AIDUNGEON_ADVENTURE` — AI Dungeon GraphQL adventure fetch.
 *  - `FETCH_CHAI_CONVERSATION`   — Chai AI conversation fetch (Bearer auth).
 *  - `DOWNLOAD_DATA`             — serialize JSON and trigger a file download.
 *
 * Every handler replies with `{ success: true, ... }` or `{ success: false, error }`.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Wilds AI Exporter: Extension installed');
});

/**
 * Read a `Blob` as a `data:` URL.
 *
 * Used both to embed images inline into exported cards (so html2canvas doesn't
 * have to re-fetch them under CORS) and to produce a downloadable URL for
 * `chrome.downloads.download`, which doesn't accept a raw `Blob`.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch an image URL and return it as a data URL.
 *
 * `credentials: 'omit'` avoids sending cookies to third-party CDNs — not
 * strictly required, but keeps the request anonymous and cache-friendly.
 */
async function fetchImageAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const blob = await res.blob();
  return blobToDataUrl(blob);
}

/**
 * Call character.ai's `get_character_info` API for a given character.
 *
 * Returns the raw JSON so the content script can decide which fields to
 * promote and which to stash under `info`. No auth header is needed — the
 * endpoint is public for listed characters.
 *
 * @param externalId - The character's public ID, extracted from `/chat/:id`.
 */
async function fetchCharacterInfo(externalId: string): Promise<any> {
  const res = await fetch(
    'https://neo.character.ai/character/v1/get_character_info',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ external_id: externalId, lang: 'en' }),
    }
  );
  if (!res.ok) throw new Error(`get_character_info -> ${res.status}`);
  return res.json();
}

/**
 * GraphQL query used by AI Dungeon's web client to load an adventure.
 *
 * Kept verbatim from the live request so we get the full adventure payload
 * (title, description, memory, story cards, action history, players, etc.)
 * in a single round trip. Changing this string means re-testing against the
 * live API; fragments are inlined to keep the request self-contained.
 */
const GET_GAMEPLAY_ADVENTURE_QUERY = `query GetGameplayAdventure($shortId: String, $limit: Int, $offset: Int, $desc: Boolean) {
  adventure(shortId: $shortId) {
    id
    publicId
    shortId
    scenarioId
    instructions
    title
    description
    tags
    nsfw
    isOwner
    userJoined
    gameState
    state {
      adventureId
      type
      memories {
        actionIds
        text
        lastRelevantActionId
        __typename
      }
      instructions
      storySummary
      lastSummarizedActionId
      lastMemoryActionId
      storyCards {
        id
        updatedAt
        keys
        value
        type
        title
        description
        useForCharacterCreation
        __typename
      }
      storyCardInstructions
      storyCardStoryInformation
      __typename
    }
    actionCount
    contentType
    createdAt
    showComments
    commentCount
    allowComments
    voteCount
    editedAt
    published
    unlisted
    deletedAt
    saveCount
    contentResponses {
      userVote
      isSaved
      isDisliked
      __typename
    }
    user {
      id
      isCurrentUser
      isMember
      profile {
        id
        title
        thumbImageUrl
        __typename
      }
      __typename
    }
    shortCode
    thirdPerson
    imageStyle
    memory
    authorsNote
    image
    uploadId
    contentRating
    actionWindow(limit: $limit, offset: $offset, desc: $desc) {
      id
      imageText
      ...ActionSubscriptionAction
      __typename
    }
    allPlayers {
      ...PlayerSubscriptionPlayer
      __typename
    }
    storyCards {
      id
      ...StoryCard
      __typename
    }
    __typename
  }
}

fragment ActionSubscriptionAction on Action {
  id
  userId
  text
  type
  imageUrl
  shareUrl
  imageText
  adventureId
  decisionId
  undoneAt
  deletedAt
  createdAt
  updatedAt
  logId
  __typename
}

fragment PlayerSubscriptionPlayer on Player {
  id
  userId
  characterName
  isTypingAt
  user {
    id
    username
    isMember
    profile {
      id
      title
      thumbImageUrl
      __typename
    }
    __typename
  }
  createdAt
  deletedAt
  blockedAt
  __typename
}

fragment StoryCard on StoryCard {
  id
  type
  keys
  value
  title
  useForCharacterCreation
  description
  updatedAt
  deletedAt
  __typename
}`;

/**
 * POST the `GetGameplayAdventure` query to AI Dungeon's GraphQL endpoint.
 *
 * The real client batches operations, so the request body is an array of one.
 * The `accessToken` is the Firebase JWT read from page localStorage and
 * already includes the `"firebase "` scheme prefix — don't prepend "Bearer".
 *
 * @returns The `adventure` object, or `null` if the response shape is empty.
 */
async function fetchAIDungeonAdventure(
  shortId: string,
  accessToken: string
): Promise<any> {
  const res = await fetch('https://api.aidungeon.com/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: accessToken,
    },
    body: JSON.stringify([
      {
        operationName: 'GetGameplayAdventure',
        variables: { shortId, limit: 100, desc: true },
        query: GET_GAMEPLAY_ADVENTURE_QUERY,
      },
    ]),
  });
  if (!res.ok) throw new Error(`GetGameplayAdventure -> ${res.status}`);
  const json = await res.json();
  // Response is a batched array of one — unwrap the first entry.
  const first = Array.isArray(json) ? json[0] : json;
  return first?.data?.adventure ?? null;
}

/**
 * GET a Chai AI conversation by id.
 *
 * Auth is a short-lived Firebase JWT read from page IndexedDB by the content
 * script and forwarded here as the bare token (no scheme prefix). We add the
 * `Bearer ` prefix on the wire ourselves to match what Chai's web client
 * sends. `credentials: 'omit'` keeps the request anonymous beyond the bearer
 * token — Chai's API authenticates via the header, not cookies.
 */
async function fetchChaiConversation(
  conversationId: string,
  accessToken: string
): Promise<any> {
  const url = `https://www.chai-ai.com/api/conversations/${encodeURIComponent(
    conversationId
  )}`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new Error(`chai conversation -> ${res.status}`);
  return res.json();
}

/**
 * Main message dispatcher.
 *
 * Each handler returns `true` to tell Chrome the reply will be sent
 * asynchronously via `sendResponse`. Forgetting the `return true` causes the
 * message channel to close before `.then(sendResponse)` runs, and the caller
 * gets an `undefined` response.
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action === 'FETCH_IMAGE' && typeof request.url === 'string') {
    fetchImageAsDataUrl(request.url)
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((err) =>
        sendResponse({ success: false, error: String(err?.message || err) })
      );
    return true; // async response
  }

  if (
    request?.action === 'FETCH_CHARACTER_INFO' &&
    typeof request.externalId === 'string'
  ) {
    fetchCharacterInfo(request.externalId)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) =>
        sendResponse({ success: false, error: String(err?.message || err) })
      );
    return true; // async response
  }

  if (
    request?.action === 'FETCH_AIDUNGEON_ADVENTURE' &&
    typeof request.shortId === 'string' &&
    typeof request.accessToken === 'string'
  ) {
    fetchAIDungeonAdventure(request.shortId, request.accessToken)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) =>
        sendResponse({ success: false, error: String(err?.message || err) })
      );
    return true; // async response
  }

  if (
    request?.action === 'FETCH_CHAI_CONVERSATION' &&
    typeof request.conversationId === 'string' &&
    typeof request.accessToken === 'string'
  ) {
    fetchChaiConversation(request.conversationId, request.accessToken)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) =>
        sendResponse({ success: false, error: String(err?.message || err) })
      );
    return true; // async response
  }

  if (request?.action === 'DOWNLOAD_DATA') {
    const { data, filename } = request as { data: unknown; filename: string };
    // Pretty-printed JSON so the downloaded file is human-readable.
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    // chrome.downloads.download needs a URL — convert the blob to a data URL
    // rather than a blob URL so the download survives service-worker suspension.
    blobToDataUrl(blob).then((dataUrl) => {
      chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
      sendResponse({ success: true });
    });
    return true;
  }

  return false;
});
