import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LiveKitRoom, RoomAudioRenderer, StartAudio, ConnectionStateToast, LayoutContextProvider,
  GridLayout, CarouselLayout, FocusLayout, FocusLayoutContainer, TrackToggle, MediaDeviceMenu, Chat,
  useTracks, useParticipants, useRoomContext, useLocalParticipant, useLocalParticipantPermissions,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { RoomEvent, Track } from "livekit-client";
import { BackgroundProcessor, supportsBackgroundProcessors } from "@livekit/track-processors";
import { usePuzzle, TeacherPuzzle, StudentPuzzle } from "./puzzle.jsx";
import { Tile } from "./tile.jsx";
import { usePip, PipWindow, P } from "./pip.jsx";

// ---------- sign-in and API ----------
// The sign-in comes from the website (saved in this browser) or from the mobile app (passed after # in the link).
function getSignIn() {
  const fromApp = new URLSearchParams(location.hash.slice(1)).get("k");
  if (fromApp) {
    try { sessionStorage.setItem("cs.k", fromApp); } catch {}
    history.replaceState(null, "", location.pathname + location.search);
    return fromApp;
  }
  try { const s = sessionStorage.getItem("cs.k"); if (s) return s; } catch {}
  try { return JSON.parse(localStorage.getItem("targetchess.v2") || "{}").liveToken || ""; } catch { return ""; }
}
const signIn = getSignIn();
const classId = new URLSearchParams(location.search).get("c") || "";

async function api(path, body, opts = {}) {
  const r = await fetch("/api" + path, {
    method: "POST", keepalive: !!opts.keepalive,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + signIn },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || "Something went wrong. Please try again."); e.code = j.code; throw e; }
  return j;
}

const canShareScreen = () => typeof navigator !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
  && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ---------- small pieces ----------
// Icons are from Lucide (ISC licence), the same set the main app uses.
const I = {
  hand: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/> <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/> <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/> <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>,
  image: <svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/> <circle cx="9" cy="9" r="2"/> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>,
  chat: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>,
  people: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/> <path d="M16 3.128a4 4 0 0 1 0 7.744"/> <path d="M22 21v-2a4 4 0 0 0-3-3.87"/> <circle cx="9" cy="7" r="4"/></svg>,
  leave: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272"/> <path d="M22 2 2 22"/> <path d="M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473"/></svg>,
  close: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/> <path d="m6 6 12 12"/></svg>,
  chev: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>,
  screen: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 10 3-3 3 3"/> <path d="M12 13V7"/> <rect width="20" height="14" x="2" y="3" rx="2"/> <path d="M12 17v4"/> <path d="M8 21h8"/></svg>,
  puzzle: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>,
  mic: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19v3"/> <path d="M19 10v2a7 7 0 0 1-14 0v-2"/> <rect x="9" y="2" width="6" height="13" rx="3"/></svg>,
  micOff: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19v3"/> <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/> <path d="M16.95 16.95A7 7 0 0 1 5 12v-2"/> <path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/> <path d="m2 2 20 20"/> <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/></svg>,
  cam: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/> <rect x="2" y="6" width="14" height="12" rx="2"/></svg>,
  camOff: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/> <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/> <path d="m2 2 20 20"/></svg>,
};
const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><defs><linearGradient id="cs-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E5525B"/><stop offset="1" stopColor="#B3202B"/></linearGradient></defs><rect width="28" height="28" rx="7" fill="url(#cs-g)"/><g fill="#fff"><circle cx="14" cy="8.5" r="3.7"/><rect x="9.7" y="11.9" width="8.6" height="2.2" rx="1.1"/><path d="M11.4 13h5.2c.2 3.6 1.2 5.9 2.9 7.9h-11c1.7-2 2.7-4.3 2.9-7.9z"/><rect x="7" y="20.2" width="14" height="3" rx="1.5"/></g></svg>
);

