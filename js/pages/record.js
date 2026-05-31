const RecordPage = (function () {
  const API_BASE = 'http://localhost:5000';

  // Module-level state
  let mediaRecorder   = null;
  let audioChunks     = [];
  let audioBlob       = null;   // set for recordings
  let currentFile     = null;   // set for file uploads
  let currentFileName = null;
  let currentEntryId  = null;
  let isRecording     = false;
  let recordTimer     = null;
  let recordSeconds   = 0;
  let factInterval    = null;
  let factIndex       = 0;

  const FROG_FACTS = [
    "There are over 7,000 known species of frogs worldwide.",
    "Frogs absorb water through their skin — they never actually drink it.",
    "The glass frog has a transparent belly, so you can see its beating heart.",
    "Some frogs survive winter by freezing solid and thawing out in spring.",
    "A group of frogs is called an army.",
    "The golden poison dart frog holds enough toxin to kill 10 adult humans.",
    "Frogs were among the first land animals to evolve vocal cords.",
    "The Goliath frog of Cameroon can weigh over 3 kg — as heavy as a small cat.",
    "Most frogs can jump up to 20 times their own body length.",
    "Tree frogs have sticky toe pads that can support their full body weight.",
    "The mimic poison frog carries its tadpoles on its back to individual pools.",
    "Some desert frogs can stay dormant underground for up to 7 years waiting for rain.",
  ];

  // ── Render ────────────────────────────────────────────
  function render() {
    return `
      <h1 class="page-title">Analyze Sound</h1>

      <div class="input-row">
        <div class="upload-zone" id="upload-zone" role="button" tabindex="0" aria-label="Upload audio file">
          <input type="file" id="file-input" accept="audio/*" hidden>
          <div class="upload-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p class="upload-primary">Drop audio file here</p>
          <p class="upload-secondary">or <span class="link">browse files</span></p>
          <p class="upload-hint">MP3, WAV, OGG, M4A, FLAC</p>
        </div>

        <div class="input-divider"><span>or</span></div>

        <div class="record-zone">
          <button id="record-btn" class="record-btn" aria-label="Start recording"></button>
          <p id="record-label" class="record-label">Record audio</p>
          <p id="record-timer" class="record-timer hidden">0:00</p>
        </div>
      </div>

      <div id="audio-preview" class="panel hidden">
        <div class="panel-header">
          <h2 class="panel-title">Preview</h2>
          <button id="clear-audio" class="btn btn-ghost btn-sm">Remove</button>
        </div>
        <p id="audio-filename" class="audio-filename"></p>
        <audio id="audio-player" controls class="audio-player"></audio>
        <div class="panel-actions">
          <button id="analyze-btn" class="btn btn-primary">Analyze</button>
        </div>
      </div>

      <div id="result-panel" class="panel hidden">
        <h2 class="panel-title">Result</h2>
        <div id="result-content" class="result-content"></div>
      </div>

      <div id="feedback-panel" class="panel panel-feedback hidden">
        <h2 class="panel-title">Feedback</h2>
        <p class="feedback-prompt">Was this classification correct?</p>
        <div class="feedback-options" id="feedback-options">
          <button class="btn btn-success feedback-opt" data-val="correct">✓ Correct</button>
          <button class="btn btn-outline-danger feedback-opt" data-val="incorrect">✗ Incorrect</button>
        </div>
        <textarea id="feedback-note" class="feedback-note" placeholder="Optional note…"></textarea>
        <div class="feedback-row">
          <button id="submit-feedback" class="btn btn-secondary">Submit Feedback</button>
          <button id="skip-feedback" class="btn btn-ghost btn-sm">Skip</button>
        </div>
      </div>
    `;
  }

  // ── Init ──────────────────────────────────────────────
  function init() {
    if (isRecording) stopRecording();
    clearInterval(recordTimer);
    audioBlob = null; currentFile = null; currentFileName = null; currentEntryId = null;
    isRecording = false; recordSeconds = 0;

    setupUpload();
    document.getElementById('record-btn').addEventListener('click', () =>
      isRecording ? stopRecording() : startRecording()
    );
    document.getElementById('clear-audio').addEventListener('click', clearAudio);
    document.getElementById('analyze-btn').addEventListener('click', runAnalysis);
    document.querySelectorAll('.feedback-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.feedback-opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      })
    );
    document.getElementById('submit-feedback').addEventListener('click', submitFeedback);
    document.getElementById('skip-feedback').addEventListener('click', () =>
      document.getElementById('feedback-panel').classList.add('hidden')
    );
  }

  // ── Upload ────────────────────────────────────────────
  function setupUpload() {
    const zone  = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('audio/')) handleFile(file);
    });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
  }

  function handleFile(file) {
    audioBlob     = null;
    currentFile   = file;
    currentFileName = file.name;
    showAudioPreview(URL.createObjectURL(file), file.name);
  }

  // ── Recording ─────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        audioBlob     = new Blob(audioChunks, { type: 'audio/webm' });
        currentFile   = null;
        const name    = `Recording — ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        currentFileName = name;
        showAudioPreview(URL.createObjectURL(audioBlob), name);
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start(100);
      isRecording   = true;
      recordSeconds = 0;
      setRecordUI(true);

      recordTimer = setInterval(() => {
        recordSeconds++;
        const el = document.getElementById('record-timer');
        if (el) el.textContent = fmtTime(recordSeconds);
      }, 1000);
    } catch {
      const label = document.getElementById('record-label');
      if (label) label.textContent = 'Microphone access denied';
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    clearInterval(recordTimer);
    isRecording = false;
    setRecordUI(false);
  }

  function setRecordUI(recording) {
    const btn   = document.getElementById('record-btn');
    const label = document.getElementById('record-label');
    const timer = document.getElementById('record-timer');
    if (!btn) return;
    btn.classList.toggle('recording', recording);
    btn.setAttribute('aria-label', recording ? 'Stop recording' : 'Start recording');
    if (label) label.textContent = recording ? 'Recording… tap to stop' : 'Record audio';
    if (timer) timer.classList.toggle('hidden', !recording);
  }

  // ── Audio preview ─────────────────────────────────────
  function showAudioPreview(url, name) {
    const previewEl = document.getElementById('audio-preview');
    if (!previewEl) return;
    const player = document.getElementById('audio-player');
    if (player) player.src = url;
    const fnEl = document.getElementById('audio-filename');
    if (fnEl) fnEl.textContent = name;
    previewEl.classList.remove('hidden');
    document.getElementById('result-panel').classList.add('hidden');
    document.getElementById('feedback-panel').classList.add('hidden');
    currentEntryId = null;
  }

  function clearAudio() {
    const player = document.getElementById('audio-player');
    if (player) player.src = '';
    ['audio-preview', 'result-panel', 'feedback-panel'].forEach(id =>
      document.getElementById(id)?.classList.add('hidden')
    );
    audioBlob = null; currentFile = null; currentFileName = null; currentEntryId = null;
  }

  // ── Loading Overlay ───────────────────────────────────
  function showLoadingOverlay() {
    factIndex = Math.floor(Math.random() * FROG_FACTS.length);

    const overlay = document.createElement('div');
    overlay.id        = 'analyze-overlay';
    overlay.className = 'analyze-overlay';
    overlay.innerHTML = `
      <div class="overlay-curtain overlay-curtain-top"></div>
      <div class="overlay-curtain overlay-curtain-bottom"></div>
      <div class="overlay-content">
        <div class="overlay-frog-wrap">
          <div class="overlay-ring"></div>
          <div class="overlay-frog">🐸</div>
        </div>
        <h2 class="overlay-title">Identifying species…</h2>
        <p class="overlay-subtitle">Listening for frog calls</p>
        <div class="overlay-fact-card">
          <p class="overlay-fact-label">Did you know?</p>
          <p class="overlay-fact-text" id="overlay-fact-text">${FROG_FACTS[factIndex]}</p>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      overlay.querySelector('.overlay-curtain-top').classList.add('curtain-opening');
      overlay.querySelector('.overlay-curtain-bottom').classList.add('curtain-opening');
    });

    factInterval = setInterval(() => {
      const el = document.getElementById('overlay-fact-text');
      if (!el) return;
      el.classList.add('fact-fade');
      setTimeout(() => {
        factIndex = (factIndex + 1) % FROG_FACTS.length;
        el.textContent = FROG_FACTS[factIndex];
        el.classList.remove('fact-fade');
      }, 300);
    }, 10000);
  }

  function hideLoadingOverlay() {
    clearInterval(factInterval);
    factInterval = null;
    document.body.style.overflow = '';
    const overlay = document.getElementById('analyze-overlay');
    if (!overlay) return;

    const top = overlay.querySelector('.overlay-curtain-top');
    const bot = overlay.querySelector('.overlay-curtain-bottom');
    top.classList.remove('curtain-opening');
    bot.classList.remove('curtain-opening');
    top.classList.add('curtain-closing');
    bot.classList.add('curtain-closing');

    top.addEventListener('animationend', () => overlay.remove(), { once: true });
  }

  // ── Feedback Overlay ──────────────────────────────────
  function showFeedbackOverlay() {
    const overlay = document.createElement('div');
    overlay.id        = 'analyze-overlay';
    overlay.className = 'analyze-overlay';
    overlay.innerHTML = `
      <div class="overlay-curtain overlay-curtain-top"></div>
      <div class="overlay-curtain overlay-curtain-bottom"></div>
      <div class="overlay-content">
        <h2 class="overlay-title">Record Observation</h2>
        <p class="overlay-subtitle">Feedback mode is active</p>
        <div class="overlay-form">
          <label class="form-label">What did you observe?</label>
          <textarea class="form-textarea" id="overlay-obs-note" placeholder="Describe what you heard or saw…"></textarea>
          <label class="form-label">Location <span class="form-optional">(optional)</span></label>
          <input class="form-input" type="text" id="overlay-obs-location" placeholder="e.g. Backyard pond">
          <button id="overlay-submit-btn" class="btn btn-primary" style="width:100%;margin-top:4px">Submit Observation</button>
          <button id="overlay-cancel-btn" class="btn btn-ghost btn-sm" style="width:100%">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      overlay.querySelector('.overlay-curtain-top').classList.add('curtain-opening');
      overlay.querySelector('.overlay-curtain-bottom').classList.add('curtain-opening');
    });

    function close(submitted) {
      hideLoadingOverlay();
      const btn = document.getElementById('analyze-btn');
      if (btn) {
        btn.disabled    = false;
        btn.textContent = submitted ? 'Analyze again' : 'Analyze';
      }
    }

    document.getElementById('overlay-submit-btn').addEventListener('click', () => close(true));
    document.getElementById('overlay-cancel-btn').addEventListener('click', () => close(false));
  }

  // ── Classification API ────────────────────────────────
  async function classifyAudio() {
    const payload = audioBlob || currentFile;
    if (!payload) throw new Error('No audio loaded');

    const formData = new FormData();
    const filename = audioBlob ? 'recording.webm' : currentFile.name;
    formData.append('audio', payload, filename);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${API_BASE}/classify`, {
        method: 'POST',
        body:   formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Request timed out — classification is taking too long');
      }
      if (err.name === 'TypeError') {
        throw new Error('Cannot reach server — run: python server.py');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Analysis ──────────────────────────────────────────
  async function runAnalysis() {
    const analyzeBtn = document.getElementById('analyze-btn');
    analyzeBtn.disabled = true;

    if (Store.getFeedbackMode()) {
      showFeedbackOverlay();
      return;
    }

    showLoadingOverlay();

    let apiResult = null;
    let apiError  = null;

    const minWait = new Promise(resolve => setTimeout(resolve, 5000));

    try {
      apiResult = await classifyAudio();
    } catch (err) {
      apiError = err.message || 'Classification failed';
    }

    await minWait;
    hideLoadingOverlay();

    if (!document.getElementById('result-panel')) return;

    const resultPanel   = document.getElementById('result-panel');
    const resultContent = document.getElementById('result-content');
    resultPanel.classList.remove('hidden');

    if (apiError) {
      resultContent.innerHTML = `
        <div class="result-placeholder">
          <div class="result-badge result-badge-error">Error</div>
          <p class="result-hint">${escHtml(apiError)}</p>
          <p class="result-hook">Start the server with <code>python server.py</code></p>
        </div>
      `;
    } else {
      const entry = Store.addEntry({
        type: audioBlob ? 'recording' : 'upload',
        name: currentFileName || 'Audio',
        result: {
          classification: formatSpecies(apiResult.species),
          species:        apiResult.species,
          confidence:     apiResult.confidence,
          probabilities:  apiResult.probabilities,
        },
      });
      currentEntryId = entry.id;

      const pct = (apiResult.confidence * 100).toFixed(1);
      const confidenceClass =
        apiResult.confidence >= 0.70 ? 'confidence-high' :
        apiResult.confidence >= 0.40 ? 'confidence-mid'  : 'confidence-low';

      const probBars = Object.entries(apiResult.probabilities)
        .sort(([, a], [, b]) => b - a)
        .map(([sp, p]) => `
          <div class="prob-row">
            <span class="prob-label">${formatSpecies(sp)}</span>
            <div class="prob-bar-wrap">
              <div class="prob-bar ${sp === apiResult.species ? 'prob-bar-top' : ''}"
                   data-width="${(p * 100).toFixed(1)}%"></div>
            </div>
            <span class="prob-pct">${(p * 100).toFixed(1)}%</span>
          </div>
        `).join('');

      resultContent.innerHTML = `
        <div class="result-species">
          <div class="result-species-name">${formatSpecies(apiResult.species)}</div>
          <div class="result-confidence-badge ${confidenceClass}">${pct}% confidence</div>
        </div>
        <div class="result-probabilities">
          ${probBars}
        </div>
      `;

      // Animate bars in after DOM paint
      requestAnimationFrame(() => {
        resultContent.querySelectorAll('.prob-bar').forEach(bar => {
          bar.style.width = bar.dataset.width;
        });
      });
    }

    analyzeBtn.disabled    = false;
    analyzeBtn.textContent = 'Analyze again';
  }

  // ── Feedback ──────────────────────────────────────────
  function submitFeedback() {
    const selected = document.querySelector('.feedback-opt.selected');
    if (!selected) {
      const opts = document.getElementById('feedback-options');
      opts.classList.add('shake');
      setTimeout(() => opts.classList.remove('shake'), 400);
      return;
    }

    if (currentEntryId !== null) {
      Store.updateEntry(currentEntryId, {
        feedback: {
          verdict:   selected.dataset.val,
          note:      document.getElementById('feedback-note').value.trim(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    document.getElementById('feedback-panel').innerHTML = `
      <div class="feedback-thanks">
        <span class="check-icon">✓</span>
        <p>Feedback recorded — thank you!</p>
      </div>
    `;
  }

  // ── Helpers ───────────────────────────────────────────
  function fmtTime(secs) {
    return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
  }

  function formatSpecies(raw) {
    return String(raw).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { render, init };
})();
