// content-jwplayer.js
// Content script (world aislado) que:
//  1. Inyecta injected-jwplayer.js en el MAIN world para hookear fetch/XHR.
//  2. Escucha el CustomEvent "skilljar-jw-caption" para saber cuándo llega un VTT.
//  3. Expone una función global __skilljarGetJWCaptions() que lee
//     window.__skilljarJWCaptions del MAIN world vía un segundo CustomEvent.
//
// No hace parsing del VTT aquí — eso lo hace content-skilljar.js.

(function () {
  "use strict";

  // Inyectar los scripts en el MAIN world. En MV3, un content script en world
  // aislado no puede modificar el fetch que la página ve. Skilljar tiene un
  // CSP estricto (script-src 'self'), así que NO podemos usar scripts inline
  // vía .textContent — ambos tienen que ser archivos externos declarados como
  // web_accessible_resources.
  const injectFile = (file) => {
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL(file);
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => s.remove();
    } catch (e) {
      console.warn(`[jw-extractor] No se pudo inyectar ${file}:`, e);
    }
  };
  injectFile("injected-jwplayer.js");
  injectFile("injected-jw-responder.js");
  injectFile("injected-jw-cues.js");
  injectFile("injected-jw-api.js");

  const REQ = "skilljar-jw-request-captions";
  const RES = "skilljar-jw-response-captions";
  const REQ_CUES = "skilljar-jw-request-cues";
  const RES_CUES = "skilljar-jw-response-cues";
  const REQ_API = "skilljar-jw-request-api-captions";
  const RES_API = "skilljar-jw-response-api-captions";

  // API que content-skilljar.js invoca desde el world aislado.
  window.__skilljarGetJWCaptions = function (timeoutMs) {
    timeoutMs = timeoutMs || 1500;
    return new Promise((resolve) => {
      let done = false;
      const onRes = (ev) => {
        if (done) return;
        done = true;
        window.removeEventListener(RES, onRes);
        resolve((ev.detail && ev.detail.captions) || []);
      };
      window.addEventListener(RES, onRes);
      try {
        window.dispatchEvent(new CustomEvent(REQ));
      } catch {}
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener(RES, onRes);
        resolve([]);
      }, timeoutMs);
    });
  };

  // API paralela para leer los TextTrack cues del <video>. JW Player a veces
  // no hace fetch del .vtt sino que inyecta los cues directamente en la
  // TextTrack API. Leer desde el DOM es más robusto que el fetch-hook.
  window.__skilljarGetJWCues = function (timeoutMs) {
    timeoutMs = timeoutMs || 1500;
    return new Promise((resolve) => {
      let done = false;
      const onRes = (ev) => {
        if (done) return;
        done = true;
        window.removeEventListener(RES_CUES, onRes);
        resolve((ev.detail && ev.detail.tracks) || []);
      };
      window.addEventListener(RES_CUES, onRes);
      try {
        window.dispatchEvent(new CustomEvent(REQ_CUES));
      } catch {}
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener(RES_CUES, onRes);
        resolve([]);
      }, timeoutMs);
    });
  };

  // API para pedirle al MAIN world que consulte la API de JW Player y nos
  // devuelva el contenido del track de captions preferido (descargado desde
  // la página para que las credenciales/cookies se incluyan).
  window.__skilljarGetJWApiCaptions = function (timeoutMs) {
    timeoutMs = timeoutMs || 5000;
    return new Promise((resolve) => {
      let done = false;
      const onRes = (ev) => {
        if (done) return;
        done = true;
        window.removeEventListener(RES_API, onRes);
        resolve((ev.detail && ev.detail) || { ok: false, tracks: [] });
      };
      window.addEventListener(RES_API, onRes);
      try {
        window.dispatchEvent(new CustomEvent(REQ_API));
      } catch {}
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener(RES_API, onRes);
        resolve({ ok: false, tracks: [], error: "timeout" });
      }, timeoutMs);
    });
  };

  // Log cuando lleguen captions (para debug en la consola de la página).
  window.addEventListener("skilljar-jw-caption", (ev) => {
    console.log("[jw-extractor] VTT capturado:", ev.detail && ev.detail.url);
  });
})();
