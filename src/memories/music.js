// music.js — the story soundtracks. One track per story type, synthesised by
// music/synth.py (Herae owns them outright; see music/LICENSES.md). Shared by
// the player (live) and the exporter (mixed into the file), so both sound the same.
//
// Each file carries PAD s of the loop's end before it and PAD s of its start
// after it, so looping [PAD, PAD + loop] is seamless whatever padding the mp3
// decoder adds (see synth.py).
'use strict';

const PAD = 0.5;
export const STORY_MUSIC = {
  monthly: { file: '/music/little-evenings.mp3', loop: 45.7143 },
  anniversary: { file: '/music/golden-years.mp3', loop: 43.6364 },
  milestone: { file: '/music/marathon.mp3', loop: 34.2857 },
  holiday: { file: '/music/snowlight.mp3', loop: 36.0 },
  important_date: { file: '/music/keepsake.mp3', loop: 37.8947 },
  custom: { file: '/music/our-story.mp3', loop: 41.7391 },
};
export const MUSIC_LEVEL = 0.55;   // music under everything
export const DUCK_LEVEL = 0.18;    // …and while a clip with its own sound plays
export const DUCK_RAMP = 0.3;      // s
export const FADE_IN = 1.2, FADE_OUT = 2.5;

const bytes = new Map(); // file → Promise<ArrayBuffer>, fetched once per page
export const musicFor = (type) => STORY_MUSIC[type] || STORY_MUSIC.custom;

// Decoded track for this AudioContext, or null (offline, blocked, undecodable): a story never fails for want of music.
export async function loadMusic(ctx, type) {
  const { file } = musicFor(type);
  if (!bytes.has(file)) bytes.set(file, fetch(file).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))));
  try { return await ctx.decodeAudioData((await bytes.get(file)).slice(0)); } catch (e) { bytes.delete(file); return null; }
}

// Starts the looping track at `at` into `dest` through fade → duck gains. Returns
// { fade, duck, stop(when) }; `fade` carries the fade in/out and mute, `duck` the clip ducking.
export function startMusic(ctx, buffer, dest, type, at = ctx.currentTime) {
  const { loop } = musicFor(type);
  const src = ctx.createBufferSource();
  src.buffer = buffer; src.loop = true;
  src.loopStart = PAD; src.loopEnd = Math.min(buffer.duration, PAD + loop);
  const fade = ctx.createGain(), duck = ctx.createGain();
  fade.gain.setValueAtTime(0, at);
  fade.gain.linearRampToValueAtTime(MUSIC_LEVEL, at + FADE_IN);
  src.connect(fade).connect(duck).connect(dest);
  src.start(at, PAD);
  return { fade, duck, stop: (when = ctx.currentTime) => { try { src.stop(when); } catch (e) { /* not started */ } } };
}

// Ramp `duck` down for a clip playing over [from, to] (AudioContext seconds; `to` may be omitted for "until unduck").
export function duckAt(duck, from, to) {
  const g = duck.gain;
  g.setValueAtTime(1, from);
  g.linearRampToValueAtTime(DUCK_LEVEL, from + DUCK_RAMP);
  if (to != null) { g.setValueAtTime(DUCK_LEVEL, Math.max(from + DUCK_RAMP, to)); g.linearRampToValueAtTime(1, Math.max(from + DUCK_RAMP, to) + DUCK_RAMP); }
}
export function unduck(ctx, duck) {
  const g = duck.gain, now = ctx.currentTime;
  g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(1, now + DUCK_RAMP);
}
export function fadeOutAt(fade, at, secs = FADE_OUT) {
  fade.gain.setValueAtTime(MUSIC_LEVEL, at);
  fade.gain.linearRampToValueAtTime(0, at + secs);
}

// One AudioContext for the live player, created/resumed inside the user's tap
// (Safari only lets audio start from a gesture). Call from the click handler, before any await.
let liveCtx = null;
export function unlockStoryAudio() {
  try {
    liveCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (liveCtx.state === 'suspended') liveCtx.resume().catch(() => {});
  } catch (e) { liveCtx = null; }
  return liveCtx;
}