function Wait({ title, text, back, spin }) {
  return (
    <div className="wait">
      <Logo />
      {spin ? <div className="spin" aria-hidden="true" /> : null}
      <h1>{title}</h1>
      {text ? <p>{text}</p> : null}
      {back ? <a className="btn" href="/#live">Back to classes</a> : null}
    </div>
  );
}

function useClock(on) {
  const [start] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [on]);
  const s = Math.floor((Date.now() - start) / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? hh + ":" : "") + String(mm).padStart(hh ? 2 : 1, "0") + ":" + String(ss).padStart(2, "0");
}

// ---------- backgrounds ----------
const BACKGROUNDS = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur" },
  { id: "board", label: "Chessboard", img: "/backgrounds/board.jpg" },
  { id: "sunset", label: "Sunset", img: "/backgrounds/sunset.jpg" },
  { id: "study", label: "Calm", img: "/backgrounds/study.jpg" },
  { id: "library", label: "Library", img: "/backgrounds/library.jpg" },
  { id: "chalkboard", label: "Classroom", img: "/backgrounds/chalkboard.jpg" },
  { id: "room", label: "Cosy room", img: "/backgrounds/room.jpg" },
  { id: "sky", label: "Sky", img: "/backgrounds/sky.jpg" },
  { id: "forest", label: "Forest", img: "/backgrounds/forest.jpg" },
  { id: "night", label: "Night sky", img: "/backgrounds/night.jpg" },
];
// MediaPipe's engine is served from this website, so blockers or a slow CDN can't stop it.
const makeProcessor = (delegate) => BackgroundProcessor({
  mode: "disabled",
  assetPaths: { tasksVisionFileSet: location.origin + "/mediapipe" },
  segmenterOptions: { delegate },
});

function useBackground(notify) {
  const { cameraTrack } = useLocalParticipant();
  const proc = useRef(null);
  const [bg, setBg] = useState("none");
  const [busy, setBusy] = useState(false);
  const supported = useMemo(() => { try { return supportsBackgroundProcessors(); } catch { return false; } }, []);

  const pick = async (b) => {
    const track = cameraTrack && cameraTrack.track;
    if (!track) { notify("Turn your camera on first, then pick a background.", true); return false; }
    setBusy(true);
    try {
      if (!proc.current) {
        try { const p = makeProcessor("GPU"); await track.setProcessor(p); proc.current = p; }
        catch (gpuErr) {
          console.warn("Background on GPU failed, trying CPU", gpuErr);
          try { await track.stopProcessor(); } catch {}
          const p = makeProcessor("CPU"); await track.setProcessor(p); proc.current = p;
        }
      }
      if (b.id === "none") await proc.current.switchTo({ mode: "disabled" });
      else if (b.id === "blur") await proc.current.switchTo({ mode: "background-blur", blurRadius: 14 });
      else await proc.current.switchTo({ mode: "virtual-background", imagePath: b.img });
      setBg(b.id);
      return true;
    } catch (e) {
      console.error("Background failed", e);
      proc.current = null;
      try { await track.stopProcessor(); } catch {}
      notify("Couldn't change the background on this device. Try Chrome on a computer.", true);
      return false;
    } finally { setBusy(false); }
  };
  // A new camera track (after switching camera) starts without the effect.
  useEffect(() => { proc.current = null; setBg("none"); }, [cameraTrack && cameraTrack.trackSid]);
  return { bg, pick, busy, supported };
}

