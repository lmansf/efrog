const AboutPage = {
  render() {
    return `
      <h1 class="page-title">About</h1>

      <p class="about-lead">
        efrog is a sound analysis tool — upload or record audio and run it through a
        machine learning classification model.
      </p>

      <div class="about-section">
        <h2>How it works</h2>
        <ol>
          <li>Go to <strong>Analyze</strong> and drop in an audio file or record directly from your microphone.</li>
          <li>Click <strong>Analyze</strong> to run the audio through the model.</li>
          <li>View the classification result. If Feedback Mode is on, rate its accuracy.</li>
          <li>Revisit all past analyses on the <strong>History</strong> page.</li>
        </ol>
      </div>

      <div class="about-section">
        <h2>Feedback Mode</h2>
        <p>
          The <strong>Feedback Mode</strong> button in the top-right corner toggles a prompt
          that appears after each classification. When active, you can mark a result as correct
          or incorrect and leave an optional note. Feedback is stored locally alongside each
          history entry and can inform future model improvements.
        </p>
      </div>

      <div class="about-section">
        <h2>Privacy</h2>
        <p>
          All history is stored in your browser's local storage — nothing is sent to external
          servers unless the ML model integration requires it. Clearing browser data will
          remove your history.
        </p>
      </div>

      <div class="about-section">
        <h2>ML model</h2>
        <p>
          The classification model has not been connected yet. Look for the clearly-marked
          integration block inside <code>js/pages/record.js</code> to wire in your model.
        </p>
      </div>
    `;
  },

  init() {},
};
