// planNext.js — "Plan your next movie night" (server/src/night-plans.js; docs/autonomous-ops/PMF.md 2026-10-03).
//
// The funnel's biggest leak is the second night: of 12 accounts that had a night, 2 came back. One tap here puts the
// next night on both partners' calendars (a .ics in each inbox, shown in each person's own time zone) and both get a
// reminder an hour before. Shown at the end of a night (review page) and from the "movie night #2?" email (?plan=1).
// Habit plan 1 (11-10): 0 of 10 one-sided plans were kept, so a plan is a suggestion until the partner says "I'm in"
// (here, or from the bell / the extension). The calendar and the reminder come with that yes. Plus the pair's nights
// together and weeks in a row (habit plan 3): a count that only goes up, never loss copy.
'use strict';

import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/util.js';

const { apiRequest } = window;

function at(dayOffset, hour, minute) {
  const d = new Date(); d.setSeconds(0, 0);
  d.setDate(d.getDate() + dayOffset); d.setHours(hour, minute, 0, 0);
  return d;
}
const fmt = (d) => d.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// "Same time" = the clock time this night started (or now, rounded to the next half hour).
function sameTime(startedAt) {
  const s = startedAt ? new Date(startedAt) : new Date(Date.now() + 30 * 60e3);
  const m = s.getMinutes() < 15 ? 0 : s.getMinutes() < 45 ? 30 : 60;
  return { h: s.getHours() + (m === 60 ? 1 : 0), m: m === 60 ? 0 : m };
}

