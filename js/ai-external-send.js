/* ══════════════════════════════════════════════════════════
   ASK AI — send a results-screen question to an external AI chat
   site of the student's choice (ChatGPT, Claude, Gemini,
   Perplexity, DeepSeek, Grok, or "copy for anything else"),
   so they can keep talking about it there, in their own account.
   No API key of ours is used or required for any of this — it
   opens the real site and either pre-fills the composer (where
   the site supports that) or copies the prompt to the clipboard
   for the student to paste in.

   The prompt text mirrors exactly what the app already sends to
   Gemini for this question: buildExternalAiPrompt() below reuses
   the same building blocks as buildExplainPrompt() and
   buildChatSystemInstruction() in js/ai-features.js — question,
   options, correct answer, the student's own answer, any shared
   case/vignette context ("linked" sub-questions), a note about an
   attached image, the AI explanation already generated for this
   question (if any), and the full on-screen AI chat transcript
   (if any) — so switching assistants never loses context.

   Default AI: whichever provider the student last sent to is
   remembered (localStorage) and becomes a one-click "Ask <Name>"
   split button, so they don't reselect on every question — the
   small caret half reopens the picker to send this one elsewhere
   (see _extAiGetDefaultProvider()/_extAiRenderButtonInto()).

   Picker behavior: tapping an assistant in the dropdown *selects* it —
   it doesn't send anything yet. The panel updates in place with a
   one-line plain-language preview of what will happen ("Opens ChatGPT
   with the question already typed in…", "Copies the question, then
   opens Claude…", etc.) and a Send button becomes active to confirm
   (_extAiSelectProviderInMenu()/_extAiPreviewText()/_extAiConfirmSend()).
   Selecting a specific assistant (anything but "Copy for another AI")
   also remembers it as the default right away, not only once Send is
   pressed, so the student isn't asked to reselect it again on their next
   question even if they close this picker without sending. If a default
   is already remembered, it's preselected when the picker opens so Send
   is immediately ready. Wording throughout avoids keyboard-shortcut
   phrasing like "Ctrl/Cmd+V", since this app is used on phones too — it
   just says "paste".

   Images: a question with an image gets it copied to the
   clipboard automatically as part of sending, not as a separate
   manual step — alongside the prompt in one combined clipboard
   write for non-prefill AIs (_extAiCopyTextAndImage()), or on its
   own right after opening a prefill AI. The per-provider preview
   text says which applies before the student sends. "Copy
   question image" in the menu re-copies it on its own at any
   time, without closing the picker.

   Depends on (all loaded earlier, see index.html):
     - currentQuestions, userAnswers, getOptionEntries()  (app-core.js)
     - escapeHtml(), _cqCaseContextBlock(), _cqFindCaseGroupImage(),
       _explainRawText, _chatHistory                       (ai-features.js)
   See changelog #110/#111/#112/#113/#114.
══════════════════════════════════════════════════════════ */

/* URL-prefill only works for sites that actually support it (verified
   against each provider's current behavior — see README changelog #110).
   Everything else falls back to "copy the prompt, then open the site". A
   prompt this long would exceed what's safe to cram into a URL anyway, so
   even prefill-capable providers fall back past this length. */
const EXTERNAL_AI_MAX_PREFILL_LEN = 6000;

const EXTERNAL_AI_PROVIDERS = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    subtitle: 'Opens chatgpt.com, pre-filled',
    color: '#10A37F',
    initial: 'C',
    prefill: (text) => `https://chatgpt.com/?model=auto&q=${encodeURIComponent(text)}`,
    fallbackUrl: 'https://chatgpt.com/',
  },
  {
    id: 'claude',
    name: 'Claude',
    subtitle: 'Copies prompt, opens claude.ai',
    color: '#C15F3C',
    initial: 'A',
    prefill: null,
    fallbackUrl: 'https://claude.ai/new',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    subtitle: 'Copies prompt, opens gemini.google.com',
    color: '#3468DB',
    initial: 'G',
    prefill: null,
    fallbackUrl: 'https://gemini.google.com/app',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    subtitle: 'Opens perplexity.ai, pre-filled',
    color: '#1F8C7D',
    initial: 'P',
    prefill: (text) => `https://www.perplexity.ai/search?q=${encodeURIComponent(text)}`,
    fallbackUrl: 'https://www.perplexity.ai/',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    subtitle: 'Copies prompt, opens chat.deepseek.com',
    color: '#4D6BFE',
    initial: 'D',
    prefill: null,
    fallbackUrl: 'https://chat.deepseek.com/',
  },
  {
    id: 'grok',
    name: 'Grok',
    subtitle: 'Copies prompt, opens grok.com',
    color: '#2B2B33',
    initial: 'X',
    prefill: null,
    fallbackUrl: 'https://grok.com/',
  },
  {
    id: 'other',
    name: 'Copy for another AI',
    subtitle: 'Copies the prompt to your clipboard',
    color: null, // renders with the dashed neutral badge instead
    initial: '⧉',
    prefill: null,
    fallbackUrl: null,
  },
];

