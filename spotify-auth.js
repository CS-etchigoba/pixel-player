const http = require("node:http");
const crypto = require("node:crypto");
const { shell } = require("electron");
const { clientId, redirectUri } = require("./spotify-config");

// Tokens stay in memory for this session.
let tokens = null;
let loginInProgress = false;

async function connectSpotify() {
  if (loginInProgress) {
    throw new Error("Sign-in is already open in your browser.");
  }

  if (!clientId || clientId === "PASTE_YOUR_CLIENT_ID_HERE") {
    throw new Error("Add your Spotify Client ID to spotify-config.js.");
  }

  loginInProgress = true;

  try {
    tokens = await authorize();
  } finally {
    loginInProgress = false;
  }
}

function authorize() {
  const verifier = crypto.randomBytes(64).toString("base64url");

  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  const state = crypto.randomBytes(32).toString("hex");

  const loginUrl = new URL("https://accounts.spotify.com/authorize");

  loginUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: [
      "user-read-playback-state",
      "user-modify-playback-state"
    ].join(" ")
  }).toString();

  return new Promise(function (resolve, reject) {
    let finished = false;
    let handlingCallback = false;

    function finish(error, result) {
      if (finished) return;

      finished = true;
      clearTimeout(timeout);
      server.close();

      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }

    const server = http.createServer(async function (request, response) {
      const callbackUrl = new URL(request.url, redirectUri);

      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");

      if (callbackUrl.pathname !== "/callback") {
        response.writeHead(404);
        response.end("Not found.");
        return;
      }

      if (
        request.method !== "GET" ||
        callbackUrl.searchParams.get("state") !== state
      ) {
        response.writeHead(400);
        response.end("Invalid login response. Return to Pixel Player.");
        return;
      }

      if (handlingCallback || finished) {
        response.writeHead(409);
        response.end("This login response has already been received.");
        return;
      }

      handlingCallback = true;

      if (callbackUrl.searchParams.has("error")) {
        response.end("Sign-in cancelled. Return to Pixel Player.");
        finish(new Error("Spotify sign-in was cancelled."));
        return;
      }

      const code = callbackUrl.searchParams.get("code");

      if (!code) {
        response.writeHead(400);
        response.end("Missing login code.");
        finish(new Error("Spotify did not return a login code."));
        return;
      }

      try {
        const tokenResponse = await fetch(
          "https://accounts.spotify.com/api/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
              client_id: clientId,
              code_verifier: verifier
            }),
            signal: AbortSignal.timeout(15000)
          }
        );

        if (!tokenResponse.ok) {
          throw new Error(
            `Spotify sign-in failed (${tokenResponse.status}).`
          );
        }

        const result = await tokenResponse.json();

        if (!result.access_token) {
          throw new Error("Spotify did not return an access token.");
        }

        response.end(
          "Spotify connected! You can close this tab and return to Pixel Player."
        );

        finish(null, result);
      } catch (error) {
        response.writeHead(500);
        response.end("Sign-in failed. Return to Pixel Player and try again.");
        finish(error);
      }
    });

    const timeout = setTimeout(function () {
      finish(new Error("Sign-in timed out. Please try connecting again."));
    }, 180000);

    server.on("error", function (error) {
      const message = error.code === "EADDRINUSE"
        ? "Port 8888 is busy. Close other Pixel Player instances and try again."
        : "Could not start the local sign-in listener.";

      finish(new Error(message));
    });

    server.listen(8888, "127.0.0.1", function () {
      shell.openExternal(loginUrl.toString()).catch(finish);
    });
  });
}

// Stop requests temporarily if Spotify asks us to wait.
let retryAfterTime = 0;

async function refreshAccessToken() {
  if (!tokens?.refresh_token) {
    throw new Error("Please reconnect Spotify.");
  }

  const response = await fetch(
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  if (!response.ok) {
    throw new Error("Your session could not be renewed. Reconnect Spotify.");
  }

  const updated = await response.json();

  tokens = {
    ...tokens,
    ...updated,
    refresh_token: updated.refresh_token || tokens.refresh_token
  };
}

async function getPlayback() {
  if (!tokens?.access_token) {
    throw new Error("Connect Spotify first.");
  }

  if (Date.now() < retryAfterTime) {
    const seconds = Math.ceil((retryAfterTime - Date.now()) / 1000);
    throw new Error(`Spotify asked us to wait. Try again in ${seconds}s.`);
  }

  async function requestPlayback() {
    return fetch("https://api.spotify.com/v1/me/player", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`
      },
      signal: AbortSignal.timeout(15000)
    });
  }

  let response = await requestPlayback();

  // Renew an expired token, then retry once.
  if (response.status === 401) {
    await refreshAccessToken();
    response = await requestPlayback();
  }

  if (response.status === 429) {
    const seconds = Math.max(
      1,
      Number(response.headers.get("Retry-After")) || 60
    );

    retryAfterTime = Date.now() + seconds * 1000;

    throw new Error(`Spotify asked us to wait. Try again in ${seconds}s.`);
  }

  if (response.status === 204) {
    return null;
  }

  if (response.status === 403) {
    throw new Error(
      "Spotify denied playback access. Check the app's user access and reconnect."
    );
  }

  if (!response.ok) {
    throw new Error(`Could not read playback (${response.status}).`);
  }

  const data = await response.json();

  // This first version displays music tracks.
  if (!data.item || data.item.type !== "track") {
    return null;
  }

  return {
    title: data.item.name,
    artist: data.item.artists.map(artist => artist.name).join(", "),
    artwork: data.item.album.images[0]?.url || "",
    duration: data.item.duration_ms,
    progress: data.progress_ms || 0,
    isPlaying: data.is_playing
  };
}

async function controlPlayback(action) {
  const commands = {
    play: { method: "PUT", endpoint: "play" },
    pause: { method: "PUT", endpoint: "pause" },
    next: { method: "POST", endpoint: "next" },
    previous: { method: "POST", endpoint: "previous" }
  };

  if (!Object.hasOwn(commands, action)) {
    throw new Error("Unknown playback command.");
  }

  if (!tokens?.access_token) {
    throw new Error("Connect Spotify first.");
  }

  if (Date.now() < retryAfterTime) {
    const seconds = Math.ceil((retryAfterTime - Date.now()) / 1000);
    throw new Error(`Spotify asked us to wait. Try again in ${seconds}s.`);
  }

  const command = commands[action];

  async function sendCommand() {
    return fetch(
      `https://api.spotify.com/v1/me/player/${command.endpoint}`,
      {
        method: command.method,
        headers: {
          Authorization: `Bearer ${tokens.access_token}`
        },
        signal: AbortSignal.timeout(15000)
      }
    );
  }

  let response = await sendCommand();

  if (response.status === 401) {
    await refreshAccessToken();
    response = await sendCommand();
  }

  if (response.status === 429) {
    const seconds = Math.max(
      1,
      Number(response.headers.get("Retry-After")) || 60
    );

    retryAfterTime = Date.now() + seconds * 1000;

    throw new Error(`Spotify asked us to wait. Try again in ${seconds}s.`);
  }

  if (response.status === 404) {
    throw new Error(
      "No active Spotify device. Start a song in Spotify, then refresh."
    );
  }

  if (response.status === 403) {
    throw new Error(
      "Spotify blocked this action. Reconnect to approve playback controls. Some playback contexts also restrict controls."
    );
  }

  if (!response.ok) {
    throw new Error(`Playback command failed (${response.status}).`);
  }
}

module.exports = {
  connectSpotify,
  getPlayback,
  controlPlayback
};