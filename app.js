/* Crossroads — Dead of Winter
 * Single-file mobile web app. No build step.
 */

(() => {
  'use strict';

  // ===== State =====
  const state = {
    cards: [],         // full deck (loaded from cards.json)
    drawPile: [],      // remaining card indices for this play session
    currentCard: null,
    audio: null,
    started: false,
  };

  // ===== DOM helpers =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showScreen(name) {
    $$('.screen').forEach(s => {
      s.classList.toggle('hidden', s.dataset.screen !== name);
    });
    // scroll to top whenever switching
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // ===== Deck handling =====
  function shuffle(arr) {
    // Fisher-Yates
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function resetDeck() {
    state.drawPile = shuffle(state.cards.map((_, i) => i));
    updateRemaining();
  }

  function drawCard() {
    if (state.drawPile.length === 0) {
      // auto-reshuffle when exhausted
      resetDeck();
    }
    const idx = state.drawPile.pop();
    state.currentCard = state.cards[idx];
    updateRemaining();
    return state.currentCard;
  }

  function updateRemaining() {
    const el = $('#cards-remaining-count');
    if (el) el.textContent = state.drawPile.length;
  }

  // ===== Render =====
  function labelClass(label) {
    return 'label-' + label.toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function renderCard(card) {
    $('#card-title').textContent = card.title;
    $('#card-trigger').textContent = card.trigger;
    $('#card-description').textContent = card.description;

    const optionsList = $('#card-options');
    optionsList.innerHTML = '';
    card.options.forEach(opt => {
      const li = document.createElement('li');
      li.className = 'option';
      const label = document.createElement('span');
      label.className = 'option-label ' + labelClass(opt.label);
      label.textContent = opt.label;
      const text = document.createElement('p');
      text.className = 'option-text';
      text.textContent = opt.text;
      li.appendChild(label);
      li.appendChild(text);
      optionsList.appendChild(li);
    });

    // Pre-load this card's narration so playback is instant.
    prepareAudio(card);
  }

  // ===== Audio =====
  function prepareAudio(card) {
    releaseAudio();
    if (!card || !card.audio_file) return;
    const a = new Audio();
    a.preload = 'auto';
    a.src = card.audio_file;
    a.addEventListener('ended', () => {
      $('#audio-btn').classList.remove('playing');
    });
    a.addEventListener('error', () => {
      $('#audio-btn').classList.remove('playing');
    });
    // Kick off the network fetch now (preload=auto is a hint; load() makes it explicit).
    try { a.load(); } catch (_) { /* ignore */ }
    state.audio = a;
  }

  function releaseAudio() {
    if (state.audio) {
      try {
        state.audio.pause();
        state.audio.removeAttribute('src');
        state.audio.load();
      } catch (_) { /* ignore */ }
      state.audio = null;
    }
    $('#audio-btn').classList.remove('playing');
  }

  // Kept as the public "stop everything" hook used by screen transitions.
  function stopAudio() {
    releaseAudio();
  }

  function toggleAudio() {
    if (!state.audio) return;
    const btn = $('#audio-btn');
    if (!state.audio.paused) {
      // Currently playing -> stop and reset to start
      try {
        state.audio.pause();
        state.audio.currentTime = 0;
      } catch (_) { /* ignore */ }
      btn.classList.remove('playing');
      return;
    }
    // Paused / not yet started -> play from beginning
    try { state.audio.currentTime = 0; } catch (_) { /* ignore */ }
    state.audio.play().then(() => {
      btn.classList.add('playing');
    }).catch(() => {
      btn.classList.remove('playing');
    });
  }

  // ===== Flow =====
  function start() {
    if (!state.cards.length) return;
    if (!state.started) {
      resetDeck();
      state.started = true;
    }
    $('#pass-message').classList.add('hidden');
    showScreen('draw');
  }

  function onDraw() {
    stopAudio();
    const card = drawCard();
    renderCard(card);
    showScreen('card');
  }

  function onNext() {
    stopAudio();
    state.currentCard = null;
    $('#pass-message').classList.remove('hidden');
    showScreen('draw');
  }

  // ===== Init =====
  async function loadCards() {
    try {
      const res = await fetch('cards.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.cards = data.cards;
      $('#start-status').textContent = '';
    } catch (err) {
      console.error('Failed to load cards.json', err);
      $('#start-status').textContent = 'No se pudieron cargar las cartas.';
    }
  }

  function bindEvents() {
    document.body.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) {
        if (e.target.closest('#audio-btn')) toggleAudio();
        return;
      }
      const action = target.dataset.action;
      if (action === 'start') start();
      else if (action === 'draw') onDraw();
      else if (action === 'next') onNext();
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(err => {
          console.warn('SW registration failed', err);
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadCards();
    registerServiceWorker();
  });
})();
