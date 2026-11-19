# Stockfish and the GPL: what Chess Sathi has to do

Not legal advice. This is a practical checklist from reading the GPLv3 and the Stockfish.js README. If Gupta Chess Academy ever sells Chess Sathi, ask a lawyer once.

## What we ship
`public/stockfish/stockfish-18-lite-single.js` + `.wasm` (Stockfish.js 18 by Nathan Rugg / Chess.com, based on Stockfish). Licence: **GPLv3**. We use the files **unmodified**.

## What the GPL asks of us when we pass the engine to users' browsers
1. **Keep the licence with the engine.** Done: `public/stockfish/COPYING.txt` and `README.txt` are served next to the engine files.
2. **Tell users it is GPL and where the source is.** Done: `/about/licenses.html` (linked from the account menu and the Game doctor screen) names the engine, its licence and both source repositories.
3. **Offer the "corresponding source".** For an unmodified engine, linking to the official release repositories is the usual practice. Strictly, the GPL (section 6) says you must make the source available from the same place or by written offer, so the safest long-term step is to **keep your own copy of the source for the exact version**: download the release archive of `nmrugg/stockfish.js` (version 18) and the matching `official-stockfish/Stockfish` source and keep them in a GitHub release of this repo (or any permanent link). Then replace the two links on the licences page with that copy. Do this if the upstream repositories ever change or disappear.
4. **If we ever change the engine** (rebuild it, edit it, bundle it differently), the changed source must be published under GPLv3 too, with a note of what changed.

## Does the GPL spread to the rest of Chess Sathi?
The engine runs as a separate program in a Web Worker and only talks to the app by text messages (UCI commands). That is normally treated as two separate programs, so the rest of the app can keep its own licence. We have not copied any Stockfish code into the app. If that ever changes (for example, importing engine code into `index.html`), this assessment changes and the app would have to be GPLv3 as well.

## Rules for the future
- Do not remove `COPYING.txt`, `README.txt` or the licences page.
- Do not rename the engine files without keeping the notice at the top of the `.js` file.
- The Stockfish name is a trademark-like name used by the project; we only say "powered by" and do not imply the engine is endorsed by us or the other way round.