/* Currently-open menu's question index, or null. Only one open at a time. */
let _extAiOpenMenuIndex = null;

/* Which provider is currently selected (but not yet sent) in the open
   picker — tapping a provider row only sets this and updates the preview;
   nothing is copied or opened until the Send button confirms it. Cleared
   whenever the menu closes. See toggleAskAiMenu()/_extAiSelectProviderInMenu()
   /_extAiConfirmSend(). */
let _extAiMenuSelection = { index: null, providerId: null };

/* ── Default AI — remember whichever specific assistant the student last
   picked, so "Ask AI" becomes a single click to the same place next time
   instead of reselecting from the dropdown on every question. Set the
   moment a real provider is *selected* in the picker — not only once
   Send is actually pressed — so picking one is remembered right away and
   the student doesn't have to reselect it on their next question even if
   they don't end up sending this one (see _extAiSelectProviderInMenu()).
   "Copy for another AI" never sets it, since it isn't one specific
   assistant to remember. Reopening the picker (via the small caret next
   to the quick button) and selecting a different one changes it at any
   time — there's no separate "forget" action, since that reselect already
   covers it. Persisted in localStorage so it survives reloads. See
   README changelog for this feature. ── */
const ASK_AI_DEFAULT_KEY = 'askAiDefaultProviderId';

function _extAiGetDefaultProvider() {
  let id = null;
  try { id = localStorage.getItem(ASK_AI_DEFAULT_KEY); } catch (e) { /* storage unavailable */ }
  if (!id) return null;
  return EXTERNAL_AI_PROVIDERS.find(p => p.id === id && p.id !== 'other') || null;
}

function _extAiSetDefaultProvider(id) {
  try { localStorage.setItem(ASK_AI_DEFAULT_KEY, id); } catch (e) { /* storage unavailable */ }
  _extAiRefreshAllButtons();
}

/* The default applies app-wide, and every visible result card has its own
   "Ask AI" control, so a change made from one question's menu is reflected
   on all of them immediately rather than only after the next re-render. */
function _extAiRefreshAllButtons() {
  document.querySelectorAll('.ai-send-wrap').forEach(wrap => {
    const idx = parseInt(wrap.id.replace('askAiWrap_', ''), 10);
    if (!isNaN(idx)) _extAiRenderButtonInto(wrap, idx);
  });
}

/* Per-provider dropdown subtitle, adjusted for whether this question has an
   image — see _extAiPreviewText() for the fuller, plain-language version
   shown once a provider is selected. */
function _extAiSubtitleFor(p, hasImage) {
  if (!hasImage) return p.subtitle;
  if (p.prefill) return `${p.subtitle} — image copied too`;
  if (p.id === 'other') return `${p.subtitle} (image copied too)`;
  return p.subtitle.replace('Copies prompt', 'Copies prompt & image');
}

/* ── Build the exact block of context this question would send to an AI —
   shared with buildExplainPrompt()/buildChatSystemInstruction() in
   ai-features.js so nothing drifts out of sync between "Explain", "Chat",
   and "Ask AI". Returns { text, hasImage }. ── */
