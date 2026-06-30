/**
 * ================================================================
 * CBT EXAMINATION SYSTEM — script.js
 * Ogun State College of Nursing Entrance Exam Practice
 *
 * Architecture: Single global CBT namespace with modular sections
 * Features: Anti-cheating, fullscreen enforcement, auto-save,
 *           timer, study mode, result analytics
 *
 * IMPORTANT SCREENSHOT NOTICE:
 * No web technology can completely prevent screenshots or screen
 * recording because browsers do not expose APIs for that purpose.
 * This system implements the strongest practical deterrents:
 * - Focus-loss blur + watermark overlay
 * - PrintScreen key detection (where supported) 
 * - Tab/window-switch violation counting
 * - Print blocking via CSS media query
 * - Fullscreen enforcement
 * ================================================================
 */

'use strict';

/* ================================================================
   GLOBAL CONSTANTS
================================================================ */
const EXAM_DURATION = 60 * 60;       // 60 minutes in seconds
const TOTAL_QUESTIONS = 60;           // Questions per exam
const MAX_VIOLATIONS = 3;             // Auto-submit after N violations
const AUTOSAVE_INTERVAL = 5000;       // ms between auto-saves
const STORAGE_PREFIX = 'cbt_v1_';

const GRADE_THRESHOLDS = [
  { min: 80, label: 'Excellent',  cls: 'grade-excellent' },
  { min: 65, label: 'Very Good',  cls: 'grade-very-good' },
  { min: 50, label: 'Good',       cls: 'grade-good'      },
  { min: 40, label: 'Fair',       cls: 'grade-fair'      },
  { min:  0, label: 'Poor',       cls: 'grade-poor'      },
];

const SUBJECT_META = {
  physics:     { label: 'Physics',          icon: '⚡', color: '#6c63ff' },
  chemistry:   { label: 'Chemistry',        icon: '🧪', color: '#00d4aa' },
  mathematics: { label: 'Mathematics',      icon: '📐', color: '#ffd166' },
  english:     { label: 'English Language', icon: '📚', color: '#ff6b9d' },
  biology:     { label: 'Biology',          icon: '🧬', color: '#51cf66' },
};

/* ================================================================
   UTILITY HELPERS
================================================================ */
const $ = (id) => document.getElementById(id);
const $q = (sel, ctx = document) => ctx.querySelector(sel);
const $all = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/** Fisher-Yates shuffle — returns new shuffled array */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Format seconds as MM:SS */
function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** Format seconds as "Xm Ys" for display */
function formatTimeSpent(secs) {
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** Local Storage helpers with JSON + error handling */
const Store = {
  set(key, val) { try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val)); } catch(e){} },
  get(key, def = null) { try { const v = localStorage.getItem(STORAGE_PREFIX + key); return v ? JSON.parse(v) : def; } catch(e){ return def; } },
  remove(key) { try { localStorage.removeItem(STORAGE_PREFIX + key); } catch(e){} },
};

/** Compute grade from percentage */
function getGrade(pct) {
  return GRADE_THRESHOLDS.find(g => pct >= g.min) || GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];
}

