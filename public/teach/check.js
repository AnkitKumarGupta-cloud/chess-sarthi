/* Sathi Check: the squares to highlight for the "Think first" questions (Phase 4).
   Pure logic, no page and no network, so it is tested in node (npm test) and runs the same in the browser.
   It uses chess.js only (passed in as `Chess`), never Stockfish. Window: SathiCheck. Node: require()/import default.

   squares(Chess, fen, kind) -> { squares:[...], n, say }
     fen  = the position where the kid is about to move (it is the kid's turn)
     kind = "checks"   squares of YOUR pieces that can give check
            "captures" squares of THEIR pieces you can take ("loose" = nobody guards it, so you win it for free)
            "threats"  squares of YOUR pieces their side could take next move and that look in danger
                       (not guarded, or worth more than the piece that would take it)
   The words say "can" and "looks": this is a quick look at one move, not a full calculation. */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.SathiCheck = factory(); })(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  const uniq = (a) => [...new Set(a)];
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

  // The same position with the other side to move (used to ask "what could THEY take?"). No en passant, no castling rights:
  // this is a quick look at plain captures, so we keep it simple.
  function flipped(fen) {
    const p = fen.split(" ");
    return p[0] + " " + (p[1] === "w" ? "b" : "w") + " - - 0 1";
  }
  // Can `side` capture on square `sq` right now (legal moves)?
  function canTakeOn(Chess, fen, sq) {
    return new Chess(fen).moves({ verbose: true }).some((m) => m.to === sq && m.captured);
  }

  function checks(Chess, fen) {
    const mv = new Chess(fen).moves({ verbose: true }).filter((m) => /[+#]/.test(m.san));
    const squares = uniq(mv.map((m) => m.from));
    return { squares, n: mv.length, say: mv.length ? `You have ${plural(mv.length, "checking move")}, shown on the board. Not every check is good, but look at each one.` : "You have no checking move here. That is fine: look for a capture or a threat." };
  }

  function captures(Chess, fen) {
    const mv = new Chess(fen).moves({ verbose: true }).filter((m) => m.captured && m.captured !== "k");
    const by = {};
    for (const m of mv) {
      const g = new Chess(fen); g.move(m);
      const guarded = canTakeOn(Chess, g.fen(), m.to);        // after you take, can they take back?
      const x = (by[m.to] = by[m.to] || { loose: false, pc: m.captured });
      if (!guarded) x.loose = true;                          // one safe way to take is enough
    }
    const squares = Object.keys(by), loose = squares.filter((s) => by[s].loose);
    let say = "You cannot capture anything right now.";
    if (squares.length) say = `You can capture ${plural(squares.length, "piece")}, shown on the board.` + (loose.length ? ` ${plural(loose.length, "piece")} looks unguarded: ask yourself if it is a trap.` : " They all look guarded, so check what they can take back.");
    return { squares, n: squares.length, say, loose };
  }

  function threats(Chess, fen) {
    const flip = flipped(fen), g = new Chess(flip);
    const mv = g.moves({ verbose: true }).filter((m) => m.captured && m.captured !== "k");
    const danger = {};
    for (const m of mv) {
      const after = new Chess(flip); after.move(m);
      const guarded = canTakeOn(Chess, after.fen(), m.to);    // after they take, can you take back?
      if (!guarded || VAL[m.captured] > VAL[m.piece]) danger[m.to] = m.captured;
    }
    const squares = Object.keys(danger);
    return { squares, n: squares.length, say: squares.length ? `${plural(squares.length, "piece")} of yours looks in danger, shown on the board. Can you guard it, move it, or hit back harder?` : "Nothing of yours looks in danger right now. Now think: what is your best threat?" };
  }

  function squares(Chess, fen, kind) {
    try {
      if (kind === "checks") return checks(Chess, fen);
      if (kind === "captures") return captures(Chess, fen);
      if (kind === "threats") return threats(Chess, fen);
    } catch (e) { /* a strange position: show nothing rather than break the puzzle */ }
    return { squares: [], n: 0, say: "" };
  }

  return { squares, NAME };
});