function buildExternalAiPrompt(i) {
  const q = currentQuestions[i];
  const userAnswer = (typeof userAnswers !== 'undefined' && userAnswers[i]) || '';
  const optLines = getOptionEntries(q).map(([k, v]) => ` ${k}. ${v}`).join('\n');
  const userLine = userAnswer
    ? `I answered: ${userAnswer}. ${q.options[userAnswer] || ''}`
    : "I didn't answer this question.";

  const caseBlock = typeof _cqCaseContextBlock === 'function' ? _cqCaseContextBlock(currentQuestions, q) : '';
  const hasImage = !!(q.image || (typeof _cqFindCaseGroupImage === 'function' && _cqFindCaseGroupImage(currentQuestions, q)));

  let text = `I'm reviewing a medical MCQ practice question and would like your help understanding it. Here's the question:\n\n`;
  if (caseBlock) text += caseBlock;
  text += `QUESTION:\n${q.question}\n\nOPTIONS:\n${optLines}\n\nCORRECT ANSWER: ${q.answer}. ${q.options[q.answer] || ''}\n${userLine}`;

  if (hasImage) {
    text += `\n\n(This question has an image/diagram attached in the app. I've copied it to my clipboard separately — I'll paste it in here too.)`;
  }

  // Same already-generated explanation the on-screen "Explain" panel used —
  // so the new assistant can build on it instead of starting from scratch.
  const rawExplain = typeof _explainRawText !== 'undefined' ? _explainRawText[i] : null;
  if (rawExplain) {
    text += `\n\nAn AI explanation was already generated for this question:\n${rawExplain}`;
  }

  // Same transcript shown in the on-screen "Chat" panel, condensed to
  // plain text — attachments are named rather than embedded (the browser
  // can't hand another site's composer a file automatically).
  const history = typeof _chatHistory !== 'undefined' ? (_chatHistory[i] || []) : [];
  if (history.length) {
    text += `\n\nHere's the conversation I've had about it so far:\n`;
    history.forEach(msg => {
      const who = msg.role === 'user' ? 'Me' : 'AI';
      const spoken = (msg.parts || []).filter(p => p.text).map(p => p.text).join(' ');
      const attached = (msg.parts || []).filter(p => p._name).map(p => `[attached: ${p._name}]`).join(' ');
      const line = [spoken, attached].filter(Boolean).join(' ');
      if (line) text += `${who}: ${line}\n`;
    });
  }

  text += `\n\nCan you help me understand this question? I may have follow-up questions about it.`;
  return { text, hasImage };
}

function _extAiGetImageDataUrl(i) {
  const q = currentQuestions[i];
  if (!q) return null;
  return q.image || (typeof _cqFindCaseGroupImage === 'function' ? _cqFindCaseGroupImage(currentQuestions, q) : null);
}

/* ── Clipboard helpers (best-effort, with a manual-select fallback for
   browsers/contexts where the async Clipboard API is unavailable) ── */
async function _extAiCopyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e2) {
      return false;
    }
  }
}

async function _extAiCopyImage(dataUrl) {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) return false;
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch (e) {
    return false;
  }
}

/* Writes the prompt text and the question image to the clipboard as one
   combined clipboard item (two representations of the same item, rather
   than two separate copy actions). A composer that accepts rich paste picks
   whichever representation(s) it supports, so a single Ctrl/Cmd+V can hand
   a non-prefill AI both the text and the image at once. Falls back to
   text-only (caller retries with _extAiCopyText) if the browser can't do a
   combined write. */
async function _extAiCopyTextAndImage(text, dataUrl) {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) return false;
    const res = await fetch(dataUrl);
    const imageBlob = await res.blob();
    const textBlob = new Blob([text], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItem({ [textBlob.type]: textBlob, [imageBlob.type]: imageBlob }),
    ]);
    return true;
  } catch (e) {
    return false;
  }
}