export async function mountPlanNext(anchor, { partner, startedAt, via = 'review', shareLink = '', session = '' } = {}) {
  if (!anchor || !partner || !apiRequest) return null;
  const card = document.createElement('div');
  card.className = 'plan-next';
  anchor.after(card);

  let existing = null; let stats = {};
  try {
    stats = await apiRequest(`/api/night-plans/next?partner=${encodeURIComponent(partner)}${session ? `&session=${encodeURIComponent(session)}` : ''}`) || {};
    existing = stats.plan;
  } catch (e) { /* show the planner */ }
  const n = stats.night || stats.nights || 0;
  const countLine = n ? `<div class="plan-next-count">${stats.night ? `Night ${n} together` : `${n} night${n === 1 ? '' : 's'} together`}${stats.weeks >= 2 ? ` · ${stats.weeks} weeks in a row` : ''} 💜</div>` : '';

  // Before a first night (via 'first', from the first-night card): no "same time" to repeat yet, so offer tonight
  // (or tomorrow, once it's late) at 9 pm and the coming Saturday at 8 pm — "we haven't had a free evening" was a
  // top answer (CUSTOMER_TALKS.md); picking the evening in advance is the fix.
  const first = via === 'first';
  const { h, m } = sameTime(startedAt);
  const sat = (6 - new Date().getDay() + 7) % 7 || 7;
  const options = first
    ? [
      new Date().getHours() < 20 ? { label: 'Tonight', when: at(0, 21, 0) } : { label: 'Tomorrow night', when: at(1, 21, 0) },
      { label: 'This Saturday', when: at(sat, 20, 0) },
    ]
    : [
      // Returners come back after ~2 days (HABIT-PLAN.md); "tomorrow" was never kept.
      { label: 'Same time in 2 days', when: at(2, h, m) },
      { label: 'Same night next week', when: at(7, h, m) },
    ];
  const which = first ? 'first' : 'next';

  // Habit plan 2: "Next up" — the film for the planned night, or whose turn it is to pick it (whoever didn't start the
  // last night together, stats.picker). Either of the two can set it; the start page and the emails show it.
  let film = (existing && existing.film) || ''; let filmBy = existing && existing.film_by;
  function nextUpHtml() {
    if (film) return `<div class="plan-next-film">Next up: <b>${escapeHtml(film)}</b>${filmBy === partner ? ` · picked by ${escapeHtml(partner)}` : ''} <button type="button" class="plan-next-film-edit">Change film</button></div>`;
    const turn = stats.picker === partner ? `${escapeHtml(partner)} is picking the film` : stats.picker ? 'Your turn to pick the film' : 'Pick the film';
    return `<form class="plan-next-film plan-next-film-form"><label>${turn}<input type="text" maxlength="120" class="plan-next-film-input" placeholder="Film title"></label><button type="submit" class="btn btn-ghost">Save</button></form>`;
  }
  function bindNextUp(id, rerender) {
    const edit = card.querySelector('.plan-next-film-edit');
    if (edit) edit.addEventListener('click', () => { film = ''; rerender(); });
    const form = card.querySelector('.plan-next-film-form');
    if (!form || !id) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = form.querySelector('input').value.trim(); if (!v) return;
      try { const r = await apiRequest(`/api/night-plans/${encodeURIComponent(id)}/film`, { method: 'POST', body: JSON.stringify({ film: v }) }); film = r.film || v; filmBy = null; rerender(); }
      catch (err) { form.querySelector('label').append(` — ${(err && err.message) || 'could not save'}`); }
    });
  }

  // The plan's state decides the card: theirs and waiting for me → "I'm in / Another time"; mine and waiting → "we asked";
  // both in → the calendar line. reachable=false: a guest (no account to tell) or someone with Herae's emails off — say so,
  // and hand the planner a one-tap way to tell them, instead of promising an ask that never arrives (2026-10-04).
  function renderPlanned(when, { confirmed = false, theirs = false, id = null, reachable = true } = {}) {
    const shareText = `Movie night ${fmt(when)} (my time)?${shareLink ? ` Open this on your computer in Chrome when it's time: ${shareLink}` : ''}`;
    if (theirs && !confirmed) {
      card.innerHTML = `${countLine}
        <div class="plan-next-title">${icon('calendar', 18)} ${escapeHtml(partner)} suggests a movie night: ${escapeHtml(fmt(when))}</div>
        <div class="plan-next-sub">Say you're in and it goes on both your calendars, with a reminder an hour before.</div>
        <div class="plan-next-row">
          <button type="button" class="btn btn-primary plan-next-yes">I'm in</button>
          <button type="button" class="btn btn-ghost plan-next-no">Another time</button>
        </div>
        ${film ? nextUpHtml() : ''}
        <div class="plan-next-msg" aria-live="polite"></div>`;
      const msg = card.querySelector('.plan-next-msg');
      const answer = async (yes, btn) => {
        btn.disabled = true; msg.textContent = 'Saving…';
        try {
          await apiRequest(`/api/night-plans/${encodeURIComponent(id)}/${yes ? 'confirm' : 'decline'}`, { method: 'POST' });
          if (yes) renderPlanned(when, { confirmed: true, id }); else renderPicker();
        } catch (e) { btn.disabled = false; msg.textContent = (e && e.message) || 'Could not save it. Try again.'; }
      };
      card.querySelector('.plan-next-yes').addEventListener('click', (e) => answer(true, e.currentTarget));
      card.querySelector('.plan-next-no').addEventListener('click', (e) => answer(false, e.currentTarget));
      return;
    }
    card.innerHTML = `${countLine}
      <div class="plan-next-title">${icon('calendar', 18)} ${confirmed ? `${escapeHtml(fmt(when))} · you're both in` : `${first ? 'First' : 'Next'} movie night: ${escapeHtml(fmt(when))}`}</div>
      <div class="plan-next-sub">${confirmed
    ? "It's on both your calendars, in each of your own time zones, with a reminder an hour before."
    : reachable
      ? `We asked ${escapeHtml(partner)}. Once they're in, it goes on both your calendars with a reminder an hour before.`
      : `${escapeHtml(partner)} doesn't get Herae notifications yet, so send them the time:`}</div>
      ${reachable || confirmed ? '' : `<div class="plan-next-row plan-next-tell">
        <a class="btn btn-gold" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener">Send on WhatsApp</a>
        <button type="button" class="btn btn-ghost plan-next-copy">Copy message</button>
      </div>`}
      ${id ? nextUpHtml() : ''}
      <button type="button" class="btn btn-ghost plan-next-change">Change</button>`;
    bindNextUp(id, () => renderPlanned(when, { confirmed, theirs, id, reachable }));
    const copy = card.querySelector('.plan-next-copy');
    if (copy) {
      copy.addEventListener('click', async () => {
        let ok = false;
        try { await navigator.clipboard.writeText(shareText); ok = true; } catch (e) { /* insecure context */ }
        copy.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => { copy.textContent = 'Copy message'; }, 1800);
      });
    }
    card.querySelector('.plan-next-change').addEventListener('click', renderPicker);
  }

  function renderPicker() {
    card.innerHTML = `${countLine}
      <div class="plan-next-title">${icon('calendar', 18)} Plan your ${which} movie night with ${escapeHtml(partner)}</div>
      <div class="plan-next-sub">${first
    ? `Pick the evening now so it actually happens. We'll ask ${escapeHtml(partner)}, and once they're in you both get a reminder an hour before.`
    : `We'll ask ${escapeHtml(partner)} and remind you both an hour before.`}</div>
      <div class="plan-next-row">
        ${options.map((o, i) => `<button type="button" class="btn btn-primary plan-next-opt" data-i="${i}">${escapeHtml(o.label)}<span>${escapeHtml(fmt(o.when))}</span></button>`).join('')}
        <label class="plan-next-pick">Or pick a time <input type="datetime-local" class="plan-next-input"></label>
        <button type="button" class="btn btn-ghost plan-next-save" hidden>Save this time</button>
      </div>
      <div class="plan-next-msg" aria-live="polite"></div>`;
    const msg = card.querySelector('.plan-next-msg');
    const input = card.querySelector('.plan-next-input');
    const saveBtn = card.querySelector('.plan-next-save');
    const save = async (when, btn) => {
      btn.disabled = true; msg.textContent = 'Saving…';
      try {
        const r = await apiRequest('/api/night-plans', {
          method: 'POST',
          body: JSON.stringify({ partner, at: when.toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, via }),
        });
        // extension / push = the bell reaches them; sent = the ask went by email. Anything else: they won't hear from us.
        const reachable = ['extension', 'push', 'sent'].includes(r.sent && r.sent.partner);
        if (!reachable && !shareLink && window.getMyInvite) {
          try { shareLink = ((await window.getMyInvite()) || {}).url || ''; } catch (e) { /* the time alone still helps */ }
        }
        film = ''; filmBy = null;
        renderPlanned(new Date(r.at), { reachable, id: r.id });
      } catch (e) {
        btn.disabled = false; msg.textContent = (e && e.message) || 'Could not save it. Try again.';
      }
    };
    card.querySelectorAll('.plan-next-opt').forEach((b) => b.addEventListener('click', () => save(options[Number(b.dataset.i)].when, b)));
    // In this person's local time (datetime-local has no zone); starts at the same time tomorrow (founder 2026-10-16).
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    input.min = local(new Date(Date.now() + 10 * 60000));
    input.value = local(new Date(Date.now() + 24 * 3600000));
    saveBtn.hidden = false;
    input.addEventListener('change', () => { saveBtn.hidden = !input.value; });
    saveBtn.addEventListener('click', () => { const d = new Date(input.value); if (!Number.isNaN(d.getTime())) save(d, saveBtn); });
  }

  if (existing && existing.at) renderPlanned(new Date(existing.at), { confirmed: existing.confirmed, theirs: existing.by === partner, id: existing.id });
  else renderPicker();
  return card;
}
