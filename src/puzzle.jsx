// In-class puzzles: the teacher sends a position, every student solves it on their own board,
// and the teacher sees who solved it (and how many tries) live.
// Messages travel over LiveKit's data channel on the topic "puzzle":
//   teacher -> everyone   { t:"start", id, fen, line:[uci...], title }   line[0] is the student's first move
//   teacher -> everyone   { t:"end", id }                                 reveal the answer
//   student -> teacher    { t:"res", id, status:"open"|"wrong"|"ok", tries, ms }
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRoomContext, useParticipants } from "@livekit/components-react";
import { grabBoardPicture, readBoardPicture } from "./screengrab.js";
import { placement } from "./boardscan.js";
import { RoomEvent } from "livekit-client";
import { Chess } from "chess.js";
import "./pieces.css";
import "./puzzle.css";

const TOPIC = "puzzle";
const FILES = "abcdefgh";
const uciOf = (m) => m.from + m.to + (m.promotion || "");
const roleOf = (p) => { try { return JSON.parse(p.metadata || "{}").role; } catch { return ""; } };
const newId = () => Math.random().toString(36).slice(2, 10);
const sideName = (c) => (c === "w" ? "White" : "Black");

// Play a list of UCI moves from a FEN and return the moves in normal notation (e.g. "Nf7+").
export function sanLine(fen, line) {
  const g = new Chess(fen), out = [];
  for (const u of line) { const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); if (!m) break; out.push(m.san); }
  return out;
}

// ---------- board ----------
export function Board({ fen, flip, canMove, onMove, last, flash }) {
  const game = useMemo(() => { try { return new Chess(fen); } catch { return null; } }, [fen]);
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [fen]);
  if (!game) return <div className="pzb-bad">That position isn't valid.</div>;
  const targets = sel ? game.moves({ square: sel, verbose: true }).map((m) => m.to) : [];
  const click = (sq) => {
    if (!canMove) return;
    const p = game.get(sq);
    if (sel && targets.includes(sq)) {
      const m = game.moves({ square: sel, verbose: true }).find((x) => x.to === sq);
      setSel(null); onMove && onMove(sel, sq, m && m.promotion ? true : false);
      return;
    }
    setSel(p && p.color === game.turn() ? (sq === sel ? null : sq) : null);
  };
  const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flip ? [...FILES].reverse() : [...FILES];
  return (
    <div className="pzb" role="grid" aria-label="Chess board">
      {ranks.map((r, ri) => files.map((f, fi) => {
        const sq = f + r, p = game.get(sq), dark = (FILES.indexOf(f) + r) % 2 === 0;
        const cls = ["pzsq", dark ? "d" : "l", last && last.includes(sq) ? "hi" : "", sel === sq ? "sel" : "", flash && flash.includes(sq) ? "bad" : ""].join(" ");
        return (
          <button key={sq} className={cls} onClick={() => click(sq)} aria-label={sq + (p ? " " + sideName(p.color) + " " + p.type : "")} tabIndex={canMove ? 0 : -1}>
            {p ? <i className={"pc " + p.color + " pk-" + p.type} /> : null}
            {targets.includes(sq) ? <span className={p ? "cap" : "dotm"} /> : null}
            {fi === 0 ? <em className="rk">{r}</em> : null}
            {ri === 7 ? <em className="fl">{f}</em> : null}
          </button>
        );
      }))}
    </div>
  );
}

