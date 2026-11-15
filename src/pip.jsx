// The floating class window: a small always-on-top window that shows everyone in the class,
// so the teacher or a student can use another tab without leaving the class.
//  - Chrome, Edge, Opera, Brave on a computer: a real floating window (Document Picture-in-Picture)
//    that can be moved, resized and closed, and opens by itself when you switch tabs.
//  - Other browsers and phones: one picture-in-picture video with everyone drawn into it.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TrackRefContext, TrackToggle, useTracks, useRoomContext } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Tile } from "./tile.jsx";

const docPip = () => (typeof window !== "undefined" && "documentPictureInPicture" in window ? window.documentPictureInPicture : null);
const videoPip = () => typeof document !== "undefined" && (document.pictureInPictureEnabled || typeof HTMLVideoElement.prototype.webkitSetPresentationMode === "function");
export const pipKind = () => (docPip() ? "window" : videoPip() ? "video" : null);

const useCams = () => useTracks(
  [{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }],
  { onlySubscribed: false },
);

// ---------- the floating window (computers) ----------
// The new window starts empty, so it gets a copy of this page's styles.
function copyStyles(from, to) {
  for (const sheet of from.styleSheets) {
    try {
      const style = to.createElement("style");
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join("\n");
      to.head.appendChild(style);
    } catch {
      // A stylesheet from another website (the fonts) can't be read, so it is linked instead.
      if (!sheet.href) continue;
      const link = to.createElement("link");
      link.rel = "stylesheet"; link.href = sheet.href;
      to.head.appendChild(link);
    }
  }
}

function useWindowPip(notify) {
  const [win, setWin] = useState(null);
  const ref = useRef(null);
  const opening = useRef(null);
  const open = useCallback(() => {
    if (ref.current) return Promise.resolve(ref.current);
    if (opening.current) return opening.current;
    opening.current = docPip().requestWindow({ width: 360, height: 430 }).then((w) => {
      copyStyles(document, w.document);
      w.document.title = "Chess Sathi class";
      w.document.documentElement.lang = "en";
      w.document.body.className = "pipbody";
      w.addEventListener("pagehide", () => { ref.current = null; setWin(null); }, { once: true });
      ref.current = w; setWin(w);
      return w;
    }).finally(() => { opening.current = null; });
    return opening.current;
  }, []);
  const close = useCallback(() => { if (ref.current) ref.current.close(); }, []);
  // Chrome calls this by itself when you switch to another tab during a class, and closes the window when you come back.
  useEffect(() => {
    try { navigator.mediaSession.setActionHandler("enterpictureinpicture", () => { open().catch(() => {}); }); } catch {}
    return () => {
      try { navigator.mediaSession.setActionHandler("enterpictureinpicture", null); } catch {}
      if (ref.current) ref.current.close();
    };
  }, [open]);
  const toggle = () => (ref.current ? close() : open().catch((e) => { console.warn("Mini window failed", e); notify("Couldn't open the mini window. Try again.", true); }));
  return { kind: "window", on: !!win, win, open, close, toggle };
}

function PipWindow({ win, close, hands, mine, toggleHand, isTeacher }) {
  const room = useRoomContext();
  const tracks = useCams();
  const share = tracks.find((t) => t.source === Track.Source.ScreenShare && t.publication);
  const cams = tracks.filter((t) => t.source === Track.Source.Camera);
  // Raised hands first, so they are not missed in a small window.
  const order = [...cams].sort((a, b) => (hands[b.participant.identity] ? 1 : 0) - (hands[a.participant.identity] ? 1 : 0));
  const n = order.length;
  // The window can be any shape, so pick the number of columns that keeps tiles closest to a camera's 4:3.
  const [size, setSize] = useState([win.innerWidth, win.innerHeight]);
  useEffect(() => {
    const on = () => setSize([win.innerWidth, win.innerHeight]);
    win.addEventListener("resize", on); return () => win.removeEventListener("resize", on);
  }, [win]);
  let cols = 1, best = Infinity;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), miss = Math.abs(Math.log(((size[0] - 12) / c) / (Math.max(size[1] - 56, 40) / r) / (4 / 3)));
    if (miss < best) { best = miss; cols = c; }
  }
  const back = () => { try { window.focus(); } catch {} close(); };
  return createPortal(
    <div className="pip" data-lk-theme="default">
      {share ? <div className="pip-share"><TrackRefContext.Provider value={share}><Tile /></TrackRefContext.Provider></div> : null}
      <div className={"pip-grid" + (share ? " strip" : "")} style={{ "--cols": cols }}>
        {order.map((t) => (
          <div key={t.participant.identity} className={"pip-tile" + (hands[t.participant.identity] ? " up" : "")}>
            <TrackRefContext.Provider value={t}><Tile /></TrackRefContext.Provider>
          </div>
        ))}
      </div>
      <div className="pip-bar">
        <TrackToggle source={Track.Source.Microphone} showIcon={false} className="pbtn" title="Microphone"><span className="i-on">{P.mic}</span><span className="i-off">{P.micOff}</span></TrackToggle>
        <TrackToggle source={Track.Source.Camera} showIcon={false} className="pbtn" title="Camera"><span className="i-on">{P.cam}</span><span className="i-off">{P.camOff}</span></TrackToggle>
        <button className={"pbtn" + (mine ? " on" : "")} aria-pressed={mine} onClick={toggleHand} title={mine ? "Lower hand" : "Raise hand"} aria-label={mine ? "Lower hand" : "Raise hand"}>{P.hand}</button>
        <button className="pbtn wide" onClick={back} title="Go back to the class tab">{P.back}<span>Back to class</span></button>
        <button className="pbtn leave" onClick={() => { close(); room.disconnect(); }} title={isTeacher ? "End / leave" : "Leave"} aria-label="Leave the class">{P.leave}</button>
      </div>
    </div>,
    win.document.body,
  );
}

