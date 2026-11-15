# Explained openings, part 0: easy openings and traps every beginner should know (shown first, group "easy").
G = []

G.append(dict(
 id="scholars", name="Scholar's Mate", side="w", level="Beginner", group="easy", families=["Bishop's Opening", "King's Pawn Game"],
 about="The most famous beginner trap: White's queen and bishop both attack f7, and if Black doesn't notice, it is checkmate on move four. Every player must know it, mostly so it never happens to you.",
 ideas=["The queen and the bishop both aim at f7.", "f7 is weak because only the king protects it.", "Black stops it easily with ...g6 or ...Qe7, then gains time attacking White's queen."],
 main=("The trap", [
  ("e4", "White opens lines for the queen and the bishop."),
  ("e5", "Black answers in the centre."),
  ("Bc4", "The bishop aims at f7."),
  ("Nc6", "Black develops but doesn't see the danger."),
  ("Qh5", "The queen comes out early and also aims at f7. Now Qxf7 is checkmate if nothing is done."),
  ("Nf6", "A big mistake. The knight attacks the queen, but it doesn't protect f7."),
  ("Qxf7#", "Checkmate! The queen takes on f7, the bishop protects her, and the king can't escape."),
 ]),
 vars=[
  ("How Black stops it: ...g6", 5, [
   ("g6", "Black blocks the queen's line to f7 and attacks the queen."),
   ("Qf3", "The queen goes back and aims at f7 again."),
   ("Nf6", "The knight now blocks the queen's line to f7. Black is safe."),
   ("Ne2", "White develops."),
   ("Bg7", "Black develops. White's queen came out too early and Black is doing well."),
  ]),
  ("How Black stops it: ...Qe7", 5, [
   ("Qe7", "The queen protects f7 and the e5 pawn at the same time."),
   ("Nc3", "White develops."),
   ("Nf6", "Now the knight attacks White's queen and Black gains time."),
   ("Qh4", "The queen has to move again. Lesson: bringing the queen out early wastes moves."),
  ]),
  ("Early queen: 2.Qh5", 2, [
   ("Qh5", "The queen comes out on move two and attacks e5 and f7."),
   ("Nc6", "Black protects e5."),
   ("Bc4", "The bishop joins the attack on f7."),
   ("g6", "Black blocks the queen and attacks her."),
   ("Qf3", "The queen goes back to aim at f7."),
   ("Nf6", "The knight blocks f7. Black is safe and better developed."),
  ]),
 ]))

G.append(dict(
 id="fools", name="Fool's Mate", side="b", level="Beginner", group="easy", families=["Barnes Opening"],
 about="The fastest checkmate in chess: just two moves. It only happens if White moves the f-pawn and the g-pawn early, which opens the diagonal to White's king. The lesson: don't weaken the pawns in front of your king.",
 ideas=["Moving the f-pawn and g-pawn early opens a road to your king.", "The queen on h4 gives check along that diagonal.", "Nothing can block the check, so it is mate."],
 main=("Two-move checkmate", [
  ("f3", "A weak first move: it opens the e1-h4 diagonal to White's king."),
  ("e5", "Black opens a path for the queen."),
  ("g4", "Another weak move. Now there is nothing between h4 and White's king."),
  ("Qh4#", "Checkmate! The queen checks along the diagonal and nothing can block or capture her."),
 ]),
 vars=[
  ("Same idea after 1.f4", 0, [
   ("f4", "This pawn move also opens the diagonal to White's king."),
   ("e6", "Black opens a path for the queen."),
   ("g4", "The second weakening move."),
   ("Qh4#", "Checkmate again. Keep the f-pawn and g-pawn at home in the opening."),
  ]),
 ]))