/* ── Small floating confirmation toast, theme-matched and auto-dismissing ── */
let _extAiToastTimer = null;
function _extAiToast(message) {
  let el = document.getElementById('extAiToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'extAiToast';
    el.className = 'ext-ai-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(_extAiToastTimer);
  _extAiToastTimer = setTimeout(() => el.classList.remove('visible'), 3600);
}

/* ── Build the "Ask AI" button + dropdown wrapper for question i.
   Appended into the results card's .r-content next to Explain/Chat/API
   Key (see js/app-core.js), matching their sizing/spacing conventions. ── */
function renderAskAiButtonGroup(i) {
  const wrap = document.createElement('span');
  wrap.className = 'ai-send-wrap';
  wrap.id = `askAiWrap_${i}`;
  _extAiRenderButtonInto(wrap, i);
  return wrap;
}

const PAPER_PLANE_ICON = '<svg class="sicon" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
const CARET_ICON = '<svg class="sicon ai-send-caret" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';

/* Fills an already-mounted .ai-send-wrap with the right control for the
   current default: a single "Ask AI" button (opens the picker) when no
   default is set yet, or a two-part split button — "Ask <Name>" that sends
   straight to the remembered assistant, plus a small caret that reopens the
   picker to change it — once one is. Called on first render and again
   whenever the default changes (_extAiSetDefaultProvider/_extAiRefreshAllButtons)
   so every card on screen stays in sync. */
function _extAiRenderButtonInto(wrap, i) {
  const wasOpen = _extAiOpenMenuIndex === i;
  if (wasOpen) closeAskAiMenu(i);

  const def = _extAiGetDefaultProvider();
  wrap.innerHTML = '';

  if (!def) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-send-btn';
    btn.id = `askAiBtn_${i}`;
    btn.innerHTML = `${PAPER_PLANE_ICON} Ask AI ${CARET_ICON}`;
    btn.onclick = (e) => { e.stopPropagation(); toggleAskAiMenu(i); };
    wrap.appendChild(btn);
  } else {
    const split = document.createElement('span');
    split.className = 'ai-send-split';
    split.id = `askAiBtn_${i}`;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'ai-send-btn ai-send-btn-main';
    main.title = `Ask ${def.name} — this question's context, one click`;
    main.innerHTML = `${PAPER_PLANE_ICON} Ask ${escapeHtml(def.name)}`;
    main.onclick = (e) => { e.stopPropagation(); sendQuestionToExternalAi(i, def.id); };

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'ai-send-btn ai-send-btn-caret';
    caret.title = 'Choose a different AI';
    caret.innerHTML = CARET_ICON;
    caret.onclick = (e) => { e.stopPropagation(); toggleAskAiMenu(i); };

    split.appendChild(main);
    split.appendChild(caret);
    wrap.appendChild(split);
  }

  if (wasOpen) toggleAskAiMenu(i);
}

/* Plain-language, device-agnostic description of what pressing Send will
   do for the given provider — shown live in the picker as the student
   taps between assistants, before anything is actually sent. Deliberately
   avoids keyboard-shortcut wording ("Ctrl/Cmd+V") since a lot of students
   use this on a phone; "paste" alone works the same way on touch (press
   and hold) as it does with a keyboard shortcut. */
function _extAiPreviewText(provider, hasImage) {
  if (provider.id === 'other') {
    return hasImage
      ? 'Copies the question and image together — paste them into any AI chat of your choice.'
      : 'Copies the question — paste it into any AI chat of your choice.';
  }
  if (provider.prefill) {
    return hasImage
      ? `Opens ${provider.name} with the question already typed in, and copies the image so you can paste it in once it loads.`
      : `Opens ${provider.name} with the question already typed in and ready to go.`;
  }
  return hasImage
    ? `Copies the question and image together, then opens ${provider.name} — paste them in once it loads.`
    : `Copies the question, then opens ${provider.name} — paste it in once it loads.`;
}

/* Label shown on the Send button for whichever provider is selected —
   "other" never opens a site of its own, so it reads as a copy action
   rather than a send. */
function _extAiSendLabel(provider) {
  return provider.id === 'other'
    ? `${PAPER_PLANE_ICON} Copy prompt`
    : `${PAPER_PLANE_ICON} Send to ${escapeHtml(provider.name)}`;
}

