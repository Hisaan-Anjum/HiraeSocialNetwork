// pw-toggle.js — adds a show/hide "eye" button to every password field on the
// page, the way most sites do it. Self-contained and dependency-free: it wraps
// each <input type="password"> at load time, injects its own minimal CSS, and
// toggles the field between password/text on click. Loading it on a page is the
// only wiring needed; nothing else references it.
'use strict';
(function () {
  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function enhance(input) {
    if (input.dataset.pwToggle) return;      // already wrapped
    input.dataset.pwToggle = '1';
    var wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';                      // never submit the form
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = EYE;
    wrap.appendChild(btn);

    // Keep the caret in the field when the eye is clicked.
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () {
      var reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      btn.innerHTML = reveal ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    });
  }

  function init() {
    var css =
      '.pw-wrap{position:relative;display:block}' +
      '.pw-wrap>input{box-sizing:border-box;padding-right:42px!important}' +
      '.pw-toggle{position:absolute;top:50%;right:8px;transform:translateY(-50%);' +
      'width:30px;height:30px;display:flex;align-items:center;justify-content:center;' +
      'padding:0;margin:0;border:none;background:transparent;color:currentColor;' +
      'opacity:.55;cursor:pointer;border-radius:6px;-webkit-appearance:none;appearance:none}' +
      '.pw-toggle:hover{opacity:1}' +
      '.pw-toggle:focus-visible{outline:2px solid currentColor;outline-offset:1px;opacity:1}' +
      '.pw-toggle svg{width:18px;height:18px;display:block;pointer-events:none}';
    var st = document.createElement('style');
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
    document.querySelectorAll('input[type="password"]').forEach(enhance);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
