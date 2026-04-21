// injected-jwplayer.js
// Se inyecta en el MAIN world de la página (no en el world aislado del content script)
// para poder hookear el `fetch` y `XHR` reales que usa JW Player.
// Captura respuestas .vtt (WebVTT) y las publica en window.__skilljarJWCaptions.
// El content-script las lee vía CustomEvent.

(function () {
  "use strict";
  if (window.__skilljarJWHookInstalled) return;
  window.__skilljarJWHookInstalled = true;

  const captions = [];
  window.__skilljarJWCaptions = captions;

  const isVttUrl = (url) => {
    if (!url) return false;
    const u = String(url).toLowerCase();
    // Excluir thumbnail strips de JW Player: /strips/*.vtt solo mapea sprites.
    if (u.includes("/strips/")) return false;
    return u.includes(".vtt") || u.includes("format=vtt") || u.includes("text/vtt");
  };

  const isVttContent = (text) => {
    if (!text || typeof text !== "string") return false;
    if (!/^\s*WEBVTT/i.test(text.slice(0, 200))) return false;
    // Excluir VTTs cuyo cue body es solo un sprite de imagen
    // (jpg#xywh=... es el formato de thumbnails de JW).
    const sample = text.slice(0, 2000);
    if (/\.(jpg|jpeg|png|webp)#xywh=/i.test(sample)) return false;
    return true;
  };

  const publish = (url, text) => {
    if (!isVttContent(text)) return;
    // Evitar duplicados por URL
    if (captions.some((c) => c.url === url)) return;
    captions.push({ url, text, capturedAt: Date.now() });
    try {
      window.dispatchEvent(
        new CustomEvent("skilljar-jw-caption", { detail: { url } })
      );
    } catch {}
  };

  // Hook fetch
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      const p = origFetch.apply(this, arguments);
      if (isVttUrl(url)) {
        p.then((res) => {
          try {
            res
              .clone()
              .text()
              .then((t) => publish(url, t))
              .catch(() => {});
          } catch {}
        }).catch(() => {});
      }
      return p;
    };
  }

  // Hook XHR
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR) {
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (method, url) {
      this.__skilljarUrl = url;
      return origOpen.apply(this, arguments);
    };
    OrigXHR.prototype.send = function () {
      const url = this.__skilljarUrl;
      if (isVttUrl(url)) {
        this.addEventListener("load", () => {
          try {
            const txt = this.responseText;
            if (txt) publish(url, txt);
          } catch {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
