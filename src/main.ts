import "./style.css";

import { CommitStrategy, RealtimeConnection, RealtimeEvents, Scribe } from "@elevenlabs/client";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { html, render } from "lit";
import { WikiSpyApi } from "./wiki-spy-api";

const LOCAL_STORAGE_KEY = "elevenlabs_api_key";
const INACTIVITY_DELAY = 800;

const wikiSpyApi = new WikiSpyApi();

interface DisplayedCutout {
  cutoutId: number;
  title: string;
  description: string;
  pageUrl: string;
  imageUrl: string;
  license: string;
  licenseUrl: string;
  artist: string;
}

let apiKey = localStorage.getItem(LOCAL_STORAGE_KEY) || "";
let statusText = "Idle";
let isStartDisabled = false;
let isStopDisabled = true;
let eventLogs: string[] = [];

let activeConnection: RealtimeConnection | null = null;
let lastCommittedId: string | null = null;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

let currentQueryText = "";
let displayedQuery = "";
let lastProcessedQuery = "";
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeRequestId = 0;

let displayedItems: DisplayedCutout[] = [];
let isFetchingNewContent = false;

function renderApp(): void {
  const appEl = document.getElementById("app");
  if (!appEl) return;

  render(
    html`
      <h1>Wiki-Spy Explorer</h1>

      <section>
        <h2>ElevenLabs Connection</h2>
        <p>
          <label for="apiKey">API Key: </label>
          <input type="password" id="apiKey" placeholder="Enter API Key" size="45" .value=${apiKey} @input=${onApiKeyInput} />
        </p>
        <p>
          <button id="startBtn" ?disabled=${isStartDisabled} @click=${startSession}>Start Recording</button>
          <button id="stopBtn" ?disabled=${isStopDisabled} @click=${stopSession}>Stop Recording</button>
        </p>
        <p>Status: <strong>${statusText}</strong></p>
      </section>

      <hr />

      <section>
        <h2>Live Query</h2>
        <p>
          <label for="queryInput">Latest Text (Voice transcript or manual edit): </label>
          <input type="text" id="queryInput" placeholder="Speak or type search query..." size="50" .value=${currentQueryText} @input=${onQueryInput} />
        </p>
      </section>

      <hr />

      <section>
        <h2>Wiki-Spy Cutout Search Results (Top 4) ${isFetchingNewContent ? html` <em>(Fetching new results...)</em>` : ""}</h2>

        ${displayedQuery ? html`<p>Showing results for: <strong>${displayedQuery}</strong></p>` : ""}
        ${
          displayedItems.length > 0
            ? html`
                <div style="display: flex; flex-wrap: wrap; gap: 16px;">
                  ${displayedItems.map(
                    (item) => html` <img src=${item.imageUrl} alt=${item.title} style="max-width: 250px; max-height: 250px; object-fit: contain;" /> `,
                  )}
                </div>
              `
            : html`<p>No results displayed yet. Speak into the microphone or type above to search.</p>`
        }
      </section>

      <hr />

      <section>
        <h2>Event Log</h2>
        <ul>
          ${eventLogs.map((log) => html`<li>${log}</li>`)}
        </ul>
      </section>
    `,
    appEl,
  );
}

function onApiKeyInput(e: Event): void {
  const target = e.target as HTMLInputElement | null;
  if (target) {
    apiKey = target.value;
    localStorage.setItem(LOCAL_STORAGE_KEY, apiKey.trim());
  }
}

function onQueryInput(e: Event): void {
  const target = e.target as HTMLInputElement | null;
  if (target) {
    currentQueryText = target.value;
    renderApp();
    handleTranscriptUpdate(currentQueryText, false);
  }
}

function handleTranscriptUpdate(text: string, isCommitted = false): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  if (isCommitted) {
    fetchWikiSpyResults(trimmed);
  } else {
    searchDebounceTimer = setTimeout(() => {
      fetchWikiSpyResults(trimmed);
    }, 250);
  }
}

