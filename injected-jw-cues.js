// injected-jw-cues.js
// MAIN world. Lee los TextTrack cues del <video> de JW Player cuando
// content-skilljar.js lo pide. Necesario porque algunos tracks solo son
// visibles/poblados en el contexto de la página, no en el world aislado.

(function () {
  "use strict";
  const REQ = "skilljar-jw-request-cues";
  const RES = "skilljar-jw-response-cues";

  const readTracks = () => {
    const videos = document.querySelectorAll("video");
    const out = [];
    for (const v of videos) {
      const tracks = v.textTracks;
      if (!tracks) continue;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        // Forzar modo "showing" temporalmente para que el navegador pueble cues.
        const prevMode = t.mode;
        try {
          if (t.mode === "disabled") t.mode = "hidden";
        } catch {}
        const cues = t.cues;
        const cueArr = [];
        if (cues) {
          for (let j = 0; j < cues.length; j++) {
            const c = cues[j];
            cueArr.push({
              start: c.startTime,
              end: c.endTime,
              text: c.text || "",
            });
          }
        }
        out.push({
          kind: t.kind || "",
          label: t.label || "",
          language: t.language || "",
          mode: prevMode,
          cueCount: cueArr.length,
          cues: cueArr,
        });
      }
    }
    return out;
  };

  window.addEventListener(REQ, function () {
    try {
      const tracks = readTracks();
      window.dispatchEvent(
        new CustomEvent(RES, { detail: { tracks } })
      );
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent(RES, { detail: { tracks: [], error: String(e) } })
      );
    }
  });
})();