function toggleAskAiMenu(i) {
  if (_extAiOpenMenuIndex === i) { closeAskAiMenu(i); return; }
  if (_extAiOpenMenuIndex !== null) closeAskAiMenu(_extAiOpenMenuIndex);

  const wrap = document.getElementById(`askAiWrap_${i}`);
  if (!wrap) return;
  _extAiOpenMenuIndex = i;
  wrap.classList.add('open');

  const hasImage = !!_extAiGetImageDataUrl(i);
  const def = _extAiGetDefaultProvider();
  // Preselect the remembered default (if any) so Send is ready right
  // away — the student can still tap a different assistant first, and
  // nothing is sent until Send is actually pressed either way.
  _extAiMenuSelection = { index: i, providerId: def ? def.id : null };

  const menu = document.createElement('div');
  menu.className = 'ai-send-menu';
  menu.id = `askAiMenu_${i}`;
  menu.innerHTML = `
    <div class="ai-send-menu-label">Continue with…</div>
    ${EXTERNAL_AI_PROVIDERS.map(p => `
      <button type="button" class="ai-send-menu-item${p.id === (def && def.id) ? ' is-default' : ''}${p.id === _extAiMenuSelection.providerId ? ' is-selected' : ''}" data-provider="${p.id}" onclick="_extAiSelectProviderInMenu(${i}, '${p.id}')">
        <span class="ai-send-badge${p.color ? '' : ' ai-send-badge-outline'}"${p.color ? ` style="background:${p.color}"` : ''}>${escapeHtml(p.initial)}</span>
        <span class="ai-send-item-text">
          <span class="ai-send-item-name">${escapeHtml(p.name)}${p.id === (def && def.id) ? ' <span class="ai-send-default-badge">✓ Default</span>' : ''}</span>
          <span class="ai-send-item-sub">${escapeHtml(_extAiSubtitleFor(p, hasImage))}</span>
        </span>
      </button>`).join('')}
    ${hasImage ? `
    <div class="ai-send-menu-sep"></div>
    <button type="button" class="ai-send-menu-item ai-send-menu-image" onclick="copyQuestionImageForAi(${i})">
      <span class="ai-send-badge ai-send-badge-outline">📎</span>
      <span class="ai-send-item-text">
        <span class="ai-send-item-name">Copy question image</span>
        <span class="ai-send-item-sub">On its own, any time — doesn't close this picker</span>
      </span>
    </button>` : ''}
    <div class="ai-send-menu-sep"></div>
    <div class="ai-send-menu-preview" id="askAiPreview_${i}">${
      _extAiMenuSelection.providerId
        ? escapeHtml(_extAiPreviewText(def, hasImage))
        : 'Pick an AI above, then press Send.'
    }</div>
    <button type="button" class="ai-send-menu-send" id="askAiSendBtn_${i}" onclick="_extAiConfirmSend(${i})"${_extAiMenuSelection.providerId ? '' : ' disabled'}>
      ${_extAiMenuSelection.providerId ? _extAiSendLabel(def) : `${PAPER_PLANE_ICON} Send`}
    </button>
  `;

  // Appended to <body>, not to `wrap` — .r-card clips overflow (rounded
  // corners + color strip) and .results-body is its own scroll container,
  // so a menu nested inside either was being silently clipped to the
  // card's box instead of floating above it. Living at the body level
  // sidesteps both ancestors; positionAskAiMenu() below places it under
  // the button with inline top/left (skipped on narrow screens, where CSS
  // pins it as a bottom sheet instead). See changelog #111.
  document.body.appendChild(menu);
  positionAskAiMenu(i);

  window.addEventListener('scroll', _extAiRepositionHandler, true);
  window.addEventListener('resize', _extAiRepositionHandler);
  // Deferred so the click that opened the menu doesn't immediately close it.
  setTimeout(() => document.addEventListener('click', _extAiOutsideClickHandler), 0);
}

/* Places the open menu directly under its button, flipping above the
   button if there isn't room below, and clamping horizontally so it
   never runs off either edge of the viewport. No-op below 480px, where
   CSS pins the menu as a fixed bottom sheet instead (see
   `@media (max-width: 480px) .ai-send-menu` in styles.css). */
