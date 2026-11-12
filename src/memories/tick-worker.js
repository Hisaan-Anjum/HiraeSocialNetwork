// tick-worker.js — background-proof timer for the story exporter (page timers are throttled in hidden tabs).
onmessage = (e) => setTimeout(() => postMessage(0), e.data);
