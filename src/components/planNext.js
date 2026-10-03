// planNext.js — "Plan your next movie night" (server/src/night-plans.js; docs/autonomous-ops/PMF.md 2026-10-03).
//
// The funnel's biggest leak is the second night: of 12 accounts that had a night, 2 came back. One tap here puts the
// next night on both partners' calendars (a .ics in each inbox, shown in each person's own time zone) and both get a
// reminder an hour before. Shown at the end of a night (review page) and from the "movie night #2?" email (?plan=1).
'use strict';

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

export async function mountPlanNext(anchor, { partner, startedAt, via = 'review' } = {}) {
  if (!anchor || !partner || !apiRequest) return null;
  const card = document.createElement('div');
  card.className = 'plan-next';
  anchor.after(card);

  let existing = null;
  try { existing = (await apiRequest(`/api/night-plans/next?partner=${encodeURIComponent(partner)}`)).plan; } catch (e) { /* show the planner */ }

  const { h, m } = sameTime(startedAt);
  const options = [
    { label: 'Same time tomorrow', when: at(1, h, m) },
    { label: 'Same time next week', when: at(7, h, m) },
  ];

  function renderPlanned(when) {
    card.innerHTML = `
      <div class="plan-next-title">📅 Next movie night: ${escapeHtml(fmt(when))}</div>
      <div class="plan-next-sub">It's in both your inboxes as a calendar invite, in each of your own time zones, and you'll both get a reminder an hour before.</div>
      <button type="button" class="btn btn-ghost plan-next-change">Change</button>`;
    card.querySelector('.plan-next-change').addEventListener('click', renderPicker);
  }

  function renderPicker() {
    card.innerHTML = `
      <div class="plan-next-title">📅 Plan your next movie night with ${escapeHtml(partner)}</div>
      <div class="plan-next-sub">Couples who keep it going pick the next night before they say goodnight. It goes on both your calendars, in each of your time zones.</div>
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
        renderPlanned(new Date(r.at));
      } catch (e) {
        btn.disabled = false; msg.textContent = (e && e.message) || 'Could not save it. Try again.';
      }
    };
    card.querySelectorAll('.plan-next-opt').forEach((b) => b.addEventListener('click', () => save(options[Number(b.dataset.i)].when, b)));
    input.addEventListener('change', () => { saveBtn.hidden = !input.value; });
    saveBtn.addEventListener('click', () => { const d = new Date(input.value); if (!Number.isNaN(d.getTime())) save(d, saveBtn); });
  }

  if (existing && existing.at) renderPlanned(new Date(existing.at)); else renderPicker();
  return card;
}
