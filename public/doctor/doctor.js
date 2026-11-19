/* Game doctor: finds a player's biggest mistakes in a game and names what kind of mistake each one looks like.
   Pure logic, no page and no network, so it can be tested in node (npm test) and runs the same in the browser.
   It needs chess.js (passed in as `Chess`) and a function `ask(fen)` that returns Stockfish's opinion:
       { best: "e2e4", white: <centipawns from White's side>, mate: <moves to mate from White's side, or null> }
   (the app's sfAsk does exactly this). Window: GameDoctor. Node: require()/import default.

   What counts as a mistake: the engine score gets clearly worse for the player's side compared with the best move.
   Tags are GUESSES from comparing the move with the engine's best move, so the words say "looks like a fork", never "was a fork".
   Tag ids are Lichess puzzle theme ids, so they line up with the lesson cards and the puzzle drill. */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.GameDoctor = factory(); })(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  const FILES = "abcdefgh";
  const MIN_LOSS = 100, KEEP_LOSS = 150, MAX_KEEP = 5, MIN_KEEP = 3, MAX_PLIES = 300;
  const clamp = (x, m) => Math.max(-m, Math.min(m, x));

  // short stable id for a game (same moves + same side = same id), so the same game is never analysed twice
  function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }
  const gameId = (game, color) => cyrb53(game.moves.map((m) => m.uci).join(" ") + "|" + color + "|" + (game.start || ""));

  // text (PGN, or just the moves) -> { headers, moves:[{ply,color,san,uci,from,to,piece,captured,fenBefore,fenAfter}], start } or { error }
  function prepare(Chess, text) {
    let s = String(text || "").replace(/^﻿/, "").replace(/\r/g, "").trim();
    if (s.length < 6) return { error: "empty" };
    if (s.length > 80000) return { error: "toolong" };
    s = s.split(/\n\s*\n(?=\[Event )/)[0];                         // several games pasted: take the first
    const g = new Chess();
    if (!g.load_pgn(s, { sloppy: true })) return { error: "unreadable" };
    const headers = g.header(), hist = g.history({ verbose: true });
    if (headers.Variant && !/^standard$/i.test(headers.Variant)) return { error: "variant" };
    if (hist.length < 6) return { error: "short" };
    if (hist.length > MAX_PLIES) return { error: "toolong" };
    const start = headers.SetUp === "1" && headers.FEN ? headers.FEN : undefined;
    const w = new Chess(start), moves = [];
    for (const h of hist) {
      const fenBefore = w.fen(), mv = w.move({ from: h.from, to: h.to, promotion: h.promotion });
      if (!mv) return { error: "unreadable" };
      moves.push({ ply: moves.length + 1, color: h.color, san: mv.san, uci: h.from + h.to + (h.promotion || ""), from: h.from, to: h.to, piece: h.piece, captured: h.captured || "", fenBefore, fenAfter: w.fen() });
    }
    return { headers: { white: clean(headers.White), black: clean(headers.Black), result: /^(1-0|0-1|1\/2-1\/2)$/.test(headers.Result || "") ? headers.Result : "*", date: clean(headers.Date, 10), site: clean(headers.Site, 60) }, moves, start };
  }
  const clean = (s, n = 40) => String(s || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, n);

  // which side is the player? a username that matches a name in the game decides; otherwise null (the app asks)
  function guessSide(headers, name) {
    const n = String(name || "").trim().toLowerCase();
    if (n.length < 3) return null;
    const w = String(headers.white || "").toLowerCase(), b = String(headers.black || "").toLowerCase();
    if (w && w.includes(n) && !(b && b.includes(n))) return "w";
    if (b && b.includes(n) && !(w && w.includes(n))) return "b";
    return null;
  }

  // ---------- chess helpers ----------
  const mk = (Chess, fen, uci) => { const g = new Chess(fen), mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); return mv ? { g, mv } : null; };
  const flipTurn = (fen, c) => { const p = fen.split(" "); p[1] = c; p[3] = "-"; return p.join(" "); };
  // what could `color`'s piece on `sq` capture next move? (the turn is flipped so it can be asked at any time)
  function captureTargets(Chess, fen, sq, color) {
    const g = new Chess(flipTurn(fen, color)), out = [];
    for (const mv of g.moves({ square: sq, verbose: true })) {
      if (!mv.captured || mv.captured === "k") continue;
      const g2 = new Chess(g.fen()); g2.move(mv);
      out.push({ sq: mv.to, pc: mv.captured, defended: g2.moves({ verbose: true }).some((r) => r.to === mv.to && r.captured) });
    }
    return out;
  }
  const DIRS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
  DIRS.q = DIRS.b.concat(DIRS.r);
  // along each line from a bishop/rook/queen: first enemy piece X, then (behind it) enemy piece Y
  function lines(g, sq, color, pc) {
    const out = [], f0 = FILES.indexOf(sq[0]), r0 = +sq[1];
    for (const [df, dr] of DIRS[pc] || []) {
      let f = f0 + df, r = r0 + dr, x = null;
      while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
        const p = g.get(FILES[f] + r);
        if (p) { if (p.color === color) break; if (!x) x = { p: p.type, sq: FILES[f] + r }; else { out.push({ x, y: { p: p.type, sq: FILES[f] + r } }); break; } }
        f += df; r += dr;
      }
    }
    return out;
  }

  // ---------- tagging: compare the move played with the engine's best move ----------
  // m = the player's move, A = engine on the position before it (kid's view), B = engine on the position after it (kid's view)
  function tagMistake(Chess, m, color, A, B) {
    const opp = color === "w" ? "b" : "w";
    // 1) a checkmate was there and the move let it go (mate in 1-3)
    if (A.mate != null && A.mate >= 1 && A.mate <= 3 && m.uci !== A.best && !(B.mate != null && B.mate > 0)) return { id: "mateIn" + A.mate, kind: "missed", n: A.mate };
    // 2) the move allowed a quick checkmate
    if (B.mate != null && B.mate < 0 && -B.mate <= 2) return { id: "mateIn" + -B.mate, kind: "allowed", n: -B.mate };
    // 3) a piece that can simply be taken (left or moved onto a square where it is not protected enough)
    if (B.best && B.best !== "(none)") {
      const r = mk(Chess, m.fenAfter, B.best);
      if (r && r.mv.captured && r.mv.captured !== "p") {
        const recapture = r.g.moves({ verbose: true }).some((x) => x.to === r.mv.to && x.captured);
        if (VAL[r.mv.captured] - (recapture ? VAL[r.mv.piece] : 0) >= 2)
          return { id: "hangingPiece", kind: r.mv.to === m.to ? "moved" : "left", pc: NAME[r.mv.captured], sq: r.mv.to, by: NAME[r.mv.piece], defended: recapture };
      }
    }
    // 4) the engine's move was a fork / pin / skewer that was missed
    if (A.best && A.best !== "(none)" && A.best !== m.uci) {
      const b = mk(Chess, m.fenBefore, A.best);
      if (b && b.mv.piece !== "k") {
        const pc = b.mv.piece, to = b.mv.to, fen = b.g.fen(), check = b.g.in_check();
        const targets = captureTargets(Chess, fen, to, color);
        const worth = targets.filter((t) => VAL[t.pc] >= 3 && (VAL[t.pc] > VAL[pc] || !t.defended));
        if (worth.length >= 2) return { id: "fork", kind: "missed", pc: NAME[pc], x: NAME[worth[0].pc], y: NAME[worth[1].pc] };
        if (check && worth.length >= 1) return { id: "fork", kind: "missed", pc: NAME[pc], x: NAME[worth[0].pc], y: "king" };
        for (const { x, y } of lines(b.g, to, color, pc)) {
          // a pin: the front piece is worth less than the one behind it, so it cannot move away
          if (x.p !== "k" && VAL[x.p] >= 3 && VAL[y.p] > VAL[x.p]) return { id: "pin", kind: "missed", pc: NAME[pc], x: NAME[x.p], y: NAME[y.p] };
          // a skewer: the front piece is worth more, it must move (or is the king in check) and the one behind is lost
          const t = targets.find((q) => q.sq === x.sq), attackable = x.p === "k" ? check : t && (VAL[x.p] > VAL[pc] || !t.defended);
          if (attackable && VAL[x.p] > VAL[y.p] && VAL[y.p] >= 3) return { id: "skewer", kind: "missed", pc: NAME[pc], x: NAME[x.p], y: NAME[y.p] };
        }
      }
    }
    return null;                                                  // slow, positional: no tag
  }

  // ---------- the analysis ----------
  // ask(fen) -> engine result. opts: { progress(i,total), cancel() }
  async function analyse(Chess, game, color, ask, opts = {}) {
    const sign = color === "w" ? 1 : -1, mine = game.moves.filter((m) => m.color === color), cand = [];
    const kp = (r) => ({ cp: clamp(r.white * sign, 1500), mate: r.mate == null ? null : r.mate * sign, best: r.best });
    for (let i = 0; i < mine.length; i++) {
      if (opts.cancel && opts.cancel()) return { cancelled: true };
      if (opts.progress) opts.progress(i, mine.length);
      const m = mine[i], A = kp(await ask(m.fenBefore));
      if (!A.best || A.best === "(none)" || A.best === m.uci) continue;            // the engine's own move: no loss
      const over = new Chess(m.fenAfter).game_over();
      const B = over ? { cp: 0, mate: null, best: "(none)" } : kp(await ask(m.fenAfter));
      const loss = Math.max(0, A.cp - B.cp);
      const missedMate = A.mate != null && A.mate >= 1 && A.mate <= 3 && !(B.mate != null && B.mate > 0);
      const stillWinning = A.cp >= 700 && B.cp >= 400, alreadyLost = A.cp <= -600;
      if (!missedMate && (loss < MIN_LOSS || stillWinning || alreadyLost)) continue;
      cand.push({ m, A, B, loss: Math.max(loss, missedMate ? KEEP_LOSS : 0), missedMate });
    }
    if (opts.progress) opts.progress(mine.length, mine.length);
    cand.sort((a, b) => b.loss - a.loss);
    let keep = cand.filter((c) => c.loss >= KEEP_LOSS);
    if (keep.length < MIN_KEEP) keep = keep.concat(cand.filter((c) => c.loss < KEEP_LOSS)).slice(0, MIN_KEEP);
    keep = keep.slice(0, MAX_KEEP);
    return {
      checked: mine.length,
      mistakes: keep.map(({ m, A, B, loss }) => {
        const best = mk(Chess, m.fenBefore, A.best), rep = B.best && B.best !== "(none)" ? mk(Chess, m.fenAfter, B.best) : null;
        return { ply: m.ply, no: Math.ceil(m.ply / 2), color, san: m.san, uci: m.uci, fen: m.fenBefore, loss: Math.round(loss),
          best: { uci: A.best, san: best ? best.mv.san : A.best }, reply: rep ? rep.mv.san : "", tag: tagMistake(Chess, m, color, A, B) };
      }),
    };
  }

  // ---------- plain words ----------
  const a = (w) => (/^[aeiou]/.test(w) ? "an " : "a ") + w;
  const pawns = (loss) => (loss >= 1200 ? "a huge amount" : "about " + (Math.round(loss / 10) / 10).toFixed(1).replace(/\.0$/, "") + " pawns");
  const TAGNAME = { fork: "fork", pin: "pin", skewer: "skewer", hangingPiece: "hanging piece", mateIn1: "mate in 1", mateIn2: "mate in 2", mateIn3: "mate in 3" };
  function explain(x, oppName = "your opponent") {
    const t = x.tag, o = oppName, bs = x.best.san;
    if (!t) return { chip: "", text: `A better move was ${bs}. This one is about the plan, not a trick, so there is no puzzle for it. Look at what ${bs} changes: more space, a safer king or a better piece.` };
    switch (t.id) {
      case "hangingPiece":
        return { chip: "Looks like a hanging piece", text: t.kind === "moved"
          ? `After ${x.san}, your ${t.pc} on ${t.sq} can be taken by ${o}'s ${t.by}${t.defended ? ", which is more valuable to lose than to win" : " for free"}. Before every move, ask: can anything take the piece I am moving?`
          : `After ${x.san}, your ${t.pc} on ${t.sq} was left where ${o}'s ${t.by} can take it${t.defended ? " and win material" : " for free"}. Before every move, check which of your pieces are unprotected. ${bs} was better.` };
      case "fork":
        return { chip: "Looks like a missed fork", text: `${bs} looks like a fork: the ${t.pc} would attack ${o}'s ${t.x} and ${t.y === "king" ? "give check to the king" : a(t.y)} at once. Look for moves where one piece attacks two things.` };
      case "pin":
        return { chip: "Looks like a missed pin", text: `${bs} looks like a pin: ${o}'s ${t.x} cannot move without exposing the ${t.y} behind it. Look for a bishop, rook or queen lining up two pieces.` };
      case "skewer":
        return { chip: "Looks like a missed skewer", text: `${bs} looks like a skewer: the ${t.x} has to move and then your ${t.pc} can take the ${t.y} behind it.` };
      default: {
        const n = t.n || 1;
        return t.kind === "allowed"
          ? { chip: `Allowed mate in ${n}`, text: `After ${x.san}, ${o} can give checkmate in ${n}${x.reply ? " with " + x.reply : ""}. Before moving, check every check and capture ${o} has.` }
          : { chip: `Missed mate in ${n}`, text: `You had checkmate in ${n}: ${bs}. Before every move, look at ALL your checks first. One of them may be mate.` };
      }
    }
  }
  const tagName = (id) => TAGNAME[id] || id;

  return { prepare, analyse, explain, tagMistake, gameId, guessSide, tagName, pawns, MAX_KEEP, VAL, NAME };
});
