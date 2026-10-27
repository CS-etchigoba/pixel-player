const connectButton = document.getElementById("connect-button");
const refreshButton = document.getElementById("refresh-button");
const connectionMessage = document.getElementById("connection-message");

const songTitle = document.getElementById("song-title");
const artistLabel = document.querySelector(".artist");
const albumArt = document.getElementById("album-art");
const albumPlaceholder = document.querySelector(".album-placeholder");
const progressFill = document.querySelector(".progress-fill");
const timestamps = document.querySelectorAll(".timestamps span");
const modeLabel = document.querySelector(".mode-label");

// These match the buttons' order in index.html.
const [previousButton, playButton, nextButton] =
  document.querySelectorAll(".controls button");

let playbackSnapshot = null;
let snapshotTime = 0;
let automaticUpdatesStarted = false;
let isRefreshing = false;
let commandInProgress = false;

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function updateControls() {
  const disabled =
    !playbackSnapshot ||
    isRefreshing ||
    commandInProgress ||
    connectButton.disabled;

  previousButton.disabled = disabled;
  playButton.disabled = disabled;
  nextButton.disabled = disabled;

  const isPlaying = Boolean(playbackSnapshot?.isPlaying);

  playButton.textContent = isPlaying ? "⏸" : "▶";
  playButton.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
}

function updateProgressDisplay() {
  if (!playbackSnapshot) return;

  const elapsed = playbackSnapshot.isPlaying
    ? Date.now() - snapshotTime
    : 0;

  const progress = Math.min(
    playbackSnapshot.duration,
    playbackSnapshot.progress + elapsed
  );

  const percentage = playbackSnapshot.duration > 0
    ? progress / playbackSnapshot.duration * 100
    : 0;

  progressFill.style.width = `${percentage}%`;
  timestamps[0].textContent = formatTime(progress);
}

function displayPlayback(playback) {
  playbackSnapshot = playback;
  snapshotTime = Date.now();

  if (!playback) {
    songTitle.textContent = "No music track available";
    artistLabel.textContent = "Play a song in Spotify, then refresh.";

    albumArt.hidden = true;
    albumArt.removeAttribute("src");
    albumPlaceholder.hidden = false;

    progressFill.style.width = "0%";
    timestamps[0].textContent = "0:00";
    timestamps[1].textContent = "0:00";

    modeLabel.textContent = "LINKED";
    updateControls();
    return;
  }

  songTitle.textContent = playback.title;
  artistLabel.textContent = playback.artist;

  let artworkUrl = null;

  try {
    const url = new URL(playback.artwork);

    if (url.protocol === "https:" && url.hostname === "i.scdn.co") {
      artworkUrl = url.href;
    }
  } catch {
    // Keep the placeholder if artwork is unavailable.
  }

  albumArt.hidden = !artworkUrl;
  albumPlaceholder.hidden = Boolean(artworkUrl);

  if (artworkUrl) {
    albumArt.src = artworkUrl;
  } else {
    albumArt.removeAttribute("src");
  }

  timestamps[1].textContent = formatTime(playback.duration);
  modeLabel.textContent = playback.isPlaying ? "PLAYING" : "PAUSED";

  updateProgressDisplay();
  updateControls();
}

albumArt.addEventListener("error", function () {
  albumArt.hidden = true;
  albumPlaceholder.hidden = false;
});

async function updatePlayback() {
  if (isRefreshing) return;

  isRefreshing = true;
  refreshButton.disabled = true;
  updateControls();

  connectionMessage.textContent = "Checking Spotify…";

  try {
    const result = await window.spotify.getPlayback();

    if (!result.ok) {
      throw new Error(result.message);
    }

    displayPlayback(result.playback);

    connectionMessage.textContent = result.playback
      ? "Connected to Spotify."
      : "Connected. Start a song in Spotify, then refresh.";
  } catch (error) {
    connectionMessage.textContent = error.message;
  } finally {
    isRefreshing = false;
    refreshButton.disabled = false;
    updateControls();
  }
}

async function sendPlaybackCommand(action) {
  if (commandInProgress || isRefreshing || !playbackSnapshot) return;

  commandInProgress = true;
  refreshButton.disabled = true;
  connectButton.disabled = true;
  updateControls();

  connectionMessage.textContent = "Sending command to Spotify…";

  try {
    const result = await window.spotify.control(action);

    if (!result.ok) {
      throw new Error(result.message);
    }

    // Give Spotify a moment to apply the command before reading playback.
    await new Promise(resolve => setTimeout(resolve, 600));

    await updatePlayback();
  } catch (error) {
    connectionMessage.textContent = error.message;
  } finally {
    commandInProgress = false;
    refreshButton.disabled = false;
    connectButton.disabled = false;
    updateControls();
  }
}

connectButton.addEventListener("click", async function () {
  if (isRefreshing || commandInProgress) return;

  connectButton.disabled = true;
  refreshButton.disabled = true;
  updateControls();

  connectionMessage.textContent =
    "Finish signing in through your browser…";

  try {
    const result = await window.spotify.connect();

    if (!result.ok) {
      throw new Error(result.message);
    }

    connectButton.textContent = "Reconnect Spotify";
    modeLabel.textContent = "LINKED";

    await updatePlayback();
    startAutomaticUpdates();
  } catch (error) {
    connectionMessage.textContent = error.message;
  } finally {
    connectButton.disabled = false;
    updateControls();
  }
});

refreshButton.addEventListener("click", updatePlayback);

previousButton.addEventListener("click", function () {
  sendPlaybackCommand("previous");
});

nextButton.addEventListener("click", function () {
  sendPlaybackCommand("next");
});

playButton.addEventListener("click", function () {
  const action = playbackSnapshot?.isPlaying ? "pause" : "play";
  sendPlaybackCommand(action);
});

function startAutomaticUpdates() {
  if (automaticUpdatesStarted) return;

  automaticUpdatesStarted = true;

  async function checkAgain() {
    try {
      if (
        !isRefreshing &&
        !commandInProgress &&
        !connectButton.disabled
      ) {
        await updatePlayback();
      }
    } finally {
      setTimeout(checkAgain, 15000);
    }
  }

  setTimeout(checkAgain, 15000);
}

setInterval(updateProgressDisplay, 1000);
updateControls();