function positionAskAiMenu(i) {
  const btn = document.getElementById(`askAiBtn_${i}`);
  const menu = document.getElementById(`askAiMenu_${i}`);
  if (!btn || !menu) return;
  if (window.innerWidth <= 480) { menu.style.top = ''; menu.style.left = ''; return; }

  const GAP = 6, EDGE = 16;
  const r = btn.getBoundingClientRect();
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;

  let left = r.left;
  left = Math.min(left, vw - menuW - EDGE);
  left = Math.max(left, EDGE);

  const spaceBelow = vh - r.bottom - GAP;
  const openAbove = spaceBelow < menuH && r.top > spaceBelow;
  const top = openAbove ? Math.max(EDGE, r.top - GAP - menuH) : r.bottom + GAP;

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function _extAiRepositionHandler() {
  if (_extAiOpenMenuIndex !== null) positionAskAiMenu(_extAiOpenMenuIndex);
}

/* Tapping a provider row selects it for this open picker — updates the
   highlighted row, the live preview line, and the Send button. Nothing
   is copied or opened here; only pressing Send (_extAiConfirmSend())
   does that.

   For any specific assistant (not "Copy for another AI"), selecting it
   also sets it as the remembered default immediately — see
   _extAiSetDefaultProvider() — rather than waiting for Send, so the
   student isn't asked to pick it again on their next question even if
   they don't end up sending this one. That call rebuilds this button and
   reopens the picker fresh with the new default already preselected
   (_extAiRefreshAllButtons() → _extAiRenderButtonInto()), so it already
   covers the highlight/preview/Send-button update — no manual DOM patch
   needed for that path. "Copy for another AI" isn't a specific assistant
   to remember, so it's only ever selected for this one send and is
   patched in place below instead. */
function _extAiSelectProviderInMenu(i, providerId) {
  if (_extAiOpenMenuIndex !== i) return;
  const provider = EXTERNAL_AI_PROVIDERS.find(p => p.id === providerId);
  if (!provider) return;

  if (provider.id !== 'other') {
    _extAiSetDefaultProvider(provider.id);
    return;
  }

  _extAiMenuSelection = { index: i, providerId };

  const menu = document.getElementById(`askAiMenu_${i}`);
  if (!menu) return;
  menu.querySelectorAll('.ai-send-menu-item[data-provider]').forEach(el => {
    el.classList.toggle('is-selected', el.dataset.provider === providerId);
  });

  const hasImage = !!_extAiGetImageDataUrl(i);
  const preview = document.getElementById(`askAiPreview_${i}`);
  if (preview) preview.textContent = _extAiPreviewText(provider, hasImage);

  const sendBtn = document.getElementById(`askAiSendBtn_${i}`);
  if (sendBtn) {
    sendBtn.disabled = false;
    sendBtn.innerHTML = _extAiSendLabel(provider);
  }

  // The picker may have changed height (a longer/shorter preview line),
  // so re-clamp its position rather than leaving it possibly off-screen.
  positionAskAiMenu(i);
}

/* Confirms whatever's currently selected in the open picker — this is
   the only place that actually copies/opens anything for a picker
   selection (as opposed to the one-click "Ask <n>" split button, which
   already knows its target and sends immediately by design). */
function _extAiConfirmSend(i) {
  if (_extAiMenuSelection.index !== i || !_extAiMenuSelection.providerId) return;
  sendQuestionToExternalAi(i, _extAiMenuSelection.providerId);
}

function closeAskAiMenu(i) {
  const wrap = document.getElementById(`askAiWrap_${i}`);
  if (wrap) wrap.classList.remove('open');
  const menu = document.getElementById(`askAiMenu_${i}`);
  if (menu) menu.remove();
  _extAiOpenMenuIndex = null;
  _extAiMenuSelection = { index: null, providerId: null };
  document.removeEventListener('click', _extAiOutsideClickHandler);
  window.removeEventListener('scroll', _extAiRepositionHandler, true);
  window.removeEventListener('resize', _extAiRepositionHandler);
}

function _extAiOutsideClickHandler(e) {
  if (_extAiOpenMenuIndex === null) return;
  const wrap = document.getElementById(`askAiWrap_${_extAiOpenMenuIndex}`);
  const menu = document.getElementById(`askAiMenu_${_extAiOpenMenuIndex}`);
  const inside = (wrap && wrap.contains(e.target)) || (menu && menu.contains(e.target));
  if (!inside) closeAskAiMenu(_extAiOpenMenuIndex);
}

/* ── Core action: copy the prompt, open the chosen AI, and tell the
   student exactly what happened (pre-filled vs. paste-it-yourself) so
   there's never any ambiguity about whether it "worked". Only called
   once the student has confirmed a selection with the Send button (see
   _extAiConfirmSend()) or via the one-click default split button. ── */
async function sendQuestionToExternalAi(i, providerId) {
  const provider = EXTERNAL_AI_PROVIDERS.find(p => p.id === providerId);
  if (!provider) { closeAskAiMenu(i); return; }

  // "Copy for another AI" only writes to the clipboard — it never
  // navigates anywhere — so the picker stays open afterward in case the
  // student wants to copy the image next or send to a specific assistant
  // instead. Every other provider opens a real site in a new tab, which
  // reads as the interaction being finished, so the picker closes.
  if (provider.id !== 'other') closeAskAiMenu(i);

  // Belt-and-suspenders: a specific assistant is already remembered the
  // moment it's selected in the picker (_extAiSelectProviderInMenu()), so
  // this is normally a no-op re-set — but the one-click "Ask <n>" split
  // button calls straight into this function without going through the
  // picker at all, so it's kept here too. "Copy for another AI" is a
  // generic fallback, not one assistant to remember, so it's excluded.
  if (provider.id !== 'other') _extAiSetDefaultProvider(provider.id);

  const { text, hasImage } = buildExternalAiPrompt(i);
  const dataUrl = hasImage ? _extAiGetImageDataUrl(i) : null;
  const canPrefill = !!provider.prefill && text.length <= EXTERNAL_AI_MAX_PREFILL_LEN;

  // Prefill providers carry the text via the URL itself, so only the image
  // (if any) needs the clipboard. Everyone else needs the prompt copied —
  // and if there's an image too, it's copied together with the prompt as
  // one combined clipboard item (see _extAiCopyTextAndImage()) so a single
  // paste can hand the composer both, rather than the student needing a
  // separate manual step for the image.
  let copiedText = false, copiedImage = false, combinedCopy = false;
  if (canPrefill) {
    if (hasImage) copiedImage = await _extAiCopyImage(dataUrl);
  } else if (hasImage) {
    combinedCopy = await _extAiCopyTextAndImage(text, dataUrl);
    copiedText = combinedCopy || await _extAiCopyText(text);
  } else {
    copiedText = await _extAiCopyText(text);
  }

  let opened = false;
  if (canPrefill) {
    window.open(provider.prefill(text), '_blank', 'noopener');
    opened = true;
  } else if (provider.fallbackUrl) {
    window.open(provider.fallbackUrl, '_blank', 'noopener');
    opened = true;
  }

  let msg;
  if (provider.id === 'other') {
    if (!hasImage) {
      msg = copiedText ? 'Prompt copied — paste it into any AI chat.' : "Couldn't copy automatically — select and copy the prompt manually.";
    } else if (combinedCopy) {
      msg = 'Prompt and image copied together — paste them into any AI chat.';
    } else if (copiedText) {
      msg = 'Prompt copied — paste it into any AI chat. Use "Copy question image" for the image separately.';
    } else {
      msg = "Couldn't copy automatically — select and copy the prompt manually.";
    }
  } else if (canPrefill) {
    msg = `Opened ${provider.name}, pre-filled with the question.`;
    if (hasImage) {
      msg += copiedImage
        ? ' This question has an image — it was copied to your clipboard too; paste it into the chat.'
        : ' This question has an image, but copying it failed — use "Copy question image" to try again.';
    }
  } else if (opened) {
    if (!hasImage) {
      msg = copiedText
        ? `Opened ${provider.name} — paste the prompt into the chat.`
        : `Opened ${provider.name}, but copying the prompt failed — copy it manually.`;
    } else if (combinedCopy) {
      msg = `Opened ${provider.name} — the prompt and image were copied together; paste them into the chat.`;
    } else if (copiedText) {
      msg = `Opened ${provider.name} — paste the prompt in; use "Copy question image" for the image separately.`;
    } else {
      msg = `Opened ${provider.name}, but copying the prompt failed — copy it manually.`;
    }
  } else {
    msg = copiedText ? 'Prompt copied to your clipboard.' : "Couldn't copy the prompt — please try again.";
  }

  _extAiToast(msg);
}

/* Copies the question's image on its own — a manual option next to the
   provider list for re-copying at any point, or for pairing with a
   prefill AI (ChatGPT, Perplexity) by hand. Deliberately doesn't close
   the picker: the student might want to copy the image and then still
   pick/send a provider, or copy it again after a failed paste. */
async function copyQuestionImageForAi(i) {
  const dataUrl = _extAiGetImageDataUrl(i);
  if (!dataUrl) return;
  const ok = await _extAiCopyImage(dataUrl);
  _extAiToast(ok
    ? 'Image copied — paste it into the AI chat.'
    : "Couldn't copy the image in this browser — press and hold (or right-click) the image in the app and choose Copy Image instead.");
}
