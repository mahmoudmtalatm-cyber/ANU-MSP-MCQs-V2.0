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

   Depends on (all loaded earlier, see index.html):
     - currentQuestions, userAnswers, getOptionEntries()  (app-core.js)
     - escapeHtml(), _cqCaseContextBlock(), _cqFindCaseGroupImage(),
       _explainRawText, _chatHistory                       (ai-features.js)
   See changelog #110.
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

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ai-send-btn';
  btn.id = `askAiBtn_${i}`;
  btn.innerHTML = '<svg class="sicon" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg> Ask AI <svg class="sicon ai-send-caret" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';
  btn.onclick = (e) => { e.stopPropagation(); toggleAskAiMenu(i); };

  wrap.appendChild(btn);
  return wrap;
}

function toggleAskAiMenu(i) {
  if (_extAiOpenMenuIndex === i) { closeAskAiMenu(i); return; }
  if (_extAiOpenMenuIndex !== null) closeAskAiMenu(_extAiOpenMenuIndex);

  const wrap = document.getElementById(`askAiWrap_${i}`);
  if (!wrap) return;
  _extAiOpenMenuIndex = i;
  wrap.classList.add('open');

  const hasImage = !!_extAiGetImageDataUrl(i);
  const menu = document.createElement('div');
  menu.className = 'ai-send-menu';
  menu.id = `askAiMenu_${i}`;
  menu.innerHTML = `
    <div class="ai-send-menu-label">Continue with…</div>
    ${EXTERNAL_AI_PROVIDERS.map(p => `
      <button type="button" class="ai-send-menu-item" onclick="sendQuestionToExternalAi(${i}, '${p.id}')">
        <span class="ai-send-badge${p.color ? '' : ' ai-send-badge-outline'}"${p.color ? ` style="background:${p.color}"` : ''}>${escapeHtml(p.initial)}</span>
        <span class="ai-send-item-text">
          <span class="ai-send-item-name">${escapeHtml(p.name)}</span>
          <span class="ai-send-item-sub">${escapeHtml(p.subtitle)}</span>
        </span>
      </button>`).join('')}
    ${hasImage ? `
    <div class="ai-send-menu-sep"></div>
    <button type="button" class="ai-send-menu-item ai-send-menu-image" onclick="copyQuestionImageForAi(${i})">
      <span class="ai-send-badge ai-send-badge-outline">📎</span>
      <span class="ai-send-item-text">
        <span class="ai-send-item-name">Copy question image</span>
        <span class="ai-send-item-sub">Paste it in after the prompt</span>
      </span>
    </button>` : ''}
  `;
  wrap.appendChild(menu);

  // Deferred so the click that opened the menu doesn't immediately close it.
  setTimeout(() => document.addEventListener('click', _extAiOutsideClickHandler), 0);
}

function closeAskAiMenu(i) {
  const wrap = document.getElementById(`askAiWrap_${i}`);
  if (wrap) {
    wrap.classList.remove('open');
    const menu = document.getElementById(`askAiMenu_${i}`);
    if (menu) menu.remove();
  }
  _extAiOpenMenuIndex = null;
  document.removeEventListener('click', _extAiOutsideClickHandler);
}

function _extAiOutsideClickHandler(e) {
  if (_extAiOpenMenuIndex === null) return;
  const wrap = document.getElementById(`askAiWrap_${_extAiOpenMenuIndex}`);
  if (wrap && !wrap.contains(e.target)) closeAskAiMenu(_extAiOpenMenuIndex);
}

/* ── Core action: copy the prompt, open the chosen AI, and tell the
   student exactly what happened (pre-filled vs. paste-it-yourself) so
   there's never any ambiguity about whether it "worked". ── */
async function sendQuestionToExternalAi(i, providerId) {
  const provider = EXTERNAL_AI_PROVIDERS.find(p => p.id === providerId);
  closeAskAiMenu(i);
  if (!provider) return;

  const { text, hasImage } = buildExternalAiPrompt(i);
  const copied = await _extAiCopyText(text);
  const canPrefill = !!provider.prefill && text.length <= EXTERNAL_AI_MAX_PREFILL_LEN;

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
    msg = copied
      ? 'Prompt copied — paste it into any AI chat.'
      : "Couldn't copy automatically — select and copy the prompt manually.";
  } else if (canPrefill) {
    msg = `Opened ${provider.name}, pre-filled with the question.`;
  } else if (opened) {
    msg = copied
      ? `Opened ${provider.name} — paste the prompt (Ctrl/Cmd+V) into the chat.`
      : `Opened ${provider.name}, but copying the prompt failed — copy it manually.`;
  } else {
    msg = copied ? 'Prompt copied to your clipboard.' : "Couldn't copy the prompt — please try again.";
  }
  if (hasImage) msg += ' This question has an image — use "Copy question image" to bring that along too.';

  _extAiToast(msg);
}

async function copyQuestionImageForAi(i) {
  const dataUrl = _extAiGetImageDataUrl(i);
  closeAskAiMenu(i);
  if (!dataUrl) return;
  const ok = await _extAiCopyImage(dataUrl);
  _extAiToast(ok
    ? 'Image copied — paste it (Ctrl/Cmd+V) into the AI chat.'
    : "Couldn't copy the image in this browser — right-click the image in the app and choose Copy Image instead.");
}