// ---------- channel ----------
export function usePuzzle(isTeacher) {
  const room = useRoomContext();
  const [active, setActive] = useState(null);   // { id, fen, line, title, ended }
  const [results, setResults] = useState({});   // teacher: identity -> { status, tries, ms }
  const activeRef = useRef(null); activeRef.current = active;

  const send = (msg, to) => room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)),
    { reliable: true, topic: TOPIC, destinationIdentities: to ? [to] : undefined }).catch(() => {});

  useEffect(() => {
    const onData = (payload, participant, _k, topic) => {
      if (topic !== TOPIC || !participant) return;
      let m = null; try { m = JSON.parse(new TextDecoder().decode(payload)); } catch {}
      if (!m) return;
      if (isTeacher) {
        if (m.t === "res" && activeRef.current && m.id === activeRef.current.id)
          setResults((r) => ({ ...r, [participant.identity]: { status: m.status, tries: m.tries | 0, ms: m.ms | 0 } }));
      } else if (roleOf(participant) === "teacher") {
        if (m.t === "start" && Array.isArray(m.line)) setActive((cur) => (cur && cur.id === m.id ? cur : { id: m.id, fen: m.fen, line: m.line, title: m.title || "", ended: false }));
        if (m.t === "end") setActive((cur) => (cur && cur.id === m.id ? { ...cur, ended: true } : cur));
      }
    };
    // Someone joining (or rejoining) during a puzzle gets it straight away.
    const onJoin = (p) => { const a = activeRef.current; if (isTeacher && a && !a.ended) send({ t: "start", id: a.id, fen: a.fen, line: a.line, title: a.title }, p.identity); };
    room.on(RoomEvent.DataReceived, onData); room.on(RoomEvent.ParticipantConnected, onJoin);
    return () => { room.off(RoomEvent.DataReceived, onData); room.off(RoomEvent.ParticipantConnected, onJoin); };
  }, [room, isTeacher]);

  const start = (p) => { const a = { id: newId(), fen: p.fen, line: p.line, title: p.title || "", ended: false }; setActive(a); setResults({}); send({ t: "start", id: a.id, fen: a.fen, line: a.line, title: a.title }); };
  const end = () => { if (!active) return; send({ t: "end", id: active.id }); setActive({ ...active, ended: true }); };
  const clear = () => { setActive(null); setResults({}); };
  const report = (status, tries, ms) => { const a = activeRef.current; const t = room.remoteParticipants && [...room.remoteParticipants.values()].find((p) => roleOf(p) === "teacher");
    if (a && t) send({ t: "res", id: a.id, status, tries, ms }, t.identity); };
  return { active, results, start, end, clear, report, dismiss: () => setActive(null) };
}

// A PGN (a whole game) -> every position in it, so the teacher can pick one as a puzzle.
// Comments, side lines and move marks are dropped; only the main game is used.
function cleanPgn(t) {
  t = String(t).replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");
  let out = "", depth = 0;
  for (const c of t) { if (c === "(") depth++; else if (c === ")") depth = Math.max(0, depth - 1); else if (!depth) out += c; }
  return out.replace(/\$\d+/g, " ");
}
export function readPgn(text) {
  const g = new Chess();
  if (!g.load_pgn(cleanPgn(text), { sloppy: true })) return null;
  const h = g.header() || {}, moves = g.history({ verbose: true });
  if (!moves.length) return null;
  const b = new Chess(h.FEN || undefined), fens = [b.fen()];
  for (const m of moves) { b.move(m); fens.push(b.fen()); }
  return { fens, sans: moves.map((m) => m.san), ucis: moves.map(uciOf), lasts: [null, ...moves.map((m) => [m.from, m.to])],
    title: h.White && h.Black && h.White !== "?" ? `${h.White} – ${h.Black}` : "" };
}
const looksLikeFen = (t) => /^\s*[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}\s+[wb]\b/.test(t);

// ---------- teacher: pick and send, then watch results ----------
let LEVELS = null;
const loadLevels = async () => { if (LEVELS) return LEVELS; const r = await fetch("/levels.json?v=1"); LEVELS = (await r.json()).levels; return LEVELS; };
// A puzzle from the database starts one move earlier (the opponent's move); play it so the student moves first.
function fromLibrary(p, level) {
  const g = new Chess(p[1]), mv = p[2].split(" ");
  const first = g.move({ from: mv[0].slice(0, 2), to: mv[0].slice(2, 4), promotion: mv[0][4] });
  if (!first) return null;
  return { fen: g.fen(), line: mv.slice(1), title: `Level ${level} · difficulty ${p[3]}`, last: [first.from, first.to] };
}

