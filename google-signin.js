// google-signin.js — "Continue with Google" for the auth pages.
//
// A classic global <script>, not an ES module, for the same reason pw-toggle.js
// is: login.html is Vite-processed but signup.html is copied through verbatim
// (see scripts/copy-static.js), so an import from /src/ would 404 there in
// production. One global keeps both pages on one implementation instead of
// duplicating the flow into signup.html's inline script.
//
// Uses Google Identity Services' TOKEN client (google.accounts.oauth2), NOT the
// familiar one-tap "Sign in with Google" button (google.accounts.id). That's a
// deliberate match to the server: POST /api/google verifies an OAuth *access
// token* against Google's tokeninfo endpoint and reads the email back from
// userinfo. google.accounts.id returns an ID token (a signed JWT) instead, which
// that endpoint rejects — same Google project, different kind of credential.
//
// Whether the button exists is the server's call: GET /api/auth/config returns
// the configured client id or null, so a deployment without Google set up simply
// doesn't offer it rather than offering it and failing at the last step.
'use strict';

(function () {
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  // The server reads only email + email_verified, so that's all we request.
  // Asking for profile scope we never use would show a broader consent prompt
  // than the app actually needs.
  const SCOPES = 'openid email';

  let gisPromise = null;

  function loadGis() {
    if (gisPromise) return gisPromise;
    gisPromise = new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        return resolve(window.google);
      }
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = function () {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) resolve(window.google);
        else reject(new Error('Google sign-in loaded but is unavailable.'));
      };
      // Ad and tracker blockers routinely block this script. That's a normal
      // state, not a crash: the button just never mounts and password login is
      // completely unaffected.
      s.onerror = function () { reject(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  // Inline SVG rather than a hosted image: Google's branding requires the
  // four-colour mark, and an <img> from their CDN is one more thing a blocker
  // can break, leaving a button with a hole in it.
  function googleMark() {
    return '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
      + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
      + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
      + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
      + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
      + '</svg>';
  }

  // Asks a first-time Google user to choose their username, rather than the
  // server deriving one from their email address behind their back. Resolves to
  // the chosen name, or null if they back out.
  //
  // `error` re-renders the same panel with a message against the field, so a
  // taken or malformed name is corrected in place instead of restarting the
  // whole Google round trip.
  window.promptGoogleUsername = function promptGoogleUsername(opts) {
    const o = opts || {};
    return new Promise(function (resolve) {
      const overlay = document.createElement('div');
      overlay.className = 'gsu-overlay';
      overlay.innerHTML = ''
        + '<div class="gsu-card" role="dialog" aria-modal="true" aria-labelledby="gsuTitle">'
        + '  <div class="gsu-title" id="gsuTitle">Pick your username</div>'
        + '  <div class="gsu-sub">Signed in as ' + escapeHtml(o.email || 'your Google account')
        + '. This is how you\'ll appear to your partner — you can\'t change it later.</div>'
        + '  <input type="text" class="gsu-input" id="gsuInput" autocomplete="username"'
        + '         maxlength="32" autocapitalize="none" spellcheck="false" placeholder="pick a username">'
        + '  <div class="gsu-hint" id="gsuHint">3–32 characters — lowercase letters, numbers and underscores.</div>'
        + '  <button class="btn btn-primary gsu-go" id="gsuGo">Create my account</button>'
        + '  <button class="gsu-cancel" id="gsuCancel">Cancel</button>'
        + '</div>';
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#gsuInput');
      const hint = overlay.querySelector('#gsuHint');
      const go = overlay.querySelector('#gsuGo');

      if (o.error) { hint.textContent = o.error; hint.className = 'gsu-hint bad'; }
      input.value = o.suggested || '';
      setTimeout(function () { input.focus(); input.select(); }, 30);

      const done = function (value) {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const submit = function () {
        const v = input.value.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,32}$/.test(v)) {
          hint.textContent = '3–32 characters: lowercase letters, numbers and underscores.';
          hint.className = 'gsu-hint bad';
          input.focus();
          return;
        }
        go.disabled = true;
        go.textContent = 'Creating…';
        done(v);
      };
      const onKey = function (e) {
        if (e.key === 'Escape') done(null);
        if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); submit(); }
      };

      go.addEventListener('click', submit);
      overlay.querySelector('#gsuCancel').addEventListener('click', function () { done(null); });
      document.addEventListener('keydown', onKey);
    });
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Drives the whole "sign in with Google" outcome, including the first-time
  // username step, so login.html and signup.html don't each reimplement the
  // retry loop. `submit(token, username)` is the page's call to the API.
  window.completeGoogleSignIn = async function completeGoogleSignIn(accessToken, submit) {
    let data = await submit(accessToken, undefined);
    let error = '';
    let suggested = data && data.suggestedUsername;
    while (data && data.needsUsername) {
      const chosen = await window.promptGoogleUsername({
        email: data.email, suggested: suggested, error: error,
      });
      if (!chosen) return null;             // backed out
      suggested = chosen;
      data = await submit(accessToken, chosen);
      error = data && data.needsUsername ? (data.error || 'Try another username.') : '';
    }
    return data;
  };

  // mountGoogleButton(mountEl, { onToken, label }) -> Promise<boolean>
  // Resolves true only when the button was actually mounted, so the caller knows
  // whether to reveal its "or" divider.
  window.mountGoogleButton = async function mountGoogleButton(mountEl, opts) {
    const options = opts || {};
    const label = options.label || 'Continue with Google';
    if (!mountEl || typeof options.onToken !== 'function') return false;

    const base = (window.getSavedServerUrl ? window.getSavedServerUrl() : '').replace(/\/+$/, '');
    let clientId = null;
    try {
      const res = await fetch(base + '/api/auth/config');
      if (!res.ok) return false;
      const cfg = await res.json();
      clientId = cfg && cfg.googleClientId;
    } catch (e) {
      return false;   // server unreachable — password login still works
    }
    if (!clientId) return false;

    try { await loadGis(); } catch (e) { return false; }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-google';
    btn.innerHTML = googleMark() + '<span>' + label + '</span>';
    mountEl.appendChild(btn);

    const reset = function () {
      btn.disabled = false;
      btn.querySelector('span').textContent = label;
    };

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: async function (resp) {
        reset();
        // No token means the consent window was closed or declined. That's a
        // choice, not an error — say nothing and let them try again.
        if (!resp || !resp.access_token) return;
        await options.onToken(resp.access_token);
      },
      error_callback: reset,
    });

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.querySelector('span').textContent = 'Waiting for Google…';
      client.requestAccessToken();
    });

    return true;
  };
}());