// ---------- raise hand ----------
function useHands() {
  const room = useRoomContext();
  const [hands, setHands] = useState({});
  const [mine, setMine] = useState(false);
  useEffect(() => {
    const onData = (payload, participant, _k, topic) => {
      if (topic !== "hand" || !participant) return;
      let m = null; try { m = JSON.parse(new TextDecoder().decode(payload)); } catch {}
      if (!m) return;
      setHands((h) => { const n = { ...h }; if (m.on) n[participant.identity] = Date.now(); else delete n[participant.identity]; return n; });
      if (m.lowerFor === room.localParticipant.identity) setMine(false);
    };
    const onLeft = (p) => setHands((h) => { const n = { ...h }; delete n[p.identity]; return n; });
    room.on(RoomEvent.DataReceived, onData); room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => { room.off(RoomEvent.DataReceived, onData); room.off(RoomEvent.ParticipantDisconnected, onLeft); };
  }, [room]);
  const send = (msg) => room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true, topic: "hand" });
  const toggle = useCallback(() => {
    const on = !mine; setMine(on); send({ on });
    setHands((h) => { const n = { ...h }; if (on) n[room.localParticipant.identity] = Date.now(); else delete n[room.localParticipant.identity]; return n; });
  }, [mine, room]);
  // The teacher can lower someone's hand after answering.
  const lower = (identity) => { send({ on: false, lowerFor: identity }); setHands((h) => { const n = { ...h }; delete n[identity]; return n; }); };
  useEffect(() => { if (!mine) setHands((h) => { const n = { ...h }; delete n[room.localParticipant.identity]; return n; }); }, [mine, room]);
  return { hands, mine, toggle, lower };
}

// ---------- stage ----------
function Stage({ hands }) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false },
  );
  const share = tracks.find((t) => t.source === Track.Source.ScreenShare && t.publication);
  const cams = tracks.filter((t) => t.source === Track.Source.Camera);
  if (share) {
    return (
      <div className="stage stage-share">
        <FocusLayoutContainer>
          <CarouselLayout tracks={cams}><Tile /></CarouselLayout>
          <FocusLayout trackRef={share} />
        </FocusLayoutContainer>
      </div>
    );
  }
  return (
    <div className="stage">
      <GridLayout tracks={cams}><Tile /></GridLayout>
    </div>
  );
}

// ---------- people panel ----------
function People({ hands, isTeacher, lower }) {
  const people = useParticipants();
  const sorted = [...people].sort((a, b) => (hands[b.identity] ? 1 : 0) - (hands[a.identity] ? 1 : 0) || (roleOf(b) === "teacher") - (roleOf(a) === "teacher") || (a.name || "").localeCompare(b.name || ""));
  return (
    <ul className="people">
      {sorted.map((p) => {
        const teacher = roleOf(p) === "teacher";
        const mic = p.isMicrophoneEnabled, cam = p.isCameraEnabled;
        return (
          <li key={p.identity} className={hands[p.identity] ? "up" : ""}>
            <span className="av" aria-hidden="true">{(p.name || "?").trim()[0]?.toUpperCase()}</span>
            <span className="pname">{p.name || p.identity}{p.isLocal ? " (you)" : ""}{teacher ? <em>Teacher</em> : null}</span>
            {hands[p.identity] ? (
              isTeacher && !p.isLocal
                ? <button className="chipbtn" onClick={() => lower(p.identity)} title="Lower this hand">✋ Lower</button>
                : <span className="handflag">✋</span>
            ) : null}
            <span className={"dot" + (mic ? " on" : "")} title={mic ? "Microphone on" : "Microphone off"}>{mic ? "mic" : "muted"}</span>
            <span className={"dot" + (cam ? " on" : "")} title={cam ? "Camera on" : "Camera off"}>{cam ? "cam" : "no cam"}</span>
          </li>
        );
      })}
    </ul>
  );
}
function roleOf(p) { try { return JSON.parse(p.metadata || "{}").role; } catch { return ""; } }