// ---------- one video with everyone in it (other browsers, phones) ----------
const HUES = [4, 28, 48, 140, 172, 200, 226, 262, 292, 330];
const W = 640, H = 480;
export function drawEveryone(ctx, cams, share) {
  ctx.fillStyle = "#0B1016"; ctx.fillRect(0, 0, W, H);
  const list = share ? [share, ...cams] : cams;
  const n = list.length || 1;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols);
  const gap = 6, cw = (W - gap * (cols + 1)) / cols, ch = (H - gap * (rows + 1)) / rows;
  list.forEach((t, i) => {
    const x = gap + (i % cols) * (cw + gap), y = gap + Math.floor(i / cols) * (ch + gap);
    const p = t.participant, name = ((p && (p.name || p.identity)) || "?").trim();
    const track = t.publication && !t.publication.isMuted && t.publication.track;
    const el = track && track.attachedElements && track.attachedElements.find((v) => v.videoWidth);
    ctx.save();
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, cw, ch, 10) : ctx.rect(x, y, cw, ch); ctx.clip();
    ctx.fillStyle = "#18222D"; ctx.fillRect(x, y, cw, ch);
    if (el) {
      // Fill the tile without stretching (a shared screen is shown whole).
      const fit = t === share ? Math.min : Math.max;
      const s = fit(cw / el.videoWidth, ch / el.videoHeight), dw = el.videoWidth * s, dh = el.videoHeight * s;
      try { ctx.drawImage(el, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh); } catch {}
    } else {
      let h = 0; for (const c of (p && p.identity) || name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const r = Math.min(cw, ch) * 0.24;
      ctx.fillStyle = `hsl(${HUES[h % HUES.length]} 55% 42%)`;
      ctx.beginPath(); ctx.arc(x + cw / 2, y + ch / 2 - 6, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = `600 ${Math.round(r)}px system-ui,sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((name.match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase(), x + cw / 2, y + ch / 2 - 5);
    }
    const label = (t === share ? name + "'s screen" : name).slice(0, 22);
    ctx.font = "600 13px system-ui,sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(x + 6, y + ch - 26, tw, 20);
    ctx.fillStyle = "#fff"; ctx.fillText(label, x + 12, y + ch - 15);
    ctx.restore();
  });
}
// Browsers slow page timers down in a hidden tab; a timer in a worker keeps ticking.
function ticker(fn, ms) {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: "text/javascript" }));
    const w = new Worker(url); w.onmessage = fn;
    return () => { w.terminate(); URL.revokeObjectURL(url); };
  } catch { const t = setInterval(fn, ms); return () => clearInterval(t); }
}

function useVideoPip(notify) {
  const tracks = useCams();
  const latest = useRef(tracks); latest.current = tracks;
  const [on, setOn] = useState(false);
  const parts = useRef(null);
  const stop = useCallback(() => {
    const p = parts.current; if (!p) return;
    parts.current = null; p.stopTick();
    try { p.stream.getTracks().forEach((t) => t.stop()); } catch {}
    p.video.remove(); setOn(false);
  }, []);
  const close = useCallback(() => {
    const p = parts.current; if (!p) return;
    try {
      if (document.pictureInPictureElement === p.video) document.exitPictureInPicture().catch(() => {});
      else if (p.video.webkitPresentationMode === "picture-in-picture") p.video.webkitSetPresentationMode("inline");
    } catch {}
    stop();
  }, [stop]);
  const open = useCallback(async () => {
    if (parts.current) return;
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      const all = latest.current;
      drawEveryone(ctx, all.filter((t) => t.source === Track.Source.Camera), all.find((t) => t.source === Track.Source.ScreenShare && t.publication));
    };
    draw();
    const stream = canvas.captureStream(12);
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.srcObject = stream; video.className = "pipvideo";
    document.body.appendChild(video);
    parts.current = { video, stream, stopTick: ticker(draw, 90) };
    video.addEventListener("leavepictureinpicture", stop);
    video.addEventListener("webkitpresentationmodechanged", () => { if (video.webkitPresentationMode !== "picture-in-picture") stop(); });
    try {
      await video.play();
      if (video.requestPictureInPicture) await video.requestPictureInPicture();
      else video.webkitSetPresentationMode("picture-in-picture");
      setOn(true);
    } catch (e) { stop(); throw e; }
  }, [stop]);
  useEffect(() => stop, [stop]);
  const toggle = () => (parts.current ? close() : open().catch((e) => { console.warn("Mini window failed", e); notify("This browser couldn't open the mini window.", true); }));
  return { kind: "video", on, win: null, open, close, toggle };
}

// One of the two is chosen once, when the class opens (the browser doesn't change during a class).
const KIND = pipKind();
const none = { kind: null, on: false, win: null, open: async () => {}, close: () => {}, toggle: () => {} };
export const usePip = KIND === "window" ? useWindowPip : KIND === "video" ? useVideoPip : () => none;
export { PipWindow };

// Icons from Lucide (ISC licence).
export const P = {
  pip: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/></svg>,
  app: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>,
  back: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>,
  hand: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>,
  leave: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272"/><path d="M22 2 2 22"/><path d="M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473"/></svg>,
  mic: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/></svg>,
  micOff: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19v3"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M16.95 16.95A7 7 0 0 1 5 12v-2"/><path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/><path d="m2 2 20 20"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/></svg>,
  cam: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>,
  camOff: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/></svg>,
};
