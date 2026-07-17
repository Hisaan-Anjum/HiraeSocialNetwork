// skeleton.js — loading placeholders shown while the first page (or the
// next page, during infinite scroll) is in flight. Shape roughly matches a
// session/review card so the layout doesn't jump once real content arrives.
'use strict';

export function renderFeedSkeletons(count = 3) {
  return Array.from({ length: count }, () => `
    <div class="skeleton-card" aria-hidden="true">
      <div class="skeleton-row">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line skeleton-line-short"></div>
          <div class="skeleton-line skeleton-line-shorter"></div>
        </div>
      </div>
      <div class="skeleton-media"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-short"></div>
    </div>
  `).join('');
}

export function renderEmptyState(icon, message) {
  return `<div class="empty-state"><div class="icon">${icon}</div><div class="msg">${message}</div></div>`;
}

export function renderErrorState(message) {
  return renderEmptyState('😕', message);
}