// ---------- the classroom ----------
function Classroom({ pass, notify, recording }) {
  const room = useRoomContext();
  const perms = useLocalParticipantPermissions();
  const people = useParticipants();
  const { hands, mine, toggle, lower } = useHands();
  const bgCtl = useBackground(notify);
  const [panel, setPanel] = useState(null); // "chat" | "people" | "puzzle" (teacher) | null
  const [bgOpen, setBgOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const clock = useClock(true);
  const isTeacher = pass.isTeacher;
  const canPub = (s) => perms && perms.canPublish && (!perms.canPublishSources.length || perms.canPublishSources.includes(s));
  const shareAllowed = isTeacher || canPub(3); // 3 = screen share in LiveKit's permission list (students may share too)
  const shareSupported = canShareScreen();
  const handsUp = Object.keys(hands).length;
  const pz = usePuzzle(isTeacher);
  const pip = usePip(notify);
  // Opens the rest of Chess Sathi in a new tab; the class keeps running here and follows along in the mini window.
  const openApp = async () => {
    if (pip.kind === "window") { if (!pip.on) pip.open().catch(() => {}); } // must be asked for before the new tab
    else if (pip.kind === "video" && !pip.on) await pip.open().catch(() => {});
    if (!window.open("/", "_blank")) notify("Your browser blocked the new tab. Open Chess Sathi in another tab yourself; the class stays on here.", true);
  };

  // Unread chat count while the chat panel is closed.
  useEffect(() => {
    const onChat = () => { if (panel !== "chat") setUnread((n) => n + 1); };
    room.on(RoomEvent.ChatMessage, onChat);
    return () => room.off(RoomEvent.ChatMessage, onChat);
  }, [room, panel]);
  useEffect(() => { if (panel === "chat") setUnread(0); }, [panel]);
  // Tell the teacher when a hand goes up.
  const prevHands = useRef({});
  useEffect(() => {
    if (isTeacher) for (const id of Object.keys(hands)) if (!prevHands.current[id] && id !== room.localParticipant.identity) {
      const p = people.find((x) => x.identity === id); notify("✋ " + ((p && p.name) || "A student") + " raised a hand");
    }
    prevHands.current = hands;
  }, [hands]);

  const togglePanel = (p) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className={"room" + (panel ? " with-panel" : "")}>
      <header className="rtop">
        <div className="rbrand"><Logo /><div><b>{pass.title || "Live class"}</b><span>Chess Sathi</span></div></div>
        <div className="rmeta">
          <span className="live"><i />LIVE <span className="mono">{clock}</span></span>
          {recording ? <span className="rec" title="This class is being recorded">● REC</span> : null}
          <button className="count appbtn" onClick={openApp} title="Use Chess Sathi in another tab without leaving the class">{P.app}<span>Open app</span></button>
          <button className="count" onClick={() => togglePanel("people")} aria-label={people.length + " people in class"}>{I.people}<span>{people.length}</span></button>
        </div>
      </header>

      <div className="rbody">
        <Stage hands={hands} />
        {panel ? (
          <aside className="side" aria-label={panel === "chat" ? "Chat" : panel === "puzzle" ? "Puzzle" : "People"}>
            <div className="sidehead">
              <div className="tabs2" role="tablist">
                <button role="tab" aria-selected={panel === "chat"} onClick={() => setPanel("chat")}>Chat</button>
                <button role="tab" aria-selected={panel === "people"} onClick={() => setPanel("people")}>People ({people.length})</button>
                {isTeacher ? <button role="tab" aria-selected={panel === "puzzle"} onClick={() => setPanel("puzzle")}>Puzzle</button> : null}
              </div>
              <button className="iconbtn" onClick={() => setPanel(null)} aria-label="Close panel">{I.close}</button>
            </div>
            <div className="sidebody">
              {panel === "chat" ? <Chat /> : panel === "puzzle" && isTeacher ? <TeacherPuzzle pz={pz} /> : <People hands={hands} isTeacher={isTeacher} lower={lower} />}
            </div>
          </aside>
        ) : null}
      </div>

      {handsUp && isTeacher && panel !== "people" ? (
        <button className="handsbar" onClick={() => setPanel("people")}>✋ {handsUp} {handsUp === 1 ? "hand" : "hands"} up</button>
      ) : null}

      <footer className="dock">
        <div className="group">
          <div className="combo">
            <TrackToggle source={Track.Source.Microphone} showIcon={false} className="dbtn"><span className="i-on">{I.mic}</span><span className="i-off">{I.micOff}</span><span className="lbl">Mic</span></TrackToggle>
            <MediaDeviceMenu kind="audioinput" className="dmenu" aria-label="Choose microphone" title="Choose microphone">{I.chev}</MediaDeviceMenu>
          </div>
          <div className="combo">
            <TrackToggle source={Track.Source.Camera} showIcon={false} className="dbtn"><span className="i-on">{I.cam}</span><span className="i-off">{I.camOff}</span><span className="lbl">Camera</span></TrackToggle>
            <MediaDeviceMenu kind="videoinput" className="dmenu" aria-label="Choose camera" title="Choose camera">{I.chev}</MediaDeviceMenu>
          </div>
          {shareAllowed ? (
            shareSupported
              ? <TrackToggle source={Track.Source.ScreenShare} captureOptions={{ audio: true, selfBrowserSurface: "include" }} showIcon={false} className="dbtn" onDeviceError={() => notify("Screen sharing was blocked or cancelled.", true)}>{I.screen}<span className="lbl">Share screen</span></TrackToggle>
              : <button className="dbtn" disabled title="Screen sharing works on a computer (Chrome, Edge or Safari)" onClick={() => {}}>{I.screen}<span className="lbl">Share screen</span></button>
          ) : null}
        </div>
        <div className="group">
          <button className={"dbtn" + (mine ? " on" : "")} aria-pressed={mine} onClick={toggle}>{I.hand}<span className="lbl">{mine ? "Lower hand" : "Raise hand"}</span></button>
          {bgCtl.supported ? (
            <div className="popwrap">
              <button className={"dbtn" + (bgOpen ? " on" : "")} aria-expanded={bgOpen} onClick={() => setBgOpen((o) => !o)}>{I.image}<span className="lbl">Background</span></button>
              {bgOpen ? (
                <div className="bgpanel" role="menu">
                  <div className="bghead">Background {bgCtl.busy ? <span className="spin sm" aria-label="Loading" /> : null}</div>
                  <div className="bggrid">
                    {BACKGROUNDS.map((b) => (
                      <button key={b.id} role="menuitemradio" aria-checked={bgCtl.bg === b.id} disabled={bgCtl.busy} className={"bgopt" + (bgCtl.bg === b.id ? " on" : "")} onClick={async () => { if (await bgCtl.pick(b)) setBgOpen(false); }}>
                        <span className={"bgthumb t-" + b.id} style={b.img ? { backgroundImage: `url(${b.img})` } : {}}>{b.id === "none" ? I.close : null}</span>
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {/* Chrome/Edge on a computer open the mini window by themselves on tab switch, so no button there. */}
          {pip.kind === "video" ? <button className={"dbtn" + (pip.on ? " on" : "")} aria-pressed={pip.on} onClick={pip.toggle} title="A small floating window with everyone in the class">{P.pip}<span className="lbl">Mini window</span></button> : null}
          {isTeacher ? <button className={"dbtn" + (panel === "puzzle" ? " on" : "")} aria-pressed={panel === "puzzle"} onClick={() => togglePanel("puzzle")}>{I.puzzle}<span className="lbl">Puzzle</span>{pz.active && !pz.active.ended ? <span className="badge">{Object.values(pz.results).filter((r) => r.status === "ok").length}</span> : null}</button> : null}
          <button className={"dbtn" + (panel === "chat" ? " on" : "")} aria-pressed={panel === "chat"} onClick={() => togglePanel("chat")}>{I.chat}<span className="lbl">Chat</span>{unread ? <span className="badge">{unread}</span> : null}</button>
          <button className={"dbtn hide-sm" + (panel === "people" ? " on" : "")} aria-pressed={panel === "people"} onClick={() => togglePanel("people")}>{I.people}<span className="lbl">People</span>{handsUp ? <span className="badge">{handsUp}</span> : null}</button>
        </div>
        <div className="group">
          <button className="dbtn leave" onClick={() => room.disconnect()}>{I.leave}<span className="lbl">{isTeacher ? "End / leave" : "Leave"}</span></button>
        </div>
      </footer>
      {!isTeacher ? <StudentPuzzle pz={pz} /> : null}
      {pip.win ? <PipWindow win={pip.win} close={pip.close} hands={hands} mine={mine} toggleHand={toggle} isTeacher={isTeacher} /> : null}
      <RoomAudioRenderer />
      <StartAudio label="Tap to turn on sound" className="startaudio" />
      <ConnectionStateToast />
    </div>
  );
}

// Demo logins are shared, so each visitor types their own name before joining.
function NameForm({ onJoin }) {
  const [name, setName] = useState(() => { try { return sessionStorage.getItem("cs.name") || ""; } catch { return ""; } });
  const [busy, setBusy] = useState(false);
  return (
    <form className="wait" onSubmit={(e) => { e.preventDefault(); if (name.trim().length < 2) return; setBusy(true); try { sessionStorage.setItem("cs.name", name.trim()); } catch {} onJoin(name.trim()); }}>
      <Logo />
      <h1>What's your name?</h1>
      <p>Your teacher and classmates will see this name in the class.</p>
      <input className="nameinput" autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
      <button className="btn" type="submit" disabled={busy || name.trim().length < 2}>{busy ? "Joining…" : "Join class"}</button>
    </form>
  );
}

// ---------- before joining: choose mic and camera (like Google Meet) ----------
const AV_KEY = "cs.av";
function savedAv(isTeacher) {
  try { const v = JSON.parse(localStorage.getItem(AV_KEY) || "null"); if (v && typeof v.mic === "boolean" && typeof v.cam === "boolean") return v; } catch {}
  return { mic: !!isTeacher, cam: true };
}
function Lobby({ pass, onJoin }) {
  const [av, setAv] = useState(() => savedAv(pass.isTeacher));
  const [err, setErr] = useState("");
  const [level, setLevel] = useState(0);
  const vid = useRef(null);
  const camStream = useRef(null);
  const micStream = useRef(null);
  const stop = (r) => { if (r.current) { r.current.getTracks().forEach((t) => t.stop()); r.current = null; } };

  // Camera preview
  useEffect(() => {
    if (!av.cam) { stop(camStream); return; }
    let dead = false;
    navigator.mediaDevices.getUserMedia({ video: true }).then((st) => {
      if (dead) { st.getTracks().forEach((t) => t.stop()); return; }
      camStream.current = st; if (vid.current) vid.current.srcObject = st; setErr("");
    }).catch(() => { if (!dead) { setAv((a) => ({ ...a, cam: false })); setErr("We couldn't use your camera. Allow it in the browser's address bar."); } });
    return () => { dead = true; stop(camStream); };
  }, [av.cam]);

  // Microphone level, so you can see it works
  useEffect(() => {
    if (!av.mic) { stop(micStream); setLevel(0); return; }
    let dead = false, ctx = null, raf = 0;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((st) => {
      if (dead) { st.getTracks().forEach((t) => t.stop()); return; }
      micStream.current = st; setErr("");
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const an = ctx.createAnalyser(); an.fftSize = 512;
        ctx.createMediaStreamSource(st).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let m = 0; for (const b of buf) m = Math.max(m, Math.abs(b - 128));
          setLevel(Math.min(1, m / 64)); raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {}
    }).catch(() => { if (!dead) { setAv((a) => ({ ...a, mic: false })); setErr("We couldn't use your microphone. Allow it in the browser's address bar."); } });
    return () => { dead = true; cancelAnimationFrame(raf); if (ctx) ctx.close().catch(() => {}); stop(micStream); };
  }, [av.mic]);

  const flip = (k) => setAv((a) => ({ ...a, [k]: !a[k] }));
  const join = () => {
    stop(camStream); stop(micStream);
    try { localStorage.setItem(AV_KEY, JSON.stringify(av)); } catch {}
    onJoin(av);
  };
  return (
    <div className="lobby">
      <div className="lobby-prev">
        {av.cam ? <video ref={vid} autoPlay playsInline muted /> : <div className="lobby-off">{I.camOff}<span>Camera is off</span></div>}
        <div className="lobby-btns">
          <button type="button" className={"lobby-tg" + (av.mic ? "" : " off")} aria-pressed={av.mic} onClick={() => flip("mic")} title={av.mic ? "Turn off microphone" : "Turn on microphone"}>
            {av.mic ? I.mic : I.micOff}{av.mic ? <span className="lobby-lvl" style={{ transform: "scaleY(" + (0.15 + level * 0.85) + ")" }} /> : null}
          </button>
          <button type="button" className={"lobby-tg" + (av.cam ? "" : " off")} aria-pressed={av.cam} onClick={() => flip("cam")} title={av.cam ? "Turn off camera" : "Turn on camera"}>{av.cam ? I.cam : I.camOff}</button>
        </div>
      </div>
      <div className="lobby-side">
        <h1>Ready to join?</h1>
        <p>{pass.isTeacher ? "Your students will see and hear you as you choose here." : "Choose your microphone and camera. You can change them any time in the class."}</p>
        {err ? <p className="lobby-err" role="alert">{err}</p> : null}
        <button className="btn" type="button" onClick={join}>Join now</button>
        <a className="lobby-back" href="/#live">Back to classes</a>
      </div>
    </div>
  );
}

function App() {
  const [pass, setPass] = useState(null);
  const [needName, setNeedName] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState(null);
  const [left, setLeft] = useState(false);
  const [recording, setRecording] = useState(false);
  const [av, setAv] = useState(null); // chosen in the lobby: { mic, cam }
  const stopped = useRef(false);

  useEffect(() => {
    if (!signIn) { setError("Please sign in on the Chess Sathi website first."); return; }
    if (!classId) { setError("This class link is not complete."); return; }
    join();
  }, []);
  const join = (name) => {
    if (!name) { try { name = sessionStorage.getItem("cs.name") || ""; } catch {} }
    api("/join", { classId, name }).then((p) => { setNeedName(false); setPass(p); })
      .catch((e) => { if (e.code === "name") setNeedName(true); else setError(e.message); });
  };

  const notify = useCallback((text, bad) => setNote({ text, bad, at: Date.now() }), []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);

  if (error) return <Wait title="Can't open this class" text={error} back />;
  if (left) return <Wait title="You left the class" text={pass && pass.isTeacher ? "If recording is switched on, the recording shows up on the Live page a few minutes after the class ends." : "See you next class! Recordings, when available, are on the Live page."} back />;
  if (needName) return <NameForm onJoin={join} />;
  if (!pass) return <Wait title="Opening your class…" spin />;
  if (!av) return <Lobby pass={pass} onJoin={setAv} />;

  return (
    <div style={{ height: "100%" }} data-lk-theme="default">
      {note ? <div className={"note" + (note.bad ? " bad" : "")} role="status">{note.text}</div> : null}
      <LiveKitRoom
        serverUrl={pass.serverUrl} token={pass.token} connect
        video={av.cam} audio={av.mic}
        onConnected={() => {
          // Recording starts automatically when the teacher joins, if it is switched on.
          if (!pass.isTeacher) return;
          api("/record", { classId, action: "start" })
            .then(() => { setRecording(true); notify("● This class is being recorded"); })
            .catch((e) => { if (e.code !== "setup") notify("Recording didn't start: " + e.message, true); });
        }}
        onDisconnected={() => {
          if (pass.isTeacher && !stopped.current) { stopped.current = true; api("/record", { classId, action: "stop" }, { keepalive: true }).catch(() => {}); }
          setLeft(true);
        }}
        onError={(e) => notify(e.message || "Connection problem", true)}
        onMediaDeviceFailure={() => notify("We couldn't use your camera or microphone. Allow them in the browser's address bar.", true)}
        style={{ height: "100%" }}
      >
        <LayoutContextProvider>
          <Classroom pass={pass} notify={notify} recording={recording} />
        </LayoutContextProvider>
      </LiveKitRoom>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