// ---------- position from the teacher's screen ----------
// screen: 64 pieces as seen on the teacher's screen (top-left first; "P" white pawn, "p" black pawn, "" empty).
// flipped: Black is at the bottom of the teacher's screen.
const TOOLS = ["K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p", ""];
function castling(fenBoard) {
  const g = new Chess(fenBoard + " w - - 0 1"), at = (sq) => { const p = g.get(sq); return p ? (p.color === "w" ? p.type.toUpperCase() : p.type) : ""; };
  let c = "";
  if (at("e1") === "K") { if (at("h1") === "R") c += "K"; if (at("a1") === "R") c += "Q"; }
  if (at("e8") === "k") { if (at("h8") === "r") c += "k"; if (at("a8") === "r") c += "q"; }
  return c || "-";
}
export function scanFen(screen, flipped, turn) {
  const b = placement(screen, flipped);
  return `${b} ${turn} ${castling(b)} - 0 1`;
}
export function scanProblem(screen, flipped, turn) {
  const n = (p) => screen.filter((x) => x === p).length;
  if (n("K") !== 1) return n("K") ? "There are two white kings. Fix one of them." : "The white king is missing. Add it.";
  if (n("k") !== 1) return n("k") ? "There are two black kings. Fix one of them." : "The black king is missing. Add it.";
  for (let i = 0; i < 64; i++) if ((i < 8 || i >= 56) && (screen[i] === "P" || screen[i] === "p")) return "A pawn can't stand on the first or last row.";
  const g = new Chess();
  if (!g.load(scanFen(screen, flipped, turn))) return "That position isn't valid.";
  const other = new Chess(scanFen(screen, flipped, turn === "w" ? "b" : "w"));
  if (other.in_check()) return `${sideName(turn === "w" ? "b" : "w")} is in check, so it can't be ${sideName(turn)}'s move. Change who moves.`;
  if (g.game_over()) return "The game is already over in this position.";
  return "";
}

function EditBoard({ screen, conf, flipped, tool, onTap }) {
  return (
    <div className="pzb scanb" role="grid" aria-label="Position read from your screen">
      {screen.map((p, i) => {
        const r = i >> 3, f = i & 7, light = (r + f) % 2 === 0;
        const rank = flipped ? r + 1 : 8 - r, file = flipped ? "hgfedcba"[f] : "abcdefgh"[f];
        const unsure = conf && conf[i] < 0.75;
        return (
          <button key={i} className={"pzsq " + (light ? "l" : "d") + (unsure ? " unsure" : "")} onClick={() => onTap(i)}
            aria-label={file + rank + (p ? " " + (p === p.toUpperCase() ? "White " : "Black ") + p.toLowerCase() : " empty") + (unsure ? ", check this square" : "")}>
            {p ? <i className={"pc " + (p === p.toUpperCase() ? "w" : "b") + " pk-" + p.toLowerCase()} /> : null}
            {f === 0 ? <em className="rk">{rank}</em> : null}
            {r === 7 ? <em className="fl">{file}</em> : null}
          </button>
        );
      })}
    </div>
  );
}