/* ================================================================
   MAIN CBT NAMESPACE
================================================================ */
const CBT = {

  /* ── STATE ───────────────────────────────────────────────────── */
  state: {
    mode: 'dashboard',       // 'dashboard' | 'exam' | 'result' | 'study' | 'history'
    subject: null,
    questions: [],           // 60 shuffled questions for current exam
    currentQ: 0,             // 0-based index
    answers: {},             // { questionIndex: 'A'|'B'|'C'|'D' }
    markedForReview: new Set(),
    timerSecondsLeft: EXAM_DURATION,
    timerInterval: null,
    autosaveInterval: null,
    examStartTime: null,
    examEndTime: null,
    violations: 0,
    paletteVisible: false,
    sessionId: null,

    // Study mode
    studySubject: null,
    studyAllQuestions: [],
    studyFiltered: [],
    bookmarks: {},
    mastered: {},
    showBookmarksOnly: false,
    studyYearFilter: 'all',
    studySearch: '',
  },

  /* ── INITIALISE ──────────────────────────────────────────────── */
  init() {
    // Load persisted settings
    this.state.bookmarks = Store.get('bookmarks', {});
    this.state.mastered  = Store.get('mastered', {});

    // Theme
    const saved = Store.get('theme', 'dark');
    document.documentElement.setAttribute('data-theme', saved);
    $('theme-icon').textContent = saved === 'dark' ? '🌙' : '☀️';

    // Theme toggle
    $('theme-toggle').addEventListener('click', () => this.toggleTheme());

    // Dashboard stats
    this.updateDashboardStats();

    // Fullscreen modal — bypass for now (will show on exam start)
    $('fullscreen-modal').classList.remove('active');

    // Keyboard navigation
    document.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Anti-cheating setup
    this.setupAntiCheating();
  },

  /* ── THEME ────────────────────────────────────────────────────── */
  toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    $('theme-icon').textContent = next === 'dark' ? '🌙' : '☀️';
    Store.set('theme', next);
  },

  /* ── SCREEN NAVIGATION ───────────────────────────────────────── */
  showScreen(name) {
    $all('.screen').forEach(s => s.classList.remove('active'));
    const target = $(`screen-${name}`);
    if (target) target.classList.add('active');
    this.state.mode = name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  goHome() {
    if (this.state.mode === 'exam') {
      if (!confirm('Are you sure you want to leave the exam? Your progress will be lost.')) return;
      this.cleanupExam();
    }
    this.exitFullscreen();
    document.body.classList.remove('exam-active');
    this.showScreen('dashboard');
    this.updateDashboardStats();
  },

  /* ── ANTI-CHEATING ───────────────────────────────────────────── */
  setupAntiCheating() {
    // Disable right-click context menu
    document.addEventListener('contextmenu', (e) => {
      if (this.state.mode === 'exam') { e.preventDefault(); this.recordViolation('right-click'); }
    });

    // Disable keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (this.state.mode !== 'exam') return;
      const blocked = [
        // Dev tools / view source
        { key: 'F12' },
        { key: 'F11' },
        { key: 'u', ctrl: true },
        { key: 'i', ctrl: true, shift: true },
        { key: 'j', ctrl: true, shift: true },
        { key: 'c', ctrl: true, shift: true },
        // Copy/paste/select
        { key: 'c', ctrl: true },
        { key: 'v', ctrl: true },
        { key: 'x', ctrl: true },
        { key: 'a', ctrl: true },
        // Save/print
        { key: 's', ctrl: true },
        { key: 'p', ctrl: true },
        // Print screen (best-effort detection)
        { key: 'PrintScreen' },
        { key: 'Snapshot' },
      ];
      const matched = blocked.some(b => {
        const keyMatch = e.key === b.key || e.key.toLowerCase() === (b.key || '').toLowerCase();
        const ctrlMatch = b.ctrl ? (e.ctrlKey || e.metaKey) : true;
        const shiftMatch = b.shift ? e.shiftKey : true;
        return keyMatch && ctrlMatch && shiftMatch;
      });
      if (matched) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'PrintScreen' || e.key === 'Snapshot') {
          this.showScreenshotWarning();
        }
        return false;
      }
    }, true);

    // Disable copy/cut/paste events
    ['copy', 'cut', 'paste'].forEach(ev => {
      document.addEventListener(ev, (e) => {
        if (this.state.mode === 'exam') e.preventDefault();
      });
    });

    // Disable drag
    document.addEventListener('dragstart', (e) => {
      if (this.state.mode === 'exam') e.preventDefault();
    });

    // Tab/window visibility change
    document.addEventListener('visibilitychange', () => {
      if (this.state.mode !== 'exam') return;
      if (document.hidden) {
        this.showWatermark();
        this.recordViolation('tab-switch');
      } else {
        this.hideWatermark();
      }
    });

    // Window blur (app switch, minimize)
    window.addEventListener('blur', () => {
      if (this.state.mode !== 'exam') return;
      this.showWatermark();
      this.recordViolation('window-blur');
    });

    window.addEventListener('focus', () => {
      this.hideWatermark();
    });

    // Fullscreen exit detection
    document.addEventListener('fullscreenchange', () => {
      if (this.state.mode !== 'exam') return;
      if (!document.fullscreenElement) {
        this.recordViolation('fullscreen-exit');
      }
    });
  },

  showWatermark() {
    const sid = this.state.sessionId || 'SESSION';
    $('watermark-text').textContent = `EXAM IN PROGRESS — ${sid}`;
    $('watermark-overlay').classList.add('active');
  },

  hideWatermark() {
    $('watermark-overlay').classList.remove('active');
  },

  showScreenshotWarning() {
    // Best-effort: blur the page briefly
    this.showWatermark();
    setTimeout(() => this.hideWatermark(), 2000);
    this.recordViolation('screenshot-attempt');
  },

  recordViolation(type) {
    if (this.state.mode !== 'exam') return;
    this.state.violations++;
    console.warn(`[CBT] Violation #${this.state.violations}: ${type}`);
    $('violation-num').textContent = this.state.violations;
    $('violation-message').textContent = this.getViolationMessage(type);

    if (this.state.violations >= MAX_VIOLATIONS) {
      this.autoSubmitExam();
    } else {
      $('violation-modal').classList.add('active');
    }
  },

  getViolationMessage(type) {
    const msgs = {
      'tab-switch':      'You switched tabs or opened another window.',
      'window-blur':     'You left the exam window.',
      'fullscreen-exit': 'You exited full-screen mode.',
      'right-click':     'You attempted to open the context menu.',
      'screenshot-attempt': 'Screenshot attempt detected.',
    };
    return msgs[type] || 'A security violation was detected.';
  },

  dismissViolation() {
    $('violation-modal').classList.remove('active');
    this.hideWatermark();
    // Re-enter fullscreen if exited
    if (!document.fullscreenElement) {
      this.enterFullscreen();
    }
  },

  autoSubmitExam() {
    $('violation-modal').classList.remove('active');
    this.state.examEndTime = Date.now();
    this.cleanupExam();
    $('autosubmit-modal').classList.add('active');
  },

  showResult() {
    $('autosubmit-modal').classList.remove('active');
    this.computeAndShowResult();
  },

  /* ── FULLSCREEN ──────────────────────────────────────────────── */
  enterFullscreen() {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
    } catch (e) {
      // Fullscreen may be blocked by browser policy (e.g. not a direct user
      // gesture, or running inside a restricted iframe). Exam still proceeds;
      // the fullscreenchange listener will simply not fire a false violation
      // since document.fullscreenElement stays null only if we never asked.
      console.warn('[CBT] Fullscreen request failed:', e);
    }
  },

  exitFullscreen() {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  },

  /* ── EXAM FLOW ────────────────────────────────────────────────── */
  startExam(subject) {
    // Check for an interrupted session (e.g. accidental refresh) before
    // generating a brand-new one. Sessions older than the exam duration
    // are considered stale (time would already be up) and are discarded.
    const saved = Store.get(`exam_session_${subject}`);
    const isFresh = saved && saved.timerSecondsLeft > 0 &&
      (Date.now() - (saved.savedAt || 0)) < EXAM_DURATION * 1000;

    if (isFresh) {
      const minutesLeft = Math.ceil(saved.timerSecondsLeft / 60);
      const resume = confirm(
        `You have an unfinished ${SUBJECT_META[subject].label} exam ` +
        `with about ${minutesLeft} minute(s) remaining.\n\n` +
        `Click OK to resume where you left off, or Cancel to discard it and start fresh.`
      );
      if (resume) {
        this.state.sessionId = saved.sessionId;
        $('enter-fullscreen-btn').onclick = () => {
          $('fullscreen-modal').classList.remove('active');
          this.enterFullscreen();
          this._resumeExam(subject, saved);
        };
        $('fullscreen-modal').classList.add('active');
        return;
      } else {
        Store.remove(`exam_session_${subject}`);
      }
    }

    // Generate a unique session ID for watermarking
    this.state.sessionId = `${subject.toUpperCase().slice(0,3)}-${Date.now().toString(36).toUpperCase()}`;

    // Show fullscreen prompt first
    $('enter-fullscreen-btn').onclick = () => {
      $('fullscreen-modal').classList.remove('active');
      this.enterFullscreen();
      this._initExam(subject);
    };
    $('fullscreen-modal').classList.add('active');
  },

  /** Reconstruct exam state from a saved session (resume after refresh) */
  _resumeExam(subject, saved) {
    const meta = SUBJECT_META[subject];
    if (!meta) return;

    this.state.subject = subject;
    this.state.questions = saved.questions;
    this.state.answers = saved.answers || {};
    this.state.markedForReview = new Set(saved.markedForReview || []);
    this.state.currentQ = saved.currentQ || 0;
    this.state.violations = 0;
    this.state.timerSecondsLeft = saved.timerSecondsLeft;
    this.state.examStartTime = saved.startTime || Date.now();

    document.body.classList.add('exam-active');
    $('exam-subject-label').textContent = meta.label;
    $('exam-subject-label').style.background = meta.color;

    this.buildPalette();

    const isMobile = window.innerWidth < 768;
    this.state.paletteVisible = !isMobile;
    $('question-palette').classList.toggle('hidden', isMobile);

    this.showScreen('exam');
    this.renderQuestion();
    this.updateProgress();
    this.startTimer();

    this.autosaveInterval = setInterval(() => this.saveSession(), AUTOSAVE_INTERVAL);
  },

  _initExam(subject) {
    const meta = SUBJECT_META[subject];
    if (!meta) return;

    this.state.subject = subject;
    this.state.currentQ = 0;
    this.state.answers = {};
    this.state.markedForReview = new Set();
    this.state.violations = 0;
    this.state.timerSecondsLeft = EXAM_DURATION;
    this.state.examStartTime = Date.now();

    // Load & shuffle questions
    const allQ = window.CBT_QB ? window.CBT_QB.get(subject) : [];
    if (!allQ || allQ.length === 0) {
      alert('Questions not loaded. Please check that questions.js is present.');
      return;
    }
    // Pick 60 random questions, shuffle options too
    const picked = shuffle(allQ).slice(0, TOTAL_QUESTIONS);
    this.state.questions = picked.map(q => {
      // Shuffle the option order (A,B,C,D) randomly
      const letters = shuffle(['A', 'B', 'C', 'D']);
      const newOptions = {};
      const letterMap = {}; // original -> new
      const revMap = {};    // new -> original
      letters.forEach((origLetter, i) => {
        const newLetter = ['A', 'B', 'C', 'D'][i];
        newOptions[newLetter] = q.options[origLetter] || '';
        letterMap[origLetter] = newLetter;
        revMap[newLetter] = origLetter;
      });
      return {
        ...q,
        options: newOptions,
        correct: letterMap[q.correct] || q.correct, // remap correct answer
        _revMap: revMap,
      };
    });

    // Update UI
    document.body.classList.add('exam-active');
    $('exam-subject-label').textContent = meta.label;
    $('exam-subject-label').style.background = meta.color;

    // Build palette
    this.buildPalette();

    // On mobile, the palette is a fixed overlay and should start hidden.
    // On desktop, it's a permanent sidebar and should start visible.
    const isMobile = window.innerWidth < 768;
    this.state.paletteVisible = !isMobile;
    $('question-palette').classList.toggle('hidden', isMobile);

    // Show exam screen
    this.showScreen('exam');

    // Render first question
    this.renderQuestion();
    this.updateProgress();

    // Start timer
    this.startTimer();

    // Auto-save
    this.autosaveInterval = setInterval(() => this.saveSession(), AUTOSAVE_INTERVAL);
  },

  /* ── TIMER ────────────────────────────────────────────────────── */
  startTimer() {
    this.updateTimerUI();
    this.state.timerInterval = setInterval(() => {
      this.state.timerSecondsLeft--;
      this.updateTimerUI();
      if (this.state.timerSecondsLeft <= 0) {
        this.timeUp();
      }
    }, 1000);
  },

  updateTimerUI() {
    const secs = this.state.timerSecondsLeft;
    const total = EXAM_DURATION;
    const pct = secs / total;

    // Text
    $('timer-display').textContent = formatTime(secs);

    // SVG ring
    const circ = 163.36;
    const offset = circ * (1 - pct);
    $('timer-progress-ring').style.strokeDashoffset = offset;

    // Colour states
    const wrap = $('timer-wrap');
    wrap.classList.remove('warning', 'danger');
    if (secs <= 300)       wrap.classList.add('danger');
    else if (secs <= 600)  wrap.classList.add('warning');
  },

  timeUp() {
    clearInterval(this.state.timerInterval);
    alert('Time is up! Your exam will now be submitted.');
    this.submitExam();
  },

  /* ── QUESTION RENDERING ──────────────────────────────────────── */
  renderQuestion() {
    const q = this.state.questions[this.state.currentQ];
    if (!q) return;

    const idx = this.state.currentQ;
    const num = idx + 1;

    // Header
    $('question-number').textContent = `Question ${num} of ${TOTAL_QUESTIONS}`;
    $('exam-qcount').textContent = `Q ${num}/${TOTAL_QUESTIONS}`;

    // Mark for review button
    const marked = this.state.markedForReview.has(idx);
    const mrBtn = $('mark-review-btn');
    mrBtn.setAttribute('aria-pressed', String(marked));
    mrBtn.textContent = marked ? '🔖 Marked for Review' : '🔖 Mark for Review';

    // Question text
    $('question-text').textContent = q.text;

    // Options
    const selected = this.state.answers[idx];
    const optList = $('options-list');
    optList.innerHTML = '';

    ['A', 'B', 'C', 'D'].forEach(letter => {
      if (!q.options[letter]) return;
      const btn = document.createElement('button');
      btn.className = 'option-item' + (selected === letter ? ' selected' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(selected === letter));
      btn.setAttribute('aria-label', `Option ${letter}: ${q.options[letter]}`);
      btn.innerHTML = `
        <span class="option-letter">${letter}</span>
        <span class="option-text">${q.options[letter]}</span>
      `;
      btn.addEventListener('click', () => this.selectAnswer(idx, letter));
      optList.appendChild(btn);
    });

    // Nav buttons
    $('prev-btn').disabled = idx === 0;
    $('next-btn').disabled = idx === TOTAL_QUESTIONS - 1;
    $('next-btn').textContent = idx === TOTAL_QUESTIONS - 1 ? 'Finish' : 'Next ▶';

    // Update palette
    this.updatePaletteHighlight();

    // Card animation
    const card = $('question-card');
    card.style.animation = 'none';
    requestAnimationFrame(() => { card.style.animation = ''; });
  },

  selectAnswer(qIdx, letter) {
    this.state.answers[qIdx] = letter;
    // Remove marked-for-review when answered (optional — keep it)
    this.renderQuestion();
    this.updateProgress();
    this.updatePaletteBtn(qIdx);
  },

  clearAnswer() {
    delete this.state.answers[this.state.currentQ];
    this.renderQuestion();
    this.updateProgress();
    this.updatePaletteBtn(this.state.currentQ);
  },

  prevQuestion() {
    if (this.state.currentQ > 0) {
      this.state.currentQ--;
      this.renderQuestion();
      this.updatePaletteHighlight();
    }
  },

  nextQuestion() {
    if (this.state.currentQ < TOTAL_QUESTIONS - 1) {
      this.state.currentQ++;
      this.renderQuestion();
      this.updatePaletteHighlight();
    }
  },

  jumpToQuestion(idx) {
    this.state.currentQ = idx;
    this.renderQuestion();
    // Close palette on mobile
    if (window.innerWidth < 768) this.togglePalette(false);
  },

  toggleMarkReview() {
    const idx = this.state.currentQ;
    if (this.state.markedForReview.has(idx)) {
      this.state.markedForReview.delete(idx);
    } else {
      this.state.markedForReview.add(idx);
    }
    this.renderQuestion();
    this.updatePaletteBtn(idx);
  },

  /* ── QUESTION PALETTE ────────────────────────────────────────── */
  buildPalette() {
    const grid = $('palette-grid');
    grid.innerHTML = '';
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      const btn = document.createElement('button');
      btn.className = 'palette-btn';
      btn.textContent = i + 1;
      btn.setAttribute('role', 'listitem');
      btn.setAttribute('aria-label', `Jump to question ${i + 1}`);
      btn.id = `pbtn-${i}`;
      btn.addEventListener('click', () => this.jumpToQuestion(i));
      grid.appendChild(btn);
    }
    this.updatePaletteHighlight();
  },

  updatePaletteBtn(idx) {
    const btn = $(`pbtn-${idx}`);
    if (!btn) return;
    btn.className = 'palette-btn';
    if (this.state.markedForReview.has(idx)) btn.classList.add('review');
    else if (this.state.answers[idx]) btn.classList.add('answered');
    if (idx === this.state.currentQ) btn.classList.add('current');
  },

  updatePaletteHighlight() {
    for (let i = 0; i < TOTAL_QUESTIONS; i++) this.updatePaletteBtn(i);
  },

  togglePalette(force) {
    const palette = $('question-palette');
    const show = force !== undefined ? force : !this.state.paletteVisible;
    this.state.paletteVisible = show;
    palette.classList.toggle('hidden', !show);
    // Backdrop only matters on mobile (CSS hides it on desktop via display:none default)
    const backdrop = $('palette-backdrop');
    if (backdrop) backdrop.classList.toggle('active', show && window.innerWidth < 768);
  },

  /* ── PROGRESS ────────────────────────────────────────────────── */
  updateProgress() {
    const answered = Object.keys(this.state.answers).length;
    const pct = (answered / TOTAL_QUESTIONS) * 100;
    $('exam-progress-fill').style.width = pct + '%';
    $('exam-progress-bar-wrapper').setAttribute('aria-valuenow', answered);
  },

  /* ── AUTO-SAVE / RESUME ──────────────────────────────────────── */
  saveSession() {
    if (this.state.mode !== 'exam') return;
    Store.set(`exam_session_${this.state.subject}`, {
      sessionId: this.state.sessionId,
      subject: this.state.subject,
      // Persist the full shuffled question set (including the shuffled
      // option order) so a resumed exam looks pixel-identical to where
      // the student left off -- re-shuffling on resume would silently
      // change which letter the correct answer sits under.
      questions: this.state.questions,
      answers: this.state.answers,
      markedForReview: [...this.state.markedForReview],
      currentQ: this.state.currentQ,
      timerSecondsLeft: this.state.timerSecondsLeft,
      startTime: this.state.examStartTime,
      savedAt: Date.now(),
    });
  },

  /* ── SUBMIT FLOW ─────────────────────────────────────────────── */
  showConfirmSubmit() {
    const answered = Object.keys(this.state.answers).length;
    const unanswered = TOTAL_QUESTIONS - answered;
    const marked = this.state.markedForReview.size;
    $('confirm-stats').innerHTML = `
      <div class="confirm-stat-row"><span>Answered</span><strong>${answered}</strong></div>
      <div class="confirm-stat-row"><span>Unanswered</span><strong>${unanswered}</strong></div>
      <div class="confirm-stat-row"><span>Marked for Review</span><strong>${marked}</strong></div>
    `;
    $('confirm-submit-modal').classList.add('active');
  },

  closeConfirm() {
    $('confirm-submit-modal').classList.remove('active');
  },

  confirmSubmit() {
    $('confirm-submit-modal').classList.remove('active');
    this.submitExam();
  },

  submitExam() {
    this.state.examEndTime = Date.now();
    this.cleanupExam();
    this.computeAndShowResult();
  },

  cleanupExam() {
    clearInterval(this.state.timerInterval);
    clearInterval(this.state.autosaveInterval);
    Store.remove(`exam_session_${this.state.subject}`);
    document.body.classList.remove('exam-active');
    this.hideWatermark();
    $('violation-modal').classList.remove('active');
  },

  /* ── RESULT ──────────────────────────────────────────────────── */
  computeAndShowResult() {
    const qs = this.state.questions;
    const ans = this.state.answers;
    let correct = 0, wrong = 0, skipped = 0;

    qs.forEach((q, i) => {
      const userAns = ans[i];
      if (!userAns) { skipped++; }
      else if (userAns === q.correct) { correct++; }
      else { wrong++; }
    });

    const pct = Math.round((correct / TOTAL_QUESTIONS) * 100);
    const grade = getGrade(pct);
    const timeSpent = this.state.examEndTime
      ? Math.round((this.state.examEndTime - this.state.examStartTime) / 1000)
      : EXAM_DURATION - this.state.timerSecondsLeft;

    // Save to history
    const histKey = `history_${this.state.subject}`;
    const history = Store.get(histKey, []);
    history.unshift({
      date: new Date().toISOString(),
      score: pct,
      correct, wrong, skipped,
      timeSpent,
      grade: grade.label,
    });
    if (history.length > 50) history.pop(); // keep last 50
    Store.set(histKey, history);

    // Render result
    this._renderResult({ correct, wrong, skipped, pct, grade, timeSpent, qs, ans });
    this.showScreen('result');

    // Animate score circle
    setTimeout(() => {
      const circ = 439.82;
      const offset = circ * (1 - pct / 100);
      const el = $('score-circle-fill');
      if (el) el.style.strokeDashoffset = offset;
    }, 200);

    // Set score fill colour
    const scoreEl = $('score-circle-fill');
    if (scoreEl) {
      if (pct >= 80) scoreEl.style.stroke = 'var(--success)';
      else if (pct >= 50) scoreEl.style.stroke = 'var(--accent)';
      else scoreEl.style.stroke = 'var(--danger)';
    }
  },

  _renderResult({ correct, wrong, skipped, pct, grade, timeSpent, qs, ans }) {
    const meta = SUBJECT_META[this.state.subject];

    $('result-subject-name').textContent = meta ? meta.label : this.state.subject;
    $('score-percent').textContent = `${pct}%`;
    $('score-grade').textContent = grade.label;

    $('rs-correct').textContent = correct;
    $('rs-wrong').textContent   = wrong;
    $('rs-skipped').textContent = skipped;
    $('rs-time').textContent    = formatTimeSpent(timeSpent);

    // Performance bars
    $('perf-bars').innerHTML = `
      <div class="perf-row">
        <span class="perf-label">Correct</span>
        <div class="perf-track">
          <div class="perf-fill" style="width:0%;background:var(--success)"
               data-target="${(correct/TOTAL_QUESTIONS*100).toFixed(1)}%"></div>
        </div>
        <span class="perf-val">${correct}</span>
      </div>
      <div class="perf-row">
        <span class="perf-label">Wrong</span>
        <div class="perf-track">
          <div class="perf-fill" style="width:0%;background:var(--danger)"
               data-target="${(wrong/TOTAL_QUESTIONS*100).toFixed(1)}%"></div>
        </div>
        <span class="perf-val">${wrong}</span>
      </div>
      <div class="perf-row">
        <span class="perf-label">Skipped</span>
        <div class="perf-track">
          <div class="perf-fill" style="width:0%;background:var(--text-muted)"
               data-target="${(skipped/TOTAL_QUESTIONS*100).toFixed(1)}%"></div>
        </div>
        <span class="perf-val">${skipped}</span>
      </div>
    `;
    // Animate bars
    setTimeout(() => {
      $all('.perf-fill').forEach(el => {
        el.style.width = el.dataset.target;
      });
    }, 300);

    // Store for filter
    this._resultData = { qs, ans };
    this.filterReview('all');
  },

  _resultData: null,
  _reviewFilter: 'all',

  filterReview(filter) {
    this._reviewFilter = filter;
    $all('.review-section .filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    this._renderReviewList();
  },

  _renderReviewList() {
    if (!this._resultData) return;
    const { qs, ans } = this._resultData;
    const filter = this._reviewFilter;
    const list = $('review-list');
    list.innerHTML = '';

    qs.forEach((q, i) => {
      const userAns = ans[i];
      const isCorrect = userAns === q.correct;
      const status = !userAns ? 'skipped' : (isCorrect ? 'correct' : 'wrong');

      if (filter !== 'all' && filter !== status) return;

      const item = document.createElement('div');
      item.className = `review-item ${status}-item`;
      item.innerHTML = `
        <div class="review-item-header">
          <span class="review-qnum">Q${i + 1}</span>
          <span class="review-status-badge badge-${status}">
            ${status === 'correct' ? '✅ Correct' : status === 'wrong' ? '❌ Wrong' : '⬜ Skipped'}
          </span>
        </div>
        <div class="review-q-text">${q.text}</div>
        <div class="review-options">
          ${['A','B','C','D'].map(letter => {
            if (!q.options[letter]) return '';
            let cls = '';
            if (letter === q.correct) cls = 'opt-correct';
            else if (letter === userAns && userAns !== q.correct) cls = 'opt-wrong';
            return `<div class="rev-option ${cls}">
              <span class="rev-opt-letter">${letter}.</span>
              <span>${q.options[letter]}</span>
              ${letter === q.correct ? ' ✅' : ''}
              ${letter === userAns && letter !== q.correct ? ' ← Your answer' : ''}
            </div>`;
          }).join('')}
        </div>
        ${q.explanation ? `
          <div class="explanation-box">
            💡 <strong>Explanation:</strong> ${q.explanation}
          </div>
        ` : ''}
      `;
      list.appendChild(item);
    });

    if (list.innerHTML === '') {
      list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:2rem">No questions match this filter.</div>`;
    }
  },

  retakeExam() {
    this.startExam(this.state.subject);
  },

  /* ── STUDY MODE ──────────────────────────────────────────────── */
  startStudy(subject) {
    const meta = SUBJECT_META[subject];
    this.state.studySubject = subject;
    this.state.showBookmarksOnly = false;
    this.state.studyYearFilter = 'all';
    this.state.studySearch = '';

    $('study-title').textContent = `Study Mode — ${meta.label}`;

    const allQ = window.CBT_QB ? window.CBT_QB.get(subject) : [];
    this.state.studyAllQuestions = allQ;

    // Build year filter buttons
    const years = [...new Set(allQ.map(q => q.year))].sort((a, b) => a - b);
    const filterBtns = $q('.study-filter-btns');
    filterBtns.innerHTML = `<button class="filter-btn active" data-topic="all" onclick="CBT.filterStudyYear('all')">All Years</button>`;
    years.forEach(y => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.dataset.topic = y;
      btn.textContent = `Year ${y}`;
      btn.onclick = () => CBT.filterStudyYear(y);
      filterBtns.appendChild(btn);
    });

    $('show-bookmarks-btn').textContent = '🔖 Bookmarks Only';

    this.applyStudyFilter();
    this.showScreen('study');
  },

  filterStudyYear(year) {
    this.state.studyYearFilter = year;
    $all('.study-filter-btns .filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.topic == year);
    });
    this.applyStudyFilter();
  },

  filterStudy() {
    this.state.studySearch = $('study-search').value.toLowerCase().trim();
    this.applyStudyFilter();
  },

  showBookmarksOnly() {
    this.state.showBookmarksOnly = !this.state.showBookmarksOnly;
    $('show-bookmarks-btn').textContent = this.state.showBookmarksOnly ? '📖 Show All' : '🔖 Bookmarks Only';
    this.applyStudyFilter();
  },

  applyStudyFilter() {
    const all = this.state.studyAllQuestions;
    const sub = this.state.studySubject;
    const bm = this.state.bookmarks[sub] || {};
    const ms = this.state.mastered[sub] || {};

    let filtered = all.filter(q => {
      const yearOk = this.state.studyYearFilter === 'all' || q.year == this.state.studyYearFilter;
      const searchOk = !this.state.studySearch || q.text.toLowerCase().includes(this.state.studySearch);
      const bmOk = !this.state.showBookmarksOnly || bm[q.id];
      return yearOk && searchOk && bmOk;
    });

    this.state.studyFiltered = filtered;

    // Update stats
    const masteredCount = Object.values(ms).filter(Boolean).length;
    const bmCount = Object.values(bm).filter(Boolean).length;
    $('study-total-count').textContent = `${filtered.length} questions`;
    $('study-bookmarks-count').textContent = `${bmCount} bookmarked`;
    $('study-mastered-count').textContent = `${masteredCount} mastered`;
    $('study-progress-text').textContent = `${masteredCount} / ${all.length} mastered`;

    this.renderStudyList(filtered);
  },

  renderStudyList(questions) {
    const sub = this.state.studySubject;
    const bm = this.state.bookmarks[sub] || {};
    const ms = this.state.mastered[sub] || {};
    const list = $('study-list');
    list.innerHTML = '';

    if (!questions.length) {
      list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:3rem">No questions found.</div>`;
      return;
    }

    questions.forEach((q, idx) => {
      const isBookmarked = !!bm[q.id];
      const isMastered = !!ms[q.id];
      const cardEl = document.createElement('div');
      cardEl.className = 'study-card';
      cardEl.id = `sc-${q.id}`;

      // Build "why each option is right/wrong" for study
      const optionsHtml = ['A','B','C','D'].map(letter => {
        if (!q.options[letter]) return '';
        const isCorrect = letter === q.correct;
        const why = isCorrect
          ? `✅ Correct answer`
          : `❌ Incorrect`;
        return `
          <div class="study-option ${isCorrect ? 'opt-correct' : 'opt-wrong'}">
            <span class="study-opt-letter">${letter}.</span>
            <div>
              <div>${q.options[letter]}</div>
              <div class="study-opt-why">${why}</div>
            </div>
          </div>
        `;
      }).join('');

      cardEl.innerHTML = `
        <div class="study-card-header">
          <div class="study-card-meta">
            <span class="study-qnum">Q${idx + 1}</span>
            <span class="study-year-badge">Year ${q.year}</span>
            ${isMastered ? '<span class="mastered-badge">✓ Mastered</span>' : ''}
          </div>
          <div class="study-card-actions">
            <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}"
                    title="${isBookmarked ? 'Remove bookmark' : 'Bookmark this question'}"
                    onclick="CBT.toggleBookmark('${q.id}')"
                    aria-label="${isBookmarked ? 'Remove bookmark' : 'Bookmark'}">
              ${isBookmarked ? '🔖' : '🏷'}
            </button>
            <button class="expand-btn" onclick="CBT.toggleStudyCard('${q.id}')" aria-expanded="false"
                    id="expand-${q.id}">
              Show Answer ▼
            </button>
          </div>
        </div>
        <div class="study-q-text">${q.text}</div>
        <div class="study-answer-section" id="ans-${q.id}">
          <div class="study-options">${optionsHtml}</div>
          ${q.explanation ? `
            <div class="study-explanation">
              💡 <strong>Explanation:</strong> ${q.explanation}
            </div>
          ` : ''}
          <button class="study-master-btn ${isMastered ? 'mastered' : ''}"
                  onclick="CBT.toggleMastered('${q.id}')" id="mb-${q.id}">
            ${isMastered ? '✓ Mastered!' : '+ Mark as Mastered'}
          </button>
        </div>
      `;
      list.appendChild(cardEl);
    });
  },

  toggleStudyCard(id) {
    const ansEl = $(`ans-${id}`);
    const expandBtn = $(`expand-${id}`);
    const isOpen = ansEl.classList.toggle('open');
    expandBtn.textContent = isOpen ? 'Hide Answer ▲' : 'Show Answer ▼';
    expandBtn.setAttribute('aria-expanded', String(isOpen));
  },

  toggleBookmark(qId) {
    const sub = this.state.studySubject;
    if (!this.state.bookmarks[sub]) this.state.bookmarks[sub] = {};
    const bm = this.state.bookmarks[sub];
    bm[qId] = !bm[qId];
    Store.set('bookmarks', this.state.bookmarks);

    // If currently filtering to bookmarks-only and this was un-bookmarked,
    // a full refilter is required (item should disappear from the list).
    if (this.state.showBookmarksOnly && !bm[qId]) {
      this.applyStudyFilter();
      return;
    }

    // Otherwise, update in-place so any expanded answer panel stays open.
    const btn = document.querySelector(`#sc-${qId} .bookmark-btn`);
    if (btn) {
      btn.textContent = bm[qId] ? '🔖' : '🏷';
      btn.classList.toggle('bookmarked', bm[qId]);
      btn.title = bm[qId] ? 'Remove bookmark' : 'Bookmark this question';
      btn.setAttribute('aria-label', bm[qId] ? 'Remove bookmark' : 'Bookmark');
    }
    const bmCount = Object.values(bm).filter(Boolean).length;
    $('study-bookmarks-count').textContent = `${bmCount} bookmarked`;
  },

  toggleMastered(qId) {
    const sub = this.state.studySubject;
    if (!this.state.mastered[sub]) this.state.mastered[sub] = {};
    const ms = this.state.mastered[sub];
    ms[qId] = !ms[qId];
    Store.set('mastered', this.state.mastered);

    const btn = $(`mb-${qId}`);
    if (btn) {
      btn.textContent = ms[qId] ? '✓ Mastered!' : '+ Mark as Mastered';
      btn.classList.toggle('mastered', ms[qId]);
    }

    // Update mastered count
    const allMs = Object.values(ms).filter(Boolean).length;
    $('study-mastered-count').textContent = `${allMs} mastered`;
    $('study-progress-text').textContent = `${allMs} / ${this.state.studyAllQuestions.length} mastered`;

    // Refresh card for mastered badge
    const card = $(`sc-${qId}`);
    if (card) {
      const meta = card.querySelector('.study-card-meta');
      const existing = meta.querySelector('.mastered-badge');
      if (ms[qId] && !existing) {
        const badge = document.createElement('span');
        badge.className = 'mastered-badge';
        badge.textContent = '✓ Mastered';
        meta.appendChild(badge);
      } else if (!ms[qId] && existing) {
        existing.remove();
      }
    }
  },

  /* ── HISTORY ─────────────────────────────────────────────────── */
  showHistory(subject) {
    const meta = SUBJECT_META[subject];
    $('history-title').textContent = `Past Results — ${meta.label}`;

    const history = Store.get(`history_${subject}`, []);
    const list = $('history-list');
    const empty = $('history-empty');
    list.innerHTML = '';

    if (!history.length) {
      list.style.display = 'none';
      empty.style.display = 'block';
    } else {
      list.style.display = '';
      empty.style.display = 'none';

      history.forEach((h, i) => {
        const grade = getGrade(h.score);
        const date = new Date(h.date).toLocaleDateString('en-NG', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <div>
            <div class="history-date">${date}</div>
            <div class="history-meta">${h.correct}✅ ${h.wrong}❌ ${h.skipped}⬜ · ${formatTimeSpent(h.timeSpent || 0)}</div>
          </div>
          <div style="text-align:right">
            <div class="history-score">${h.score}%</div>
            <span class="grade-badge ${grade.cls}">${h.grade}</span>
          </div>
        `;
        list.appendChild(item);
      });
    }

    this.showScreen('history');
  },

  /* ── DASHBOARD STATS ─────────────────────────────────────────── */
  updateDashboardStats() {
    const subjects = ['physics', 'chemistry', 'mathematics', 'english', 'biology'];
    let totalAttempts = 0;
    let allScores = [];

    subjects.forEach(sub => {
      const h = Store.get(`history_${sub}`, []);
      totalAttempts += h.length;
      allScores = allScores.concat(h.map(x => x.score));
    });

    $('stat-total-attempts').textContent = totalAttempts;

    if (allScores.length) {
      $('stat-best-score').textContent = Math.max(...allScores) + '%';
      $('stat-avg-score').textContent = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) + '%';
    } else {
      $('stat-best-score').textContent = '—';
      $('stat-avg-score').textContent = '—';
    }
  },

  /* ── KEYBOARD NAVIGATION ─────────────────────────────────────── */
  handleKeydown(e) {
    if (this.state.mode !== 'exam') return;
    // Don't intercept if inside an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'ArrowRight': case 'PageDown': this.nextQuestion(); break;
      case 'ArrowLeft':  case 'PageUp':   this.prevQuestion(); break;
      case '1': this.selectAnswer(this.state.currentQ, 'A'); break;
      case '2': this.selectAnswer(this.state.currentQ, 'B'); break;
      case '3': this.selectAnswer(this.state.currentQ, 'C'); break;
      case '4': this.selectAnswer(this.state.currentQ, 'D'); break;
      case 'm': case 'M': this.toggleMarkReview(); break;
      case 'Escape': this.togglePalette(false); break;
    }
  },
};

/* ================================================================
   BOOT
================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Verify question bank loaded
  if (!window.CBT_QB) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                  font-family:sans-serif;text-align:center;padding:2rem;color:#f0f2ff;
                  background:#0d0f1a">
        <div>
          <div style="font-size:3rem;margin-bottom:1rem">⚠️</div>
          <h1>Question Bank Not Found</h1>
          <p style="color:#9ba3c4;margin-top:0.5rem">Please ensure <code>questions.js</code> is in the same folder as <code>index.html</code>.</p>
        </div>
      </div>`;
    return;
  }
  CBT.init();
});

/* Expose globally for inline onclick handlers */
window.CBT = CBT;