async function fetchWikiSpyResults(query: string): Promise<void> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery === lastProcessedQuery) {
    return;
  }

  const requestId = ++activeRequestId;
  isFetchingNewContent = true;
  renderApp();

  try {
    const data = await wikiSpyApi.search({ q: normalizedQuery, limit: 4 });

    if (requestId !== activeRequestId) {
      return;
    }

    const results = data.results || [];

    const newItems: DisplayedCutout[] = await Promise.all(
      results.map(async (obj) => {
        let imageUrl = obj.url;
        try {
          const imgRes = await fetch(obj.url);
          if (imgRes.ok) {
            const blob = await imgRes.blob();
            imageUrl = URL.createObjectURL(blob);
          }
        } catch (e) {
          console.warn("Failed to fetch image blob, using direct URL:", e);
        }

        return {
          cutoutId: obj.cutoutId,
          title: obj.title,
          description: obj.description || obj.extract || "",
          pageUrl: obj.pageUrl || obj.articleUrl || obj.imageDescUrl,
          imageUrl,
          license: obj.license,
          licenseUrl: obj.licenseUrl,
          artist: obj.artist,
        };
      }),
    );

    if (requestId !== activeRequestId) {
      newItems.forEach((item) => {
        if (item.imageUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.imageUrl);
        }
      });
      return;
    }

    displayedItems.forEach((item) => {
      if (item.imageUrl.startsWith("blob:")) {
        URL.revokeObjectURL(item.imageUrl);
      }
    });

    displayedItems = newItems;
    displayedQuery = normalizedQuery;
    lastProcessedQuery = normalizedQuery;
  } catch (err) {
    console.error("Error fetching Wiki-Spy cutouts:", err);
  } finally {
    if (requestId === activeRequestId) {
      isFetchingNewContent = false;
      renderApp();
    }
  }
}

async function startSession(): Promise<void> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    alert("Please enter a valid ElevenLabs API key.");
    return;
  }

  isStartDisabled = true;
  statusText = "Requesting single-use token...";
  renderApp();

  try {
    const elevenlabs = new ElevenLabsClient({ apiKey: trimmedKey });
    const tokenResponse = await elevenlabs.tokens.singleUse.create("realtime_scribe");
    const token =
      typeof tokenResponse === "string"
        ? tokenResponse
        : (tokenResponse as { token?: string; value?: string }).token || (tokenResponse as { token?: string; value?: string }).value || String(tokenResponse);

    statusText = "Connecting to ElevenLabs Scribe Realtime...";
    renderApp();

    activeConnection = Scribe.connect({
      token,
      modelId: "scribe_v2_realtime",
      languageCode: "en",
      commitStrategy: CommitStrategy.MANUAL,
      includeTimestamps: true,
      microphone: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    setupConnectionHandlers(activeConnection);
  } catch (err: unknown) {
    console.error("Initialization error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    statusText = `Error: ${errorMessage}`;
    isStartDisabled = false;
    isStopDisabled = true;
    renderApp();
  }
}

function setupConnectionHandlers(connection: RealtimeConnection): void {
  connection.on(RealtimeEvents.OPEN, () => {
    statusText = "Connected to WebSocket.";
    renderApp();
  });

  connection.on(RealtimeEvents.SESSION_STARTED, () => {
    statusText = "Recording & Transcribing... Speak into your microphone.";
    isStopDisabled = false;
    renderApp();
  });

  connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
    if (data && data.text) {
      addLog("[partial]", data.text);
      resetInactivityTimer();
      currentQueryText = data.text;
      handleTranscriptUpdate(data.text, false);
    }
  });

  connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
    clearInactivityTimer();
    if (data && data.text) {
      const dataId = (data as { id?: string }).id;
      if (dataId && dataId === lastCommittedId) return;
      lastCommittedId = dataId || null;

      addLog("[commit]", data.text);
      currentQueryText = data.text;
      handleTranscriptUpdate(data.text, true);
    }
  });

  connection.on(RealtimeEvents.ERROR, (error) => {
    console.error("Scribe Realtime Error:", error);
    const msg =
      typeof error === "object" && error !== null
        ? (error as { message?: string; error?: string }).message || (error as { message?: string; error?: string }).error || JSON.stringify(error)
        : String(error);
    statusText = `Error: ${msg}`;
    renderApp();
  });

  connection.on(RealtimeEvents.CLOSE, () => {
    clearInactivityTimer();
    statusText = "Disconnected.";
    isStartDisabled = false;
    isStopDisabled = true;
    activeConnection = null;
    renderApp();
  });
}

function resetInactivityTimer(): void {
  clearInactivityTimer();

  inactivityTimer = setTimeout(() => {
    if (activeConnection) {
      activeConnection.commit();
    }
  }, INACTIVITY_DELAY);
}

function clearInactivityTimer(): void {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

function stopSession(): void {
  clearInactivityTimer();
  if (activeConnection) {
    statusText = "Disconnecting...";
    renderApp();
    try {
      activeConnection.close();
    } catch (e) {
      console.error("Error closing connection:", e);
    }
    activeConnection = null;
  }
  isStartDisabled = false;
  isStopDisabled = true;
  renderApp();
}

function addLog(prefix: string, text: string): void {
  eventLogs.push(`${prefix} ${text}`);
  if (eventLogs.length > 10) {
    eventLogs.shift();
  }
  renderApp();
}

renderApp();
