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
          Classification runs entirely in your browser — your audio never leaves your device to
          be identified. Your history stays in your browser's local storage; only if you sign in
          do your results sync to the project's research dataset. Clearing browser data removes
          your local history.
        </p>
      </div>

      <div class="about-section">
        <h2>ML model</h2>
        <p>
          Identification is done by a convolutional neural network trained on research-grade
          frog recordings from iNaturalist. The model is downloaded once and runs locally: your
          audio is converted to a mel spectrogram — an image of which frequencies occur when —
          and the network scores how likely each species' call is present. Because there's no
          server in the loop, the first prediction is as fast as the next.
        </p>
      </div>
    `;
  },

  init() {},
};
