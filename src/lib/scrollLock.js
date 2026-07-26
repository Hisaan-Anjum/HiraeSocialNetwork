// scrollLock.js — one reference-counted lock for "the page must not scroll
// behind this overlay".
//
// Every overlay used to do this itself: save document.body.style.overflow, set
// 'hidden', restore the saved value on close. That is correct for ONE overlay
// and quietly broken for two, because each captures whatever the other had
// already set. The watchlist hit exactly that: opening a movie from "Add Movie"
// nests two overlays, and adding a film closes the outer one immediately while
// the inner one closes on a short delay — so the inner one restored 'hidden'
// after the outer had already restored '', and the page was stuck.
//
// A counter fixes it by construction: the real value is captured once, on the
// first lock, and restored once, when the last overlay lets go — whatever order
// they happen to close in.
'use strict';

let depth = 0;
let savedOverflow = '';

// Locks scrolling and returns the matching release function. Returning it
// (rather than exporting an `unlock()`) means a caller cannot release someone
// else's lock, and the returned function is idempotent — calling it twice (a
// double close, an Escape plus a click) can't corrupt the count.
export function lockScroll() {
  if (depth === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  depth += 1;

  let released = false;
  return function releaseScroll() {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.style.overflow = savedOverflow;
  };
}