function ScreenPosition({ onUse, st, setSt }) {
  const room = useRoomContext();
  // st.step: start | busy | edit | none (kept by the parent, so "Back to the position" returns here)
  const [tool, setTool] = useState(null);
  const read = async () => {
    setSt({ step: "busy" });
    try {
      const { img } = await grabBoardPicture(room);
      const r = await readBoardPicture(img);
      if (!r.ok) { setSt({ step: "none" }); return; }
      setTool(null);
      setSt({ step: "edit", screen: r.screen, conf: r.conf, flipped: r.flipped, turn: r.flipped ? "b" : "w" });
    } catch (e) {
      const m = e && e.name === "NotAllowedError" ? "You didn't pick a window, so nothing was read." : (e && e.message) || "Couldn't read the screen.";
      setSt({ step: "start", err: m });
    }
  };
  const sharing = !!(room && room.localParticipant.isScreenShareEnabled);
  if (st.step === "busy") return (
    <>
      <div className="pzt-board"><div className="pzb scanb busy" aria-hidden="true">{Array.from({ length: 64 }, (_, i) => <span key={i} className={"pzsq " + (((i >> 3) + (i & 7)) % 2 ? "d" : "l")} />)}</div></div>
      <p className="pzt-meta" role="status">Reading the board…</p>
    </>
  );
  if (st.step !== "edit") return (
    <>
      <p className="pzt-meta">{sharing
        ? <>Show the puzzle on the screen you are sharing, then press <b>Read the board</b>. Works best with a flat 2D board (Lichess, Chess.com, our app).</>
        : <>You're not sharing your screen. Press <b>Read the board</b> and pick the window or tab with the puzzle; only one picture is taken.</>}</p>
      {st.step === "none" ? <p className="pzt-err">No chess board found. Make the board bigger and fully visible, then try again.</p> : null}
      {st.err ? <p className="pzt-err">{st.err}</p> : null}
      <button className="btn wide" onClick={read}>Read the board</button>
    </>
  );
  const { screen, conf, flipped, turn } = st;
  const problem = scanProblem(screen, flipped, turn);
  const tap = (i) => {
    if (tool === null) return;
    const next = screen.slice(); next[i] = next[i] === tool ? "" : tool;
    const c = conf.slice(); c[i] = 1;
    setSt({ ...st, screen: next, conf: c });
  };
  const unsure = conf.filter((c) => c < 0.75).length;
  return (
    <>
      <div className="pzt-head"><b>Check the position</b><span>{unsure ? `${unsure} square${unsure > 1 ? "s" : ""} with a gold ring: please check.` : "Read from your screen."} To fix a square, pick a piece below, then tap the square.</span></div>
      <div className="pzt-board"><EditBoard screen={screen} conf={conf} flipped={flipped} tool={tool} onTap={tap} /></div>
      <div className="scan-tools" role="toolbar" aria-label="Pieces">
        {TOOLS.map((t) => (
          <button key={t || "x"} className={"scan-tool" + (tool === t ? " on" : "")} aria-pressed={tool === t} onClick={() => setTool(tool === t ? null : t)}
            title={t ? (t === t.toUpperCase() ? "White " : "Black ") + ({ k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" })[t.toLowerCase()] : "Empty square"}>
            {t ? <i className={"pc " + (t === t.toUpperCase() ? "w" : "b") + " pk-" + t.toLowerCase()} /> : <span className="scan-x" aria-hidden="true" />}
          </button>))}
      </div>
      <div className="pzt-row scan-opts">
        <span>At the bottom</span>
        <div className="tabs2" role="radiogroup" aria-label="Side at the bottom of your screen">
          <button role="radio" aria-checked={!flipped} aria-selected={!flipped} onClick={() => setSt({ ...st, flipped: false })}>White</button>
          <button role="radio" aria-checked={flipped} aria-selected={flipped} onClick={() => setSt({ ...st, flipped: true })}>Black</button>
        </div>
      </div>
      <div className="pzt-row scan-opts">
        <span>To move</span>
        <div className="tabs2" role="radiogroup" aria-label="Side to move">
          <button role="radio" aria-checked={turn === "w"} aria-selected={turn === "w"} onClick={() => setSt({ ...st, turn: "w" })}>White</button>
          <button role="radio" aria-checked={turn === "b"} aria-selected={turn === "b"} onClick={() => setSt({ ...st, turn: "b" })}>Black</button>
        </div>
      </div>
      {problem ? <p className="pzt-err">{problem}</p> : null}
      <button className="btn wide" disabled={!!problem} onClick={() => onUse(scanFen(screen, flipped, turn))}>Use this position</button>
      <button className="chipbtn" onClick={read}>Read the board again</button>
    </>
  );
}

export function TeacherPuzzle({ pz }) {
  const people = useParticipants();
  const [mode, setMode] = useState("levels");
  const [level, setLevel] = useState(1);
  const [pick, setPick] = useState(null);
  const [fenText, setFenText] = useState("");
  const [custom, setCustom] = useState(null);   // { fen, line:[], next:[uci from the game], title }
  const [game, setGame] = useState(null);       // a loaded PGN: { fens, sans, ucis, lasts, title, idx }
  const [err, setErr] = useState("");
  const [scanSt, setScanSt] = useState({ step: "start" });
  const [, tick] = useState(0);

  const choose = async (lv = level) => {
    setErr("");
    try {
      const L = await loadLevels(), n = Math.min(Math.max(1, lv | 0), L.length), list = L[n - 1];
      for (let i = 0; i < 10; i++) { const q = fromLibrary(list[Math.floor(Math.random() * list.length)], n); if (q && (!pick || q.fen !== pick.fen)) { setPick(q); return; } }
    } catch { setErr("Couldn't load the puzzles. Check your internet."); }
  };
  useEffect(() => { if (mode === "levels" && !pick) choose(); }, [mode]);

  const loadFen = () => {
    const f = fenText.trim(); setErr("");
    if (looksLikeFen(f)) {
      try { const g = new Chess(); if (!g.load(f)) throw 0; setCustom({ fen: g.fen(), line: [], next: [] }); }
      catch { setErr("That FEN isn't valid. Copy it from Lichess (Share & export → FEN)."); }
      return;
    }
    const pg = readPgn(f);
    if (!pg) { setErr("That isn't a valid FEN or PGN. On Lichess: Share & export → copy the PGN or the FEN."); return; }
    setGame({ ...pg, idx: Math.max(0, pg.fens.length - 2) });
  };
  const usePosition = () => { const i = game.idx; setCustom({ fen: game.fens[i], line: [], next: game.ucis.slice(i), title: game.title ? `${game.title}, move ${Math.floor(i / 2) + 1}` : "From a game" }); };
  const customFen = () => { const g = new Chess(custom.fen); custom.line.forEach((u) => g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" })); return g.fen(); };
  const customMove = (from, to, promo) => {
    const g = new Chess(customFen()); const m = g.move({ from, to, promotion: promo ? "q" : undefined });
    if (m) setCustom({ ...custom, line: [...custom.line, uciOf(m)] });
  };

  // ----- a puzzle is running -----
  if (pz.active) {
    const a = pz.active, students = people.filter((p) => !p.isLocal && roleOf(p) !== "teacher");
    const res = (p) => pz.results[p.identity] || { status: "none" };
    const solved = students.filter((p) => res(p).status === "ok");
    const order = { ok: 0, wrong: 1, open: 2, none: 3 };
    const sorted = [...students].sort((x, y) => order[res(x).status] - order[res(y).status] || (res(x).ms - res(y).ms));
    const answer = sanLine(a.fen, a.line);
    return (
      <div className="pzt">
        <div className="pzt-head"><b>{a.ended ? "Answer shown" : "Puzzle sent"}</b><span>{a.title}</span></div>
        <div className="pzt-board"><Board fen={a.fen} flip={new Chess(a.fen).turn() === "b"} canMove={false} /></div>
        <div className="pzt-score"><b>{solved.length}</b> of {students.length} solved</div>
        <ul className="pzt-list">
          {sorted.map((p) => { const r = res(p); return (
            <li key={p.identity} className={"s-" + r.status}>
              <span className="pname">{p.name || p.identity}</span>
              <span className="pzt-st">{r.status === "ok" ? `✓ ${Math.max(1, Math.round(r.ms / 1000))}s${r.tries ? ` · ${r.tries} wrong` : ""}` : r.status === "wrong" ? `✗ ${r.tries} wrong` : r.status === "open" ? "Solving…" : "Not opened"}</span>
            </li>); })}
          {!students.length ? <li className="s-none"><span className="pname">No students in class yet</span></li> : null}
        </ul>
        {a.ended ? <p className="pzt-ans">Answer: <b>{answer.join(" ")}</b></p> : null}
        <div className="pzt-actions">
          {!a.ended ? <button className="btn" onClick={pz.end}>Show answer to everyone</button> : <button className="btn" onClick={() => { pz.clear(); setPick(null); setCustom(null); setScanSt({ step: "start" }); }}>New puzzle</button>}
        </div>
      </div>
    );
  }

  const customView = custom ? (
            <>
              <div className="pzt-board"><Board fen={customFen()} flip={new Chess(custom.fen).turn() === "b"} canMove onMove={customMove} /></div>
              <p className="pzt-meta">{custom.line.length ? <>Answer: <b>{sanLine(custom.fen, custom.line).join(" ")}</b></> : `Play the answer for ${sideName(new Chess(custom.fen).turn())}. Play the replies too for a longer puzzle.`}</p>
              <div className="pzt-row">
                {custom.next && custom.next[custom.line.length] ? <button className="chipbtn" onClick={() => setCustom({ ...custom, line: [...custom.line, custom.next[custom.line.length]] })}>+ Game's next move ({sanLine(customFen(), [custom.next[custom.line.length]])[0]})</button> : null}
                <button className="chipbtn" disabled={!custom.line.length} onClick={() => setCustom({ ...custom, line: custom.line.slice(0, -1) })}>Undo</button>
                <button className="chipbtn" onClick={() => setCustom(null)}>{custom.from === "screen" ? "Back to the position" : game ? "Pick another move" : "Change position"}</button>
              </div>
              <button className="btn wide" disabled={!custom.line.length || custom.line.length % 2 === 0} onClick={() => pz.start({ fen: custom.fen, line: custom.line, title: custom.title || "Teacher's position" })}>Send to class</button>
              {custom.line.length && custom.line.length % 2 === 0 ? <p className="pzt-meta">End on your student's move (undo the last reply).</p> : null}
            </>
  ) : null;

  // ----- choose a puzzle -----
  return (
    <div className="pzt">
      <div className="tabs2 pzt-tabs three" role="tablist">
        <button role="tab" aria-selected={mode === "levels"} onClick={() => setMode("levels")}>Puzzle levels</button>
        <button role="tab" aria-selected={mode === "custom"} onClick={() => setMode("custom")}>PGN / FEN</button>
        <button role="tab" aria-selected={mode === "screen"} onClick={() => setMode("screen")}>My screen</button>
      </div>
      {mode === "screen" ? (custom && custom.from === "screen" ? customView : <ScreenPosition st={scanSt} setSt={setScanSt} onUse={(fen) => setCustom({ fen, line: [], next: [], title: "From your screen", from: "screen" })} />)
      : mode === "levels" ? (
        <>
          <div className="pzt-row">
            <label>Level <input type="number" min="1" max="115" value={level} onChange={(e) => setLevel(e.target.value)} onBlur={() => choose()} /></label>
            <button className="chipbtn" onClick={() => choose()}>Another puzzle</button>
          </div>
          {pick ? <>
            <div className="pzt-board"><Board fen={pick.fen} flip={new Chess(pick.fen).turn() === "b"} canMove={false} last={pick.last} /></div>
            <p className="pzt-meta">{sideName(new Chess(pick.fen).turn())} to move · {pick.title} · {Math.ceil(pick.line.length / 2)} move{pick.line.length > 2 ? "s" : ""}</p>
            <button className="btn wide" onClick={() => pz.start(pick)}>Send to class</button>
          </> : <p className="pzt-meta">Loading…</p>}
        </>
      ) : (
        <>
          {game && !custom ? (
            <>
              <div className="pzt-head"><b>Pick the position</b><span>{game.title || "Your game"} · {game.idx ? `after ${Math.floor((game.idx - 1) / 2) + 1}${game.idx % 2 ? "." : "…"} ${game.sans[game.idx - 1]}` : "start"}</span></div>
              <div className="pzt-board"><Board fen={game.fens[game.idx]} flip={new Chess(game.fens[game.idx]).turn() === "b"} canMove={false} last={game.lasts[game.idx]} /></div>
              <div className="pzt-nav">
                {[["⏮", 0, "First move"], ["◀", game.idx - 1, "Back"], ["▶", game.idx + 1, "Forward"], ["⏭", game.fens.length - 1, "Last move"]].map(([t, i, l]) => (
                  <button key={l} className="chipbtn" aria-label={l} disabled={i < 0 || i >= game.fens.length || i === game.idx} onClick={() => setGame({ ...game, idx: i })}>{t}</button>))}
              </div>
              <div className="pzt-moves">
                {game.sans.map((m, i) => (
                  <React.Fragment key={i}>{i % 2 === 0 ? <span className="mn">{i / 2 + 1}.</span> : null}
                    <button className={game.idx === i + 1 ? "on" : ""} onClick={() => setGame({ ...game, idx: i + 1 })}>{m}</button></React.Fragment>))}
              </div>
              <p className="pzt-meta">{sideName(new Chess(game.fens[game.idx]).turn())} to move in this position.</p>
              <button className="btn wide" onClick={usePosition} disabled={game.idx >= game.fens.length - 1 && new Chess(game.fens[game.idx]).game_over()}>Use this position</button>
              <button className="chipbtn" onClick={() => { setGame(null); setFenText(""); }}>Paste something else</button>
            </>
          ) : !custom ? (
            <>
              <p className="pzt-meta">Paste a <b>PGN</b> (a whole game) or a <b>FEN</b> (one position). On Lichess: Share &amp; export.</p>
              <textarea className="pzt-fen" rows="4" value={fenText} onChange={(e) => setFenText(e.target.value)} placeholder={"1. e4 e5 2. Nf3 Nc6 3. Bc4 …\nor\n6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1"} />
              <button className="btn wide" onClick={loadFen} disabled={!fenText.trim()}>Load</button>
            </>
          ) : customView}
        </>
      )}
      {err ? <p className="pzt-err">{err}</p> : null}
    </div>
  );
}

// ---------- student: solve it ----------
export function StudentPuzzle({ pz }) {
  const a = pz.active;
  const [fen, setFen] = useState(null);
  const [ply, setPly] = useState(0);
  const [state, setState] = useState("idle");   // idle | wrong | wait | ok
  const [tries, setTries] = useState(0);
  const [last, setLast] = useState(null);
  const [flash, setFlash] = useState(null);
  const [hidden, setHidden] = useState(false);
  const started = useRef(0);

  useEffect(() => {
    if (!a) return;
    setFen(a.fen); setPly(0); setState("idle"); setTries(0); setLast(null); setFlash(null); setHidden(false);
    started.current = Date.now(); pz.report("open", 0, 0);
  }, [a && a.id]);
  if (!a || !fen) return null;

  const color = new Chess(a.fen).turn();
  const onMove = (from, to, promo) => {
    if (state === "ok" || state === "wait" || a.ended) return;
    const want = a.line[ply], g = new Chess(fen);
    const m = g.move({ from, to, promotion: promo ? (want && want.slice(0, 4) === from + to && want[4]) || "q" : undefined });
    if (!m) return;
    const isLast = ply === a.line.length - 1;
    if (uciOf(m) === want || (isLast && g.in_checkmate())) {
      setFen(g.fen()); setLast([m.from, m.to]); const next = ply + 1;
      if (next >= a.line.length) { setState("ok"); setPly(next); pz.report("ok", tries, Date.now() - started.current); return; }
      setState("wait"); setPly(next);
      setTimeout(() => {
        const r = a.line[next], gg = new Chess(g.fen());
        const rm = gg.move({ from: r.slice(0, 2), to: r.slice(2, 4), promotion: r[4] || "q" });
        if (rm) { setFen(gg.fen()); setLast([rm.from, rm.to]); }
        setPly(next + 1); setState("idle");
      }, 450);
    } else {
      const t = tries + 1; setTries(t); setState("wrong"); setFlash([from, to]); pz.report("wrong", t, 0);
      setTimeout(() => setFlash(null), 600);
    }
  };

  if (hidden) return <button className="pz-chip" onClick={() => setHidden(false)}>♟ Puzzle{state === "ok" ? " ✓" : ""}</button>;
  const answer = sanLine(a.fen, a.line).join(" ");
  const msg = a.ended ? <>Answer: <b>{answer}</b></>
    : state === "ok" ? <><b>Solved!</b> Well done. Wait for your teacher.</>
    : state === "wrong" ? <>Not this move. Try again.</>
    : state === "wait" ? <>Good! Keep going…</>
    : <><i className={"tm " + color} /> {sideName(color)} to move. Find the best move.</>;
  return (
    <div className="pz-overlay" role="dialog" aria-label="Puzzle from your teacher">
      <div className="pz-card">
        <div className="pz-top"><b>Puzzle from your teacher</b><button className="iconbtn" onClick={() => (a.ended ? pz.dismiss() : setHidden(true))} aria-label={a.ended ? "Close" : "Hide puzzle"}>✕</button></div>
        <div className="pz-board"><Board fen={a.ended ? a.fen : fen} flip={color === "b"} canMove={!a.ended && state !== "ok" && state !== "wait"} onMove={onMove} last={last} flash={flash} /></div>
        <p className={"pz-msg " + (a.ended ? "end" : state)}>{msg}</p>
      </div>
    </div>
  );
}
