const RecordPage = (function () {
  const _local   = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  const API_BASE = _local ? 'http://localhost:5000' : EFROG_API_URL;

  const MAX_UPLOAD_MB = 25;   // keep in sync with MAX_CONTENT_LENGTH in server.py

  // Module-level state
  let mediaRecorder   = null;
  let audioChunks     = [];
  let audioBlob       = null;   // set for recordings
  let recordingMimeType = '';
  let currentFile     = null;   // set for file uploads
  let currentFileName = null;
  let currentEntryId  = null;
  let currentDuration = null;   // seconds; set from recordSeconds or audio loadedmetadata
  let isRecording     = false;
  let recordTimer     = null;
  let recordSeconds   = 0;
  let currentSpecies    = null;
  let currentConfidence = null;

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
        <h2 class="panel-title">Give Feedback</h2>
        <p class="panel-caption">This section is still in development, but you can scream into the void if you want to</p>

        <div class="form-group">
          <label class="form-label" for="fb-name">Name <span class="form-optional">(optional)</span></label>
          <input type="text" id="fb-name" class="form-input" placeholder="Your name">
        </div>

        <div class="form-group">
          <label class="form-label">Accuracy Rating <span class="form-optional">How accurate was the ID?</span></label>
          <div class="rating-wrap">
            <span class="rating-min">0</span>
            <input type="range" min="0" max="10" value="5" id="fb-accuracy" class="rating-slider">
            <span class="rating-max">10</span>
            <span class="rating-val" id="fb-accuracy-val">5</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Site / Interface Rating <span class="form-optional">How's the experience?</span></label>
          <div class="rating-wrap">
            <span class="rating-min">0</span>
            <input type="range" min="0" max="10" value="5" id="fb-site" class="rating-slider">
            <span class="rating-max">10</span>
            <span class="rating-val" id="fb-site-val">5</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Are you a member of FrogWatch?</label>
          <div class="frogwatch-opts">
            <button class="btn frogwatch-opt" data-val="yes">Yes</button>
            <button class="btn frogwatch-opt" data-val="no">No</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="fb-note">Feedback &amp; Suggestions <span class="form-optional">(optional)</span></label>
          <textarea id="fb-note" class="feedback-note" placeholder="Tell us what you think…"></textarea>
        </div>

        <div class="form-group">
          <div class="feedback-public-row">
            <label class="feedback-public-label">
              <input type="checkbox" id="fb-make-public" class="feedback-public-check">
              Make Public
            </label>
            <span class="feedback-public-caption">You're invited to make yourself eligible for feature on our website. As feedback is implemented, some will be selected to celebrate</span>
          </div>
        </div>

        <div class="feedback-row">
          <button id="submit-feedback" class="btn btn-secondary">Submit</button>
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
    currentDuration = null;
    isRecording = false; recordSeconds = 0;

    prewarm();
    setupUpload();
    document.getElementById('record-btn').addEventListener('click', () =>
      isRecording ? stopRecording() : startRecording()
    );
    document.getElementById('clear-audio').addEventListener('click', clearAudio);
    document.getElementById('analyze-btn').addEventListener('click', runAnalysis);
    document.getElementById('fb-accuracy').addEventListener('input', e =>
      (document.getElementById('fb-accuracy-val').textContent = e.target.value)
    );
    document.getElementById('fb-site').addEventListener('input', e =>
      (document.getElementById('fb-site-val').textContent = e.target.value)
    );
    document.querySelectorAll('.frogwatch-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.frogwatch-opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      })
    );
    document.getElementById('submit-feedback').addEventListener('click', submitFeedback);
    document.getElementById('skip-feedback').addEventListener('click', () =>
      document.getElementById('feedback-panel').classList.add('hidden')
    );
  }

  // ── Server pre-warming ────────────────────────────────
  // The API's free-tier host spins down when idle, and waking it (plus loading
  // the model) can take ~a minute — long enough for a first classify to time
  // out. Pinging /health at the first sign of intent (opening this page,
  // touching the upload zone, starting a recording) wakes the server so it's
  // hot by the time the user clicks Analyze.
  let _lastPrewarm = 0;
  function prewarm() {
    if (window.EFROG_LOCAL_INFERENCE) return;   // nothing to wake — model runs locally
    if (!API_BASE) return;
    const now = Date.now();
    if (now - _lastPrewarm < 4 * 60 * 1000) return;   // server stays warm ~15 min
    _lastPrewarm = now;
    fetch(`${API_BASE}/health`).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) prewarm();
  });

  // ── Upload ────────────────────────────────────────────
  function setupUpload() {
    const zone  = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');

    zone.addEventListener('click', () => { prewarm(); input.click(); });
    zone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); prewarm(); input.click(); }
    });
    zone.addEventListener('dragover',  e => { e.preventDefault(); prewarm(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
  }

  function _isAudioFile(file) {
    return file.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|oga|m4a|flac|aac|webm|mp4|3gp|mpga)$/i.test(file.name || '');
  }

  function handleFile(file) {
    if (!_isAudioFile(file)) {
      _showToast('That doesn’t look like an audio file — try MP3, WAV, M4A, OGG or FLAC.');
      return;
    }
    if (file.size === 0) {
      _showToast('That file is empty — try a different recording.');
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      _showToast(`File is too large — the limit is ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    audioBlob       = null;
    currentFile     = file;
    currentFileName = file.name;
    currentDuration = null;
    prewarm();
    showAudioPreview(URL.createObjectURL(file), file.name);
  }

  // ── Recording ─────────────────────────────────────────
  function _bestMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  function _mimeToExt(mime) {
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('ogg')) return 'ogg';
    return 'webm';
  }

  async function startRecording() {
    try {
      prewarm();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      recordingMimeType = _bestMimeType();
      try {
        mediaRecorder = new MediaRecorder(stream, recordingMimeType ? { mimeType: recordingMimeType } : {});
      } catch {
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const actualType = mediaRecorder.mimeType || recordingMimeType || 'audio/webm';
        audioBlob       = new Blob(audioChunks, { type: actualType });
        currentFile     = null;
        currentDuration = recordSeconds;
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
  let currentObjectUrl = null;

  function showAudioPreview(url, name) {
    const previewEl = document.getElementById('audio-preview');
    if (!previewEl) return;
    if (currentObjectUrl && currentObjectUrl !== url) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = url;
    const player = document.getElementById('audio-player');
    if (player) {
      player.src = url;
      player.addEventListener('loadedmetadata', () => {
        if (currentDuration === null && !isNaN(player.duration)) {
          currentDuration = player.duration;
        }
      }, { once: true });
    }
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
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    ['audio-preview', 'result-panel', 'feedback-panel'].forEach(id =>
      document.getElementById(id)?.classList.add('hidden')
    );
    audioBlob = null; currentFile = null; currentFileName = null; currentEntryId = null;
    currentDuration = null;
  }

  // ── Loading Indicator ─────────────────────────────────
  function showLoadingOverlay() {
    const loader = document.createElement('div');
    loader.id        = 'analyze-overlay';
    loader.className = 'analyze-loader';
    loader.innerHTML = `
      <div class="analyze-loader-scene">
        <div class="analyze-loader-pad"></div>
        <div class="analyze-loader-frog">🐸</div>
        <div class="analyze-loader-ripple"></div>
        <div class="analyze-loader-ripple analyze-loader-ripple-2"></div>
      </div>
      <span class="analyze-loader-text">loading</span>
    `;
    const resultPanel = document.getElementById('result-panel');
    resultPanel.parentNode.insertBefore(loader, resultPanel);
  }

  function hideLoadingOverlay() {
    const loader = document.getElementById('analyze-overlay');
    if (!loader) return Promise.resolve();
    loader.classList.add('loader-exiting');
    return new Promise(resolve => setTimeout(() => { loader.remove(); resolve(); }, 1100));
  }

  // ── Classification ────────────────────────────────────
  async function classifyAudio() {
    const payload = audioBlob || currentFile;
    if (!payload) throw new Error('No audio loaded');

    // Local (in-browser) inference: no server, no timeout. Falls through to the
    // server path only if EFROG_LOCAL_INFERENCE is off.
    if (window.EFROG_LOCAL_INFERENCE && window.Classifier) {
      if (window.Classifier.status() === 'error') {
        throw new Error('The classifier model failed to load — check your connection and reload');
      }
      const sub = document.querySelector('.overlay-subtitle');
      if (window.Classifier.status() !== 'ok' && sub) sub.textContent = 'Loading model…';
      return await window.Classifier.classify(payload);
    }

    if (!API_BASE) throw new Error('API not configured — set EFROG_API_URL in js/config.js');

    const formData = new FormData();
    const filename = audioBlob ? `recording.${_mimeToExt(audioBlob.type)}` : currentFile.name;
    formData.append('audio', payload, filename);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    let sawWakingServer = false;

    try {
      // 503 means the server is awake but the model is still loading (e.g. it
      // just woke from idle) — retry within our 90 s budget instead of failing.
      while (true) {
        const response = await fetch(`${API_BASE}/classify`, {
          method: 'POST',
          body:   formData,
          signal: controller.signal,
        });

        if (response.status === 503) {
          sawWakingServer = true;
          const sub = document.querySelector('.overlay-subtitle');
          if (sub) sub.textContent = 'Server is waking up — hang tight…';
          await new Promise(resolve => setTimeout(resolve, 2500));
          continue;
        }

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `Server error ${response.status}`);
        }

        return await response.json();
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(sawWakingServer
          ? 'The server is still waking up — please try again in a moment'
          : 'Request timed out — classification is taking too long');
      }
      if (err.name === 'TypeError') {
        throw new Error(_local
          ? 'Cannot reach server — run: python server.py'
          : 'Cannot reach server — please try again');
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

    showLoadingOverlay();

    let apiResult = null;
    let apiError  = null;

    const minWait = new Promise(resolve => setTimeout(resolve, 600));

    try {
      apiResult = await classifyAudio();
    } catch (err) {
      apiError = err.message || 'Classification failed';
    }

    await minWait;
    await hideLoadingOverlay();

    if (!document.getElementById('result-panel')) return;

    const resultPanel   = document.getElementById('result-panel');
    const resultContent = document.getElementById('result-content');
    resultPanel.classList.remove('hidden');

    if (apiError) {
      resultContent.innerHTML = `
        <div class="result-placeholder">
          <div class="result-badge result-badge-error">Error</div>
          <p class="result-hint">${escHtml(apiError)}</p>
          ${_local ? '<p class="result-hook">Start the server with <code>python server.py</code></p>' : ''}
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

      currentSpecies    = apiResult.species;
      currentConfidence = apiResult.confidence;

      window.DB?.insertObservation({
        id:            entry.id,
        type:          audioBlob ? 'recording' : 'upload',
        name:          currentFileName || 'Audio',
        duration:      currentDuration,
        species:       apiResult.species,
        confidence:    apiResult.confidence,
        probabilities: apiResult.probabilities,
      }).then(async () => {
        try {
          if (await window.Auth?.isAuthenticated()) {
            const [token, user] = await Promise.all([
              window.Auth.getToken(),
              window.Auth.getUser(),
            ]);
            await window.DB.sync(token, user?.name ?? user?.email ?? '');
          }
        } catch {}
      }).catch(() => {});

      const CONFIDENCE_THRESHOLD = 0.90;
      const confident = apiResult.confidence >= CONFIDENCE_THRESHOLD;
      const pct = (apiResult.confidence * 100).toFixed(1);

      const probBars = Object.entries(apiResult.probabilities)
        .sort(([, a], [, b]) => b - a)
        .map(([sp, p]) => `
          <div class="prob-row">
            <span class="prob-label">${formatSpecies(sp)}</span>
            <div class="prob-bar-wrap">
              <div class="prob-bar ${confident && sp === apiResult.species ? 'prob-bar-top' : ''}"
                   data-width="${(p * 100).toFixed(1)}%"></div>
            </div>
            <span class="prob-pct">${(p * 100).toFixed(1)}%</span>
          </div>
        `).join('');

      resultContent.innerHTML = confident ? `
        <div class="result-species">
          <div class="result-species-name">${formatSpecies(apiResult.species)}</div>
          <div class="result-confidence-badge confidence-high">${pct}% confidence</div>
        </div>
        <div class="result-probabilities">${probBars}</div>
      ` : `
        <div class="result-species">
          <div class="result-species-name result-uncertain">No confident match</div>
          <div class="result-confidence-badge confidence-low">Below 90% threshold</div>
        </div>
        <div class="result-probabilities">${probBars}</div>
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

    // Scroll result panel into view after a brief paint delay
    requestAnimationFrame(() => {
      resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    if (!apiError) {
      const feedbackPanel = document.getElementById('feedback-panel');
      if (feedbackPanel) {
        // Reset form values so re-analysis gets a fresh form
        const acc  = feedbackPanel.querySelector('#fb-accuracy');
        const site = feedbackPanel.querySelector('#fb-site');
        if (feedbackPanel.querySelector('#fb-name'))      feedbackPanel.querySelector('#fb-name').value = '';
        if (acc)  { acc.value  = 5; feedbackPanel.querySelector('#fb-accuracy-val').textContent = '5'; }
        if (site) { site.value = 5; feedbackPanel.querySelector('#fb-site-val').textContent = '5'; }
        if (feedbackPanel.querySelector('#fb-note'))      feedbackPanel.querySelector('#fb-note').value = '';
        if (feedbackPanel.querySelector('#fb-make-public')) feedbackPanel.querySelector('#fb-make-public').checked = false;
        feedbackPanel.querySelectorAll('.frogwatch-opt').forEach(b => b.classList.remove('selected'));
        if (Store.getFeedbackMode()) {
          feedbackPanel.classList.remove('hidden');
          feedbackPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }

  // ── Feedback ──────────────────────────────────────────
  async function submitFeedback() {
    const name           = (document.getElementById('fb-name')?.value || '').trim();
    const accuracyRating = parseInt(document.getElementById('fb-accuracy')?.value ?? '5', 10);
    const siteRating     = parseInt(document.getElementById('fb-site')?.value ?? '5', 10);
    const frogwatchEl    = document.querySelector('.frogwatch-opt.selected');
    const frogwatch      = frogwatchEl?.dataset.val ?? '';
    const note           = (document.getElementById('fb-note')?.value || '').trim();

    let userId = null;
    try { userId = (await Auth?.getUser())?.sub ?? null; } catch {}

    const contactId  = window.DB?.getContactId() ?? '';
    const makePublic = document.getElementById('fb-make-public')?.checked ?? false;

    window.DB?.insertFeedback({
      observationId:  currentEntryId,
      userId,
      contactId,
      name,
      accuracyRating,
      siteRating,
      frogwatch,
      note,
      species:    currentSpecies,
      confidence: currentConfidence,
      userAgent:  navigator.userAgent,
      makePublic,
    }).catch(() => {});

    document.getElementById('feedback-panel')?.classList.add('hidden');
    _showToast('Feedback submitted — thank you!');
  }

  // ── Helpers ───────────────────────────────────────────
  function _showToast(msg) {
    const t = document.createElement('div');
    t.className = 'feedback-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      t.classList.add('toast-exit');
      t.addEventListener('animationend', () => t.remove(), { once: true });
    }, 2500);
  }

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
