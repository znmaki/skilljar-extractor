// injected-jw-responder.js
// Corre en el MAIN world. Escucha "skilljar-jw-request-captions" y responde
// con el array window.__skilljarJWCaptions que llena injected-jwplayer.js.
// Separado en archivo propio porque el CSP de Skilljar bloquea scripts inline.

(function () {
  "use strict";
  const REQ = "skilljar-jw-request-captions";
  const RES = "skilljar-jw-response-captions";
  window.addEventListener(REQ, function () {
    const caps = window.__skilljarJWCaptions || [];
    try {
      window.dispatchEvent(
        new CustomEvent(RES, {
          detail: {
            captions: caps.map((c) => ({ url: c.url, text: c.text })),
          },
        })
      );
    } catch (e) {}
  });
})();
