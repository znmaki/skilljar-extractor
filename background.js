// background.js v3
const LOCAL = "http://localhost:9099";
const TIMEOUT = 45000;

// Token compartido con el servidor para autenticar las llamadas.
// Este token NO es un secreto criptográfico, solo evita que cualquier página web
// aleatoria llame a tu servidor local. La extensión lo pasa en cada request.
const AUTH_TOKEN = "skilljar-local-2026";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Skilljar → Claude Extractor v3 instalada");
});

// ---------- Helpers ----------
async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    // Token solo para el servidor local; no añadirlo a URLs externas
    // (CDNs, etc.) para no enviar headers raros.
    const isLocal = String(url).startsWith(LOCAL);
    const headers = {
      ...(opts.headers || {}),
      ...(isLocal ? { "X-Skilljar-Token": AUTH_TOKEN } : {}),
    };
    const res = await fetch(url, { ...opts, headers, signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function checkServer() {
  try {
    const res = await fetchWithTimeout(`${LOCAL}/health`, {}, 3000);
    return res.ok;
  } catch {
    return false;
  }
}

// Pequeño guard: si el server no está vivo, retornar un error claro
// sin hacer el fetch que va a fallar feo.
async function requireServer() {
  const up = await checkServer();
  if (!up) {
    return {
      ok: false,
      error:
        "Servidor local offline. Abre una terminal y ejecuta: python server.py",
    };
  }
  return { ok: true };
}

// ---------- Endpoints del servidor ----------
async function getTranscript(videoId, options = {}) {
  const guard = await requireServer();
  if (!guard.ok) return { ...guard, videoId };

  const langs = (options.preferredLangs || ["en", "en-US", "es", "es-ES"]).join(",");
  try {
    const res = await fetchWithTimeout(
      `${LOCAL}/transcript?videoId=${videoId}&langs=${encodeURIComponent(langs)}`
    );
    if (!res.ok) {
      return { ok: false, error: `Servidor respondió ${res.status}`, videoId };
    }
    return await res.json();
  } catch (e) {
    return { ok: false, error: `Error servidor: ${e.message}`, videoId };
  }
}

async function saveFile(rootFolder, courseName, lessonName, content) {
  const guard = await requireServer();
  if (!guard.ok) return guard;

  try {
    const res = await fetchWithTimeout(
      `${LOCAL}/save`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootFolder, courseName, lessonName, content }),
      },
      10000
    );
    if (!res.ok) {
      return { ok: false, error: `Servidor respondió ${res.status}` };
    }
    return await res.json();
  } catch (e) {
    return { ok: false, error: `Error al guardar: ${e.message}` };
  }
}

async function openFolder(path) {
  const guard = await requireServer();
  if (!guard.ok) return guard;

  try {
    const res = await fetchWithTimeout(
      `${LOCAL}/open-folder?path=${encodeURIComponent(path)}`,
      {},
      3000
    );
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- Puente de mensajes ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "CHECK_SERVER") {
    checkServer().then((up) => sendResponse({ up }));
    return true;
  }
  if (msg.type === "GET_YOUTUBE_TRANSCRIPTS") {
    console.log("[bg] GET_YOUTUBE_TRANSCRIPTS recibido, ids:", msg.videoIds);
    Promise.all(
      (msg.videoIds || []).map((id) => getTranscript(id, msg.options || {}))
    )
      .then((results) => {
        console.log("[bg] Resultados listos:", results);
        sendResponse(results);
      })
      .catch((e) => {
        console.error("[bg] Error resolviendo transcripts:", e);
        sendResponse(
          (msg.videoIds || []).map((id) => ({
            ok: false,
            error: `Error background: ${e.message}`,
            videoId: id,
          }))
        );
      });
    return true;
  }
  if (msg.type === "SAVE_FILE") {
    saveFile(msg.rootFolder, msg.courseName, msg.lessonName, msg.content).then(
      sendResponse
    );
    return true;
  }
  if (msg.type === "OPEN_FOLDER") {
    openFolder(msg.path).then(sendResponse);
    return true;
  }
  // Proxy genérico de fetch para evadir CORS. Usado por content-skilljar.js
  // cuando el fetch desde la página falla (p.ej. tracks de JW Player en CDN
  // con ACL *, que son incompatibles con credentials:"include").
  if (msg.type === "FETCH_TEXT") {
    (async () => {
      try {
        const res = await fetchWithTimeout(msg.url, { method: "GET" }, 15000);
        const text = await res.text();
        sendResponse({ ok: res.ok, status: res.status, text });
      } catch (e) {
        sendResponse({ ok: false, error: e.message, text: "" });
      }
    })();
    return true;
  }
});
