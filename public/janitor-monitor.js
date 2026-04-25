/**
 * Wilds AI — Janitor AI network monitor.
 *
 * Runs in the page's MAIN world (see manifest.json content_scripts entry with
 * `"world": "MAIN"`). Janitor's web app fetches chat data through the same
 * Cloudflare-protected origin that blocks anonymous requests, so we cannot
 * call those endpoints from the extension's isolated world. Instead we
 * passively monkey-patch `window.fetch` and forward parsed responses to the
 * isolated content script via `window.postMessage`.
 *
 * Captured endpoints:
 *  - GET  /hampter/chats/:id            — initial payload (character + chat + first message)
 *  - POST /hampter/chats/:id/messages   — incremental message updates
 *
 * The isolated content script also asks us to perform an active replay of
 * the GET when it has no cached data (e.g. user installed the extension
 * mid-session). Because we live in the page origin we have access to the
 * page's cookies and Cloudflare clearance.
 */
(function () {
  'use strict';

  if (window.__wildsJanitorMonitorInstalled) return;
  window.__wildsJanitorMonitorInstalled = true;

  var SOURCE_TAG = 'wilds-janitor-monitor';
  var GET_CHAT_RE = /\/hampter\/chats\/(\d+)(?:\?|$)/;
  var POST_MESSAGES_RE = /\/hampter\/chats\/(\d+)\/messages(?:\?|$)/;
  var HAMPTER_RE = /\/hampter\//;

  // Most recent Authorization header captured from a real Janitor request.
  // Janitor authenticates via a Supabase JWT in the Authorization header
  // (cookies alone return 401), so we reuse the page's own token for replays.
  var lastAuthorization = null;

  /**
   * Reconstruct a Bearer token from Supabase's split auth cookies.
   *
   * Supabase v2 stores the session as base64-encoded JSON across two cookies
   * (`sb-auth-auth-token.0` + `sb-auth-auth-token.1`) because the value is
   * too large for a single cookie. We concat, strip the `base64-` prefix,
   * decode, and pull `access_token`. Used as a fallback when we haven't
   * captured an Authorization header from a real request yet.
   */
  function readAuthFromCookies() {
    try {
      var pieces = ['', ''];
      var parts = document.cookie.split(/;\s*/);
      for (var i = 0; i < parts.length; i++) {
        var eq = parts[i].indexOf('=');
        if (eq < 0) continue;
        var name = parts[i].slice(0, eq);
        var value = parts[i].slice(eq + 1);
        if (name === 'sb-auth-auth-token.0') pieces[0] = value;
        else if (name === 'sb-auth-auth-token.1') pieces[1] = value;
      }
      if (!pieces[0]) return null;
      var raw = decodeURIComponent(pieces[0] + (pieces[1] || ''));
      if (raw.indexOf('base64-') === 0) raw = raw.slice('base64-'.length);
      var json;
      try {
        json = JSON.parse(atob(raw));
      } catch (_) {
        return null;
      }
      if (json && typeof json.access_token === 'string') {
        return 'Bearer ' + json.access_token;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Pull the Authorization header out of a fetch() call's input + init pair,
   * regardless of whether headers were passed as Headers / array / plain
   * object / via the Request object's own headers.
   */
  function readAuthHeader(input, init) {
    function fromMap(h) {
      if (!h) return null;
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        return h.get('authorization');
      }
      if (Array.isArray(h)) {
        for (var i = 0; i < h.length; i++) {
          if (String(h[i][0]).toLowerCase() === 'authorization') return h[i][1];
        }
        return null;
      }
      if (typeof h === 'object') {
        var keys = Object.keys(h);
        for (var k = 0; k < keys.length; k++) {
          if (keys[k].toLowerCase() === 'authorization') return h[keys[k]];
        }
      }
      return null;
    }
    var v = init ? fromMap(init.headers) : null;
    if (v) return v;
    if (typeof Request !== 'undefined' && input instanceof Request) {
      try {
        return input.headers.get('authorization');
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  /** Pull the chat id out of a URL, or null if it doesn't match. */
  function chatIdFromUrl(url) {
    if (typeof url !== 'string') return null;
    var m = url.match(POST_MESSAGES_RE) || url.match(GET_CHAT_RE);
    return m ? m[1] : null;
  }

  /**
   * Send a captured payload to the isolated content script. We tag with a
   * source string so the listener can ignore unrelated `message` events.
   */
  function emit(kind, chatId, data) {
    try {
      window.postMessage(
        { source: SOURCE_TAG, kind: kind, chatId: chatId, data: data },
        window.location.origin
      );
    } catch (_) {
      /* ignore */
    }
  }

  // --- fetch interception --------------------------------------------------

  var origFetch = window.fetch;
  window.fetch = function patchedFetch(input, init) {
    var url =
      typeof input === 'string'
        ? input
        : input && typeof input.url === 'string'
        ? input.url
        : '';
    var method = (init && init.method) || (input && input.method) || 'GET';
    method = String(method).toUpperCase();

    // Stash the auth token off any /hampter/* request, even ones we don't
    // otherwise care about — gives the cold-start replay a token to use.
    if (HAMPTER_RE.test(url)) {
      var tok = readAuthHeader(input, init);
      if (tok) lastAuthorization = tok;
    }

    var promise = origFetch.apply(this, arguments);

    var chatId = chatIdFromUrl(url);
    if (!chatId) return promise;

    promise
      .then(function (res) {
        if (!res || !res.ok) return;
        // Clone before reading so the original consumer's body is intact.
        var cloned = res.clone();
        return cloned.json().then(function (json) {
          if (POST_MESSAGES_RE.test(url)) {
            // Response is an array of new messages (could be 1 user msg or
            // 1 bot reply, depending on which leg of the round-trip).
            emit('messages', chatId, json);
          } else if (GET_CHAT_RE.test(url) && method === 'GET') {
            emit('chat', chatId, json);
          }
        });
      })
      .catch(function () {
        /* swallow — never break page-side fetch */
      });

    return promise;
  };

  // --- Active replay -------------------------------------------------------
  //
  // The isolated content script asks us to refetch /hampter/chats/:id when
  // its cache is empty. This is allowed because we run in the page origin
  // with full cookies and Cloudflare clearance.

  function activeReplay(chatId, requestId) {
    var url = '/hampter/chats/' + encodeURIComponent(chatId);
    var headers = { accept: 'application/json' };
    var auth = lastAuthorization || readAuthFromCookies();
    if (auth) headers.authorization = auth;
    origFetch
      .call(window, url, {
        method: 'GET',
        credentials: 'include',
        headers: headers,
      })
      .then(function (res) {
        if (!res.ok) throw new Error('replay status ' + res.status);
        return res.json();
      })
      .then(function (json) {
        emit('chat', chatId, json);
        window.postMessage(
          {
            source: SOURCE_TAG,
            kind: 'replay-result',
            chatId: chatId,
            requestId: requestId,
            ok: true,
          },
          window.location.origin
        );
      })
      .catch(function (err) {
        window.postMessage(
          {
            source: SOURCE_TAG,
            kind: 'replay-result',
            chatId: chatId,
            requestId: requestId,
            ok: false,
            error: String((err && err.message) || err),
          },
          window.location.origin
        );
      });
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var data = ev.data;
    if (!data || data.source !== SOURCE_TAG) return;
    if (data.kind === 'replay-request' && data.chatId) {
      activeReplay(String(data.chatId), data.requestId || '');
    }
  });
})();
