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
        <div class="upload-zone" id="upload-zone" role="button" tabindex="0" aria-label="Upload audio or video file">
          <input type="file" id="file-input" accept="audio/*,video/quicktime,video/mp4,.mov,.mp4" hidden>
          <div class="upload-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p class="upload-primary">Drop audio file here</p>
          <p class="upload-secondary">or <span class="link">browse files</span></p>
          <p class="upload-hint">MP3, WAV, OGG, M4A, FLAC, MOV, MP4</p>
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
        <video id="video-player" controls class="audio-player hidden" style="width:100%;max-height:220px;border-radius:8px;"></video>
        <div class="panel-actions">
          <button id="analyze-btn" class="btn btn-primary">Analyze</button>
        </div>
      </div>

      <div id="result-panel" class="panel hidden">
        <h2 class="panel-title">Result</h2>
        <div id="result-content" class="result-content"></div>
      </div>
    `;
  }

  // The 19 model classes, used to build the "dispute" dropdown. Pulled from the
  // loaded classifier when available so it always matches the model's output.
  // Also includes "No Frogs Present" as the first option (value: empty string).
  function speciesOptions(selected) {
    const labels = (window.Classifier?.labels && window.Classifier.labels.length)
      ? window.Classifier.labels
      : Object.keys(selected || {});
    const noFrogs = '<option value="">No Frogs Present</option>';
    const species = labels.slice().sort((a, b) => a.localeCompare(b))
      .map(sp => `<option value="${escHtml(sp)}">${escHtml(formatSpecies(sp))}</option>`)
      .join('');
    return noFrogs + species;
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
      file.type.startsWith('video/') ||
      /\.(mp3|wav|ogg|oga|m4a|flac|aac|webm|mp4|mov|3gp|mpga)$/i.test(file.name || '');
  }

  function handleFile(file) {
    if (!_isAudioFile(file)) {
      _showToast("That doesn’t look like an audio or video file — try MP3, WAV, M4A, OGG, FLAC or MOV.");
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

  function _isVideoFile(file) {
    return !!(file && (file.type.startsWith('video/') ||
      /\.(mov|mp4|3gp|webm)$/i.test(file.name || '')));
  }

  function showAudioPreview(url, name) {
    const previewEl = document.getElementById('audio-preview');
    if (!previewEl) return;
    if (currentObjectUrl && currentObjectUrl !== url) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = url;

    const useVideo = _isVideoFile(currentFile || audioBlob);
    const audioEl = document.getElementById('audio-player');
    const videoEl = document.getElementById('video-player');

    const activePlayer = useVideo ? videoEl : audioEl;
    const inactivePlayer = useVideo ? audioEl : videoEl;

    if (inactivePlayer) { inactivePlayer.src = ''; inactivePlayer.classList.add('hidden'); }
    if (activePlayer) {
      activePlayer.src = url;
      activePlayer.classList.remove('hidden');
      activePlayer.addEventListener('loadedmetadata', () => {
        if (currentDuration === null && !isNaN(activePlayer.duration)) {
          currentDuration = activePlayer.duration;
        }
      }, { once: true });
    }

    const fnEl = document.getElementById('audio-filename');
    if (fnEl) fnEl.textContent = name;
    previewEl.classList.remove('hidden');
    document.getElementById('result-panel').classList.add('hidden');
    currentEntryId = null;
  }

  function clearAudio() {
    const player = document.getElementById('audio-player');
    if (player) player.src = '';
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) { videoPlayer.src = ''; videoPlayer.classList.add('hidden'); }
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    ['audio-preview', 'result-panel'].forEach(id =>
      document.getElementById(id)?.classList.add('hidden')
    );
    audioBlob = null; currentFile = null; currentFileName = null; currentEntryId = null;
    currentDuration = null;
  }

  // ── Loading Indicator ─────────────────────────────────
  function showLoadingOverlay() {
    document.getElementById('top-loader')?.classList.add('active');
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
    document.getElementById('top-loader')?.classList.remove('active');
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
      // 5% chance this observation is "holo" — decided once, at creation, so it
      // stays stable. Holographic card rendering comes later.
      const isHolo = Math.random() < 0.05;

      const entry = Store.addEntry({
        type: audioBlob ? 'recording' : 'upload',
        name: currentFileName || 'Audio',
        is_holo: isHolo,
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

      // Let the header feedback modal link itself to this analysis.
      window.__efrogLastObs = {
        id: entry.id, species: apiResult.species, confidence: apiResult.confidence,
      };

      window.DB?.insertObservation({
        id:            entry.id,
        type:          audioBlob ? 'recording' : 'upload',
        name:          currentFileName || 'Audio',
        duration:      currentDuration,
        species:       apiResult.species,
        confidence:    apiResult.confidence,
        probabilities: apiResult.probabilities,
        is_holo:       isHolo,
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

      // Record every observation straight to Supabase as it happens (anonymous
      // included), mirroring the feedback/contacts path. Best-effort: a failure
      // never blocks the result. Carries the stable contact id and, if signed in,
      // the Auth0 user id so logged-in retrieval can find it.
      (async () => {
        let userId = '';
        try { userId = (await window.Auth?.getUser())?.sub ?? ''; } catch {}
        window.DB?.sendObservation({
          id:                String(entry.id),
          user_id:           userId,
          contact_id:        window.DB?.getContactId() ?? '',
          username:          '',
          created_at:        entry.timestamp,
          type:              entry.type,
          name:              entry.name,
          duration:          currentDuration != null ? Number(currentDuration) : null,
          species:           apiResult.species,
          confidence:        apiResult.confidence,
          probabilities:     JSON.stringify(apiResult.probabilities ?? {}),
          is_holo:           isHolo,
          mel_spectrogram:   apiResult.mel ?? '',
          included_feedback: false,
          feedback:          null,
          species_name:      null,
        }).catch(() => {});
      })();

      const THRESHOLD = 0.90;
      const sorted    = Object.entries(apiResult.probabilities).sort(([, a], [, b]) => b - a);
      const confident = sorted.filter(([, p]) => p >= THRESHOLD);
      const lowConf   = sorted.filter(([, p]) => p < THRESHOLD);

      const cardsHtml = confident.length
        ? `<div class="tcg-pack">${confident.map(([sp, p], i) => cardHtml(sp, p, i)).join('')}</div>`
        : `<div class="result-species">
             <div class="result-species-name result-uncertain">No confident match</div>
             <div class="result-confidence-badge confidence-low">Nothing scored above ${Math.round(THRESHOLD * 100)}%</div>
           </div>`;

      const lowHtml = lowConf.length ? `
        <div class="lowconf">
          <h3 class="lowconf-title">Low Confidence IDs</h3>
          <div class="result-probabilities">
            ${lowConf.map(([sp, p]) => `
              <div class="prob-row">
                <span class="prob-label">${formatSpecies(sp)}</span>
                <div class="prob-bar-wrap">
                  <div class="prob-bar" data-width="${(p * 100).toFixed(1)}%"></div>
                </div>
                <span class="prob-pct">${(p * 100).toFixed(1)}%</span>
              </div>
            `).join('')}
          </div>
        </div>` : '';

      resultContent.innerHTML = cardsHtml + lowHtml + obsFeedbackHtml(apiResult);

      // Animate low-confidence bars in after DOM paint
      requestAnimationFrame(() => {
        resultContent.querySelectorAll('.prob-bar').forEach(bar => {
          bar.style.width = bar.dataset.width;
        });
      });

      // Wire each card's dismiss (fly-away) animation
      resultContent.querySelectorAll('.tcg-card-close').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const card = btn.closest('.tcg-card');
          if (!card) return;
          card.classList.add('tcg-card-dismiss');
          card.addEventListener('animationend', () => card.remove(), { once: true });
        });
      });

      wireObsFeedback(resultContent, entry.id, apiResult.species);
    }

    analyzeBtn.disabled    = false;
    analyzeBtn.textContent = 'Analyze again';

    // Results front and center before anything else
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Per-observation feedback (agree / dispute / not now) ──────────────
  // Sits under the result cards. The moment the user picks an option it's
  // written to the observation row in Supabase — agree confirms the model's
  // ID, dispute records the species they pick instead, not-now opts out.
  function obsFeedbackHtml(apiResult) {
    return `
      <div class="obs-feedback" id="obs-feedback">
        <p class="obs-feedback-q">Was this identification right?</p>
        <div class="obs-feedback-opts">
          <button type="button" class="obs-fb-btn obs-fb-agree" data-fb="agree">
            <span aria-hidden="true">👍</span> Agree
          </button>
          <button type="button" class="obs-fb-btn obs-fb-dispute" data-fb="dispute">
            <span aria-hidden="true">✏️</span> Dispute
          </button>
          <button type="button" class="obs-fb-btn obs-fb-skip" data-fb="none">Not now</button>
        </div>
        <div class="obs-feedback-dispute hidden">
          <label class="obs-feedback-label" for="obs-fb-species">Which species was it?</label>
          <select id="obs-fb-species" class="obs-feedback-select">
            ${speciesOptions(apiResult.probabilities)}
          </select>
        </div>
        <p class="obs-feedback-done hidden" role="status"></p>
      </div>
    `;
  }

  function wireObsFeedback(root, entryId, predictedSpecies) {
    const wrap = root.querySelector('#obs-feedback');
    if (!wrap) return;
    const opts     = wrap.querySelector('.obs-feedback-opts');
    const disputeUI = wrap.querySelector('.obs-feedback-dispute');
    const select   = wrap.querySelector('#obs-fb-species');
    const done     = wrap.querySelector('.obs-feedback-done');

    function finish(verdictText) {
      opts?.classList.add('hidden');
      disputeUI?.classList.add('hidden');
      if (done) { done.textContent = verdictText; done.classList.remove('hidden'); }
    }

    function save({ included, feedback, speciesName }) {
      window.DB?.updateObservationFeedback({
        id: entryId,
        included_feedback: included,
        feedback,
        species_name: speciesName,
      }).catch(() => {});
      // Mirror onto local history so the Collection shows a correct/incorrect badge
      if (included) {
        Store.updateEntry(entryId, {
          feedback: { verdict: feedback ? 'correct' : 'incorrect', species_name: speciesName },
        });
      }
    }

    wrap.querySelectorAll('.obs-fb-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.fb;
        if (kind === 'agree') {
          save({ included: true, feedback: true, speciesName: predictedSpecies });
          finish('Thanks — glad we got it right!');
        } else if (kind === 'dispute') {
          wrap.querySelectorAll('.obs-fb-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          disputeUI?.classList.remove('hidden');
          select?.focus();
        } else { // none
          save({ included: false, feedback: null, speciesName: null });
          finish('No problem — maybe next time.');
        }
      });
    });

    // Dispute: append as soon as a species is chosen from the dropdown.
    // Empty string value = "No Frogs Present" (sets species_name to null).
    select?.addEventListener('change', () => {
      const sp = select.value;
      const speciesName = sp === '' ? null : sp;
      const msg = sp ? `Thanks — logged as ${formatSpecies(sp)}.` : 'Thanks — logged as no frogs present.';
      save({ included: true, feedback: false, speciesName });
      finish(msg);
    });
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

  // Stable hue per species so each placeholder card looks distinct but consistent.
  function hueOf(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  // Trading-card for a confident match. The 🐸 art slot is still a placeholder;
  // the frog fact is real per-species content (see store.js).
  function cardHtml(species, prob, i) {
    const name = formatSpecies(species);
    const pct  = (prob * 100).toFixed(0);
    const hue  = hueOf(species);
    const id   = window.frogCatalogId?.(species) ?? '';
    const fact = window.frogFactFor?.(species) ?? '';
    return `
      <div class="tcg-card" style="--i:${i}; --card-hue:${hue};">
        <button class="tcg-card-close" aria-label="Dismiss card">&times;</button>
        <div class="tcg-card-shine"></div>
        <div class="tcg-card-frame">
          <div class="tcg-card-header">
            <span class="tcg-card-title">${escHtml(name)}</span>
            <span class="tcg-card-conf">${pct}%</span>
          </div>
          <div class="tcg-card-art"><span class="tcg-card-frog">🐸</span></div>
          <div class="tcg-card-info">
            <div class="tcg-card-field">
              <span class="tcg-card-label">Identifier</span>
              <span class="tcg-card-value">${escHtml(id)}</span>
            </div>
            <div class="tcg-card-field">
              <span class="tcg-card-label">Frog Fact</span>
              <span class="tcg-card-value tcg-card-fact">${escHtml(fact)}</span>
            </div>
          </div>
          <div class="tcg-card-footer">
            <span>eFrog · Florida</span>
          </div>
        </div>
      </div>
    `;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { render, init };
})();
