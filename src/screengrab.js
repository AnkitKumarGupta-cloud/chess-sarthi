// Takes one picture of the teacher's shared screen and reads the chess position in it (in a worker, so the class video keeps running).
import { useEffect } from "react";
import { Track } from "livekit-client";

const MAX = 1920; // bigger pictures are scaled down first; plenty for reading a board

// The newest picture taken while the teacher was on another tab. When the whole screen is shared,
// the live picture at the moment of the click shows this class page, so this one is used instead.
let away = null; // { img, at }

function screenTrack(room) {
  const pub = room && room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
  const t = pub && pub.track && pub.track.mediaStreamTrack;
  return t && t.readyState === "live" ? t : null;
}

async function frameOf(track) {
  // Chrome and Edge: grab straight from the camera/screen track
  if (typeof ImageCapture !== "undefined") {
    try { const bmp = await new ImageCapture(track).grabFrame(); return toImage(bmp, bmp.width, bmp.height); } catch {}
  }
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([track]);
  try {
    await v.play();
    if (!v.videoWidth) await new Promise((ok) => { v.onloadeddata = ok; setTimeout(ok, 1500); });
    await new Promise((ok) => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => ok()) : setTimeout(ok, 200)));
    return toImage(v, v.videoWidth, v.videoHeight);
  } finally { v.pause(); v.srcObject = null; }
}

function toImage(src, w, h) {
  if (!w || !h) throw new Error("empty picture");
  const f = Math.min(1, MAX / Math.max(w, h)), W = Math.round(w * f), H = Math.round(h * f);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, W, H);
  if (src.close) src.close();
  const d = g.getImageData(0, 0, W, H);
  return { data: d.data, width: W, height: H };
}

// Keep a recent picture of the shared screen while the teacher is away from the class tab (teacher only).
export function useAwaySnapshots(room, on) {
  useEffect(() => {
    if (!on) return;
    let timer = 0, busy = false;
    const snap = async () => {
      const t = screenTrack(room);
      if (!t || busy || !document.hidden) return;
      busy = true;
      try { away = { img: await frameOf(t), at: Date.now() }; } catch {} finally { busy = false; }
    };
    const vis = () => {
      clearInterval(timer);
      if (document.hidden) { setTimeout(snap, 400); timer = setInterval(snap, 1500); }
    };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); clearInterval(timer); };
  }, [room, on]);
}

// Returns a picture to read. Uses the screen being shared; if nothing is shared, asks the browser for one picture of a window or tab.
export async function grabBoardPicture(room) {
  const t = screenTrack(room);
  if (t) {
    const surface = (t.getSettings && t.getSettings().displaySurface) || "";
    if (surface === "monitor" && away && Date.now() - away.at < 15 * 60 * 1000) return { img: away.img, from: "away" };
    return { img: await frameOf(t), from: "share" };
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error("This browser can't take a picture of the screen.");
  const st = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try { return { img: await frameOf(st.getVideoTracks()[0]), from: "pick" }; }
  finally { st.getTracks().forEach((x) => x.stop()); }
}

let worker = null;
export function readBoardPicture(img) {
  if (!worker) worker = new Worker(new URL("./scanworker.js", import.meta.url), { type: "module" });
  return new Promise((ok, bad) => {
    const done = (e) => { worker.removeEventListener("message", done); worker.removeEventListener("error", fail); e.data && e.data.error ? bad(new Error(e.data.error)) : ok(e.data); };
    const fail = (e) => { worker.removeEventListener("message", done); worker.removeEventListener("error", fail); worker.terminate(); worker = null; bad(new Error(e.message || "The board reader stopped.")); };
    worker.addEventListener("message", done); worker.addEventListener("error", fail);
    const copy = new Uint8ClampedArray(img.data); // keep the original for "read again"
    worker.postMessage({ data: copy, width: img.width, height: img.height }, [copy.buffer]);
  });
}