G.append(dict(
 id="legals", name="Légal's Mate", side="w", level="Beginner", group="easy", families=["Philidor Defense"],
 about="A famous trap from the 1700s. White seems to give away the queen, but if Black takes it, White's minor pieces give checkmate. It teaches that a pin is not always real.",
 ideas=["The bishop on g4 pins the f3 knight to White's queen.", "White breaks the pin anyway because there is a mate.", "Lesson: before you grab the queen, check for checks."],
 main=("The trap", [
  ("e4", "White takes the centre."),
  ("e5", "Black answers."),
  ("Nf3", "The knight attacks e5."),
  ("d6", "Black protects e5 with a pawn (Philidor Defense)."),
  ("Bc4", "The bishop aims at f7."),
  ("Bg4", "Black pins the f3 knight to White's queen."),
  ("Nc3", "White develops."),
  ("g6", "A slow move. Black doesn't notice the danger on f7."),
  ("Nxe5", "Surprise! The knight takes, leaving the queen to be taken."),
  ("Bxd1", "Black grabs the queen. This loses."),
  ("Bxf7+", "Check! The bishop takes f7."),
  ("Ke7", "The only move for the king."),
  ("Nd5#", "Checkmate with three minor pieces. The queen was a bait."),
 ]),
 vars=[
  ("Black doesn't take the queen", 9, [
   ("dxe5", "Black takes the knight instead."),
   ("Qxg4", "White wins the bishop back and is a pawn up. Black still lost material, but no mate."),
  ]),
 ]))

G.append(dict(
 id="shilling", name="Blackburne Shilling Trap", side="b", level="Beginner", group="easy", families=["Italian Game"],
 about="A trick for Black in the Italian Game. Black moves the knight to d4 and leaves e5 unprotected. If White greedily takes on e5, Black's queen attacks and the game ends in mate.",
 ideas=["...Nd4 looks like a mistake but sets a trap.", "Greedy Nxe5 lets Black's queen attack g2 and f2.", "If White doesn't take, the trick is not very good, so use it carefully."],
 main=("The trap", [
  ("e4", "White takes the centre."),
  ("e5", "Black answers."),
  ("Nf3", "The knight attacks e5."),
  ("Nc6", "Black protects e5."),
  ("Bc4", "The Italian bishop aims at f7."),
  ("Nd4", "The trap: Black leaves e5 without protection."),
  ("Nxe5", "White takes the pawn greedily."),
  ("Qg5", "The queen attacks the knight on e5 and the pawn on g2."),
  ("Nxf7", "White also attacks the queen and the rook. It looks great for White."),
  ("Qxg2", "Black's queen attacks the h1 rook."),
  ("Rf1", "The rook escapes."),
  ("Qxe4+", "Check! The queen takes e4."),
  ("Be2", "White blocks with the bishop."),
  ("Nf3#", "Checkmate! A knight check that the king can't escape."),
 ]),
 vars=[
  ("The right answer for White", 6, [
   ("Nxd4", "White swaps knights instead of taking e5."),
   ("exd4", "Black takes back."),
   ("c3", "White opens lines and will win the d4 pawn or get a better centre."),
  ]),
 ]))

G.append(dict(
 id="englundtrap", name="Englund Gambit Trap", side="b", level="Beginner", group="easy", families=["Englund Gambit"],
 about="A trap for Black against 1.d4. Black offers a pawn, and if White plays a natural-looking bishop move, Black's queen runs into White's position and gives checkmate on c1.",
 ideas=["Black gives a pawn to get fast attacking chances.", "...Qb4+ attacks the king and the b2 pawn together.", "Against a good player this gambit is risky for Black."],
 main=("The trap", [
  ("d4", "White takes the centre."),
  ("e5", "The Englund Gambit: Black offers a pawn."),
  ("dxe5", "White takes."),
  ("Nc6", "Black attacks the e5 pawn."),
  ("Nf3", "White protects e5."),
  ("Qe7", "The queen attacks e5 again and prepares the trick."),
  ("Bf4", "A natural move that protects e5, but it falls into the trap."),
  ("Qb4+", "Check, and the queen also attacks b2."),
  ("Bd2", "White blocks."),
  ("Qxb2", "The queen takes b2 and attacks the a1 rook."),
  ("Bc3", "The bishop attacks the queen."),
  ("Bb4", "Black pins the bishop to the king."),
  ("Qd2", "White protects the bishop."),
  ("Bxc3", "Black takes."),
  ("Qxc3", "White takes back."),
  ("Qc1#", "Checkmate! The queen takes over the first row."),
 ]),
 vars=[
  ("The right answer for White", 6, [
   ("Qd5", "The queen protects e5 and attacks f7. White keeps the extra pawn and is better."),
  ]),
 ]))
