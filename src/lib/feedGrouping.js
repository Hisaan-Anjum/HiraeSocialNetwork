// feedGrouping.js — turns a flat list of moments (as returned by
// GET /api/moments/feed, /mine, or /by/:username) into session-shaped
// objects matching GET /sessions/mine's shape, so the feed can render both
// through the one sessionCard component. A session with N captured moments
// shows up N times in a moments list (once per moment row), each carrying
// the SAME full review list for that session (see server's hydrateMoments)
// — grouping collapses that back into one card instead of one per photo.
'use strict';

export function groupMomentsBySession(moments) {
  const bySession = new Map();
  for (const m of moments) {
    let group = bySession.get(m.clientSessionId);
    if (!group) {
      group = {
        clientSessionId: m.clientSessionId,
        content: m.content,
        // Every moment in a session carries the same session-level title
        // (hydrateMoments sends it per row), so the first one settles it.
        sessionTitle: m.sessionTitle || null,
        participants: [...m.participants],
        // Merged across the session's moments below — sessionCard renders
        // the same participant-avatar stack whether the card came from
        // /sessions/mine (which sends participantAvatars directly) or was
        // grouped from a flat moments list here.
        participantAvatars: { ...(m.participantAvatars || {}) },
        moments: [],
        reviews: m.reviews, // same array reference for every moment in this session
        startedAt: m.createdAt,
        lastActivityAt: m.createdAt,
        isMine: m.isMine,
      };
      bySession.set(m.clientSessionId, group);
    }
    group.moments.push(m);
    for (const p of m.participants) if (!group.participants.includes(p)) group.participants.push(p);
    Object.assign(group.participantAvatars, m.participantAvatars || {});
    if (m.createdAt > group.lastActivityAt) group.lastActivityAt = m.createdAt;
    if (m.createdAt < group.startedAt) group.startedAt = m.createdAt;
  }
  for (const group of bySession.values()) {
    const ratings = group.reviews.map((r) => r.rating).filter((r) => r != null);
    group.averageRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
    // Newest-captured-moment-first within the session's own carousel.
    group.moments.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  return [...bySession.values()];
}
