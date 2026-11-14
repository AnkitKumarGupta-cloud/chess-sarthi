// In-class puzzles: the teacher sends a position, every student solves it on their own board,
// and the teacher sees who solved it (and how many tries) live.
// Messages travel over LiveKit's data channel on the topic "puzzle":
//   teacher -> everyone   { t:"start", id, fen, line:[uci...], title }   line[0] is the student's first move
//   teacher -> everyone   { t:"end", id }                                 reveal the answer
//   student -> teacher    { t:"res", id, status:"open"|"wrong"|"ok", tries, ms }
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRoomContext, useParticipants } from "@livekit/components-react";
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

export function TeacherPuzzle({ pz }) {
  const people = useParticipants();
  const [mode, setMode] = useState("levels");
  const [level, setLevel] = useState(1);
  const [pick, setPick] = useState(null);
  const [fenText, setFenText] = useState("");
  const [custom, setCustom] = useState(null);   // { fen, line:[], next:[uci from the game], title }
  const [game, setGame] = useState(null);       // a loaded PGN: { fens, sans, ucis, lasts, title, idx }
  const [err, setErr] = useState("");
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
          {!a.ended ? <button className="btn" onClick={pz.end}>Show answer to everyone</button> : <button className="btn" onClick={() => { pz.clear(); setPick(null); setCustom(null); }}>New puzzle</button>}
        </div>
      </div>
    );
  }

  // ----- choose a puzzle -----
  return (
    <div className="pzt">
      <div className="tabs2 pzt-tabs" role="tablist">
        <button role="tab" aria-selected={mode === "levels"} onClick={() => setMode("levels")}>Puzzle levels</button>
        <button role="tab" aria-selected={mode === "custom"} onClick={() => setMode("custom")}>PGN / FEN</button>
      </div>
      {mode === "levels" ? (
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
          ) : (
            <>
              <div className="pzt-board"><Board fen={customFen()} flip={new Chess(custom.fen).turn() === "b"} canMove onMove={customMove} /></div>
              <p className="pzt-meta">{custom.line.length ? <>Answer: <b>{sanLine(custom.fen, custom.line).join(" ")}</b></> : `Play the answer for ${sideName(new Chess(custom.fen).turn())}. Play the replies too for a longer puzzle.`}</p>
              <div className="pzt-row">
                {custom.next && custom.next[custom.line.length] ? <button className="chipbtn" onClick={() => setCustom({ ...custom, line: [...custom.line, custom.next[custom.line.length]] })}>+ Game's next move ({sanLine(customFen(), [custom.next[custom.line.length]])[0]})</button> : null}
                <button className="chipbtn" disabled={!custom.line.length} onClick={() => setCustom({ ...custom, line: custom.line.slice(0, -1) })}>Undo</button>
                <button className="chipbtn" onClick={() => setCustom(null)}>{game ? "Pick another move" : "Change position"}</button>
              </div>
              <button className="btn wide" disabled={!custom.line.length || custom.line.length % 2 === 0} onClick={() => pz.start({ fen: custom.fen, line: custom.line, title: custom.title || "Teacher's position" })}>Send to class</button>
              {custom.line.length && custom.line.length % 2 === 0 ? <p className="pzt-meta">End on your student's move (undo the last reply).</p> : null}
            </>
          )}
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
