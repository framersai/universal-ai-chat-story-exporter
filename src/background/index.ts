/**
 * Background Service Worker
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Wilds AI Exporter: Extension installed');
});

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const blob = await res.blob();
  return blobToDataUrl(blob);
}

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
  // Response is a batched array of one — return the adventure object.
  const first = Array.isArray(json) ? json[0] : json;
  return first?.data?.adventure ?? null;
}

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

  if (request?.action === 'DOWNLOAD_DATA') {
    const { data, filename } = request as { data: unknown; filename: string };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    blobToDataUrl(blob).then((dataUrl) => {
      chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
      sendResponse({ success: true });
    });
    return true;
  }

  return false;
});
