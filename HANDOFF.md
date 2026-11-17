# Chess Sathi: handover notes

Live site: **https://chess-sathi-live.vercel.app**
Code you deploy from: **https://github.com/AnkitKumarGupta-cloud/chess-sarthi** (branch `main`)
Backup copy: https://github.com/AnkitKumarGupta-cloud/chess (`main` = same code, `old-main` = the old Gupta Chess Academy site)

## How the pieces connect

```
GitHub AnkitKumarGupta-cloud/chess-sarthi  ──push to main──►  Vercel project "chess-sathi-live"  ──►  chess-sathi-live.vercel.app
                                                          │
                     ┌────────────────────────────────────┼────────────────────────────────┐
                     ▼                                    ▼                                ▼
          Upstash Redis (Vercel Storage)        LiveKit Cloud project "chess sathi"   (optional) Cloudflare R2
          "upstash-kv-crimson-garden"           live video, 5,000 free min/month      class recordings, NOT set up
          stores users, classes                 key: "Chess Sathi website (Vercel)"
```

Vercel environment variables (Settings → Environment Variables of `chess-sathi-live`):

| Variable | What it is | Status |
|---|---|---|
| `TEACHER_PASSWORD` | Teacher login password (username `teacher`) | set |
| `SESSION_SECRET` | Signs login sessions. Never share. | set |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (+ `KV_URL`, `KV_REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN`) | Upstash database, added by Vercel when the store was connected | set |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit Cloud project | set |
| `RECORD_S3_ENDPOINT`, `RECORD_S3_BUCKET`, `RECORD_S3_ACCESS_KEY`, `RECORD_S3_SECRET`, `RECORD_PUBLIC_URL` | Cloudflare R2 bucket for recordings | not set (recording is off) |

Accounts used: Vercel team "kishkishkish123-7008's projects", GitHub `AnkitKumarGupta-cloud` (repo chess-sarthi), LiveKit Cloud (account "krishna agarwal"), Upstash via Vercel.
Vercel Deployment Protection must stay **off** for `chess-sathi-live`, or students get a Vercel login wall.

## What the app has

- **Login first.** Teacher signs in as `teacher`. On the **Live** tab the teacher adds students (makes a username + password to send on WhatsApp), resets or deletes them. No sign-up, no parent logins.
- **Home:** dashboard (continue lesson, daily goal, puzzle of the day, rank, next live class, totals). XP, streak, ranks Pawn → King.
- **Courses:** 4 courses, 12 voiced video lessons on a learning path.
- **Live:** teacher schedules classes per batch; students of that batch see Join. Classroom (LiveKit): video, mic/camera pickers, screen share (teacher and students, computers only), chat, people list, raise hand, backgrounds (blur / pictures), End/Leave. Recording starts automatically only when R2 is set up.
- **Practice:** 32 topics / 316 positions from Lichess practice, 5 sections. Play against Stockfish (runs in the browser) until the goal is reached. Hint, take back, restart, full screen, move list. 10 XP per position.
- **Puzzles:** 115 levels × 10 puzzles (rating ~500 → ~2800) from the Lichess puzzle database (CC0) on an illustrated map of 6 worlds (Meadow, Forest, Desert, Snow, Fire, Castle; artwork made with ChatGPT). Stars, unlocks, full screen. Old 39 classic puzzles still open from the home "Puzzle of the day" tile.
- **Tests:** a new 10-question test each time, matched to the student's puzzle level (the highest level unlocked): 3 knowledge questions from a 4-tier bank (Beginner ≤ level 5, Intermediate ≤ 20, Advanced ≤ 45, Expert above) + 7 "find the best move" positions from the levels at and just above theirs. Bank: `QBANK` in `public/index.html`.
- **Progress sync:** a student's progress (lessons, puzzles, tests, practice, daily XP, puzzle levels) is saved in the browser and copied to the server 3 s after any change (`/api/progress`; Redis `p:<user>` = full state, `ps:<user>` = summary). On sign-in it is merged with the server copy, so it follows the student to any device; a different student's leftovers on a shared device are cleared. Deleting a student deletes their progress.
- **Teacher's Progress tab** shows the Student progress table: puzzles solved and level, practice, lessons, best test, XP and rank, last active; filter by batch; tap a student for more. Students who haven't opened the app since this update show as "Not opened".
- No Sound/Voice buttons: move sounds and lesson voice are always on.
- **Puzzle in live class** (`src/puzzle.jsx`): the teacher opens **Puzzle** in the classroom, picks a puzzle from any of the 115 levels, or pastes a **PGN** (steps to any move; the game's next moves can fill in the answer) or a **FEN** (plays the answer), and sends it. Every student gets it on their own board; the teacher sees live who solved it, how fast and how many wrong tries. **Show answer to everyone** ends it. Students who join late get the current puzzle. Messages go over LiveKit's data channel (topic `puzzle`), nothing is stored. Test page: `npx vite` then open `/test/harness/puzzle.html` (not deployed).
- **Puzzle rating:** each puzzle-level puzzle counts once, Elo-style against the puzzle's own difficulty, starting at 600. Score: clean solve 1, used a hint 0.6, one wrong move 0.35, more wrong moves or "show solution" 0, so a hint costs only a few points. Shown as "Your rating" after each puzzle, on the map bar, on Progress and in the teacher's table; a puzzle's own number is shown as "difficulty". Stored in `S.pr`, synced with progress.
- **Demo login:** one shared, permanent login, username `demo`, password = the `DEMO_PASSWORD` setting in Vercel (set to `ankit@12`). Shown with a WhatsApp message on the teacher's Live tab. It can join any class; every other tab shows a lock; it can't change its password or save progress, and isn't in the progress table. In the classroom each visitor types a name and gets their own identity (`demo-xxxx`), so many can join at once. To change the password, edit `DEMO_PASSWORD` in Vercel and redeploy.
- **Backups:** teacher's Live tab has **Download backup** (`/api/backup`: every account (passwords hashed), class and student progress as one JSON file). A Vercel Cron calls `/api/keepalive` daily (vercel.json) so the free Upstash database is never archived for inactivity. Also switch on Daily Backup in the Upstash dashboard.
- **Fast start:** the signed-in user is saved in the browser (`S.liveUser`), so a returning user sees the app at once; `/api/me` is checked once in the background (an expired login signs out). chess.js is served from `/vendor/` (cached for a year), and Google Fonts load without blocking the first paint.
- **Theme switch** in the profile menu (Auto / Light / Dark). Saved per device in `localStorage` key `cs-theme`; Auto follows the device setting. Applied by a tiny script in `<head>` so there is no flash.
- **Board pages** (practice, puzzle levels, classic puzzles) use a Lichess-style layout: on computers the board fills the screen height with a compact panel on its right (goal, status, Next, buttons, About, position list); on phones and narrow windows (under 900px) the panel moves below the board. No Full screen button any more.
- **Phones:** on practice and puzzle boards the board, status and Next button fit on one screen (checked at 360×640 up to 412×915). Students can "Add to Home screen" (`public/manifest.webmanifest`, icons in `public/icons/`) and it opens like an app, without the browser bar.
- **Puzzle levels save after every puzzle** (`S.lv.part`), so a reload mid-level keeps the solved puzzles and reopens at the first unsolved one.
- Pieces: "cburnett" set (Colin M.L. Burnett, GPLv2+). Board: our own brown colours. Move sounds: wooden knocks from Kenney "Impact Sounds" (CC0) in `public/sounds/` (move, capture, castle = two knocks); the small chimes for check/right/wrong/solved are generated in the browser.
- Credits are no longer shown in the app; they stay in code comments, in `public/stockfish/` (licence file) and here. Lichess puzzles and practice positions are CC0.

## How to change things

1. Edit the code (main file: `public/index.html`; classroom: `src/class.jsx` + `class.html`; server: `api/*.js`).
2. `npm test` (checks the server API with fakes) and `npx vite build`.
3. Optional local demo: `npm run build && node test/dev-server.mjs` → http://localhost:4173 (teacher password `demo-teacher`).
4. Push to `main` of `AnkitKumarGupta-cloud/chess-sarthi` → Vercel deploys in ~1 minute.

## File map

| Path | What |
|---|---|
| `public/index.html` | The whole main app (all pages, styles, logic) |
| `public/practice.json` | Practice topics and positions |
| `public/levels.json` | 115 puzzle levels |
| `public/worlds/w0..w5.webp` | Puzzle map artwork |
| `public/stockfish/` | Chess engine (GPLv3, licence included) |
| `public/mediapipe/` | Background-blur engine for the classroom |
| `class.html`, `src/class.jsx` | Live classroom page (React + LiveKit) |
| `api/_lib.js` | Login, database, LiveKit tokens, recording helpers |
| `api/login.js me.js password.js users.js classes.js join.js record.js recordings.js` | Server endpoints |
| `test/` | API tests, fakes, local demo server |
| `SETUP.md` | Step-by-step setup of every service |

## Not done yet / ideas

- Recording: needs a Cloudflare R2 bucket + the five `RECORD_*` variables. LiveKit free plan includes only ~60 recorded minutes a month.
- Mobile app (Expo, separate zip `chess-sathi.zip`): needs `SITE_URL` set in `src/config.js`; not tested on a phone; doesn't have Practice/Puzzle levels yet.
- Old Vercel projects `chess`, `chess_sathi`, `chess-sathi`, `chess--sathi-yyrr` are unused and can be deleted.

## Design rules (premium pass, Nov 2026)
- One font (Instrument Sans). No monospace or display font; use `font-variant-numeric:tabular-nums` for numbers.
- Three accent colours only: red = action/brand, gold = reward, green = correct. No decorative tints.
- Cards are flat (no border + shadow). Only the Home "Continue" card and hovered clickable cards lift.
- No emoji in the UI. Use `ico("flame"|"bolt"|"trophy"|"trend"|"target"|"star"|"medal")`. Chess piece glyphs are fine.
- Loading states use `skel("board"|"rows"|"cards")`, not "Loading…" text.
- Milestones call `celebrate(iconName,title,sub)`; keep it for real progress only.
- The last block in the `<style>` tag is the premium layer; put overrides there.
- Icons: menu tabs, practice topics (`practice.json` → `icons`) and classroom buttons all use Lucide (ISC licence) paths. Add new ones from lucide.dev so the set stays consistent. The logo pawn lives in `public/icons/icon.svg`; PNG sizes are rendered from it.

## Puzzle mistakes, teacher insight and "last opened" (Nov 2026)
- `S.pm` records each level puzzle once, on the first attempt: totals, per-theme counts and the latest 40 missed puzzles (`pmRecord` in `lvSolved`). It syncs with the rest of progress (`pm` in `PROG_KEYS` / `STATE_KEYS`).
- The summary sent to the server carries `insight` (`pmSummary()`); `api/progress.js` cleans it (`cleanInsight`).
- Teacher → Progress → tap a student: `tpInsight` shows plain-sentence insight (`pmInsight`) and the missed puzzles, each opening a board with the answer.
- Only level puzzles are counted (not tests, practice or the classic set), and only from this update onward.
- Redis `seen:<username>` = when a student last opened the app (set in `/api/me` and `/api/login` by `markSeen`). Shown as "Last opened" on Progress and in Live → Students.

## Score-sheet reader (`/reader/`, Nov 2026)
- Self-contained page in `public/reader/` (no build step): `logic.js` (pure rules, unit-tested), `api.js` (the three calls to the hosted model, photo checks, draft storage), `viewer.js` (pan/zoom photo), `app.js` (screen), `reader.css`, `pieces.css`.
- The model is a public Hugging Face Space (`BASE` in `api.js`), called from the user's device, never through our server: its free GPU quota is per IP address.
- Rules that must not change without asking the owner (they are listed at the top of `logic.js`): `written` is never modified; legality only flags; after the first unplayable move the rest is "unchecked"; everything from the model is untrusted text (the page only uses `textContent`, and has a strict CSP with no inline script or style).
- Draft: session JSON in localStorage `cs-reader.draft`, photos in IndexedDB `cs-reader`. Saved games: localStorage `cs-reader.games` (this device only).
- Access: signed-in students and coaches (reads `targetchess.v2` from localStorage); demo logins and signed-out visitors are turned away. This is a screen-level check only, since the model itself is public.
- Tests: `node test/reader.test.mjs` (part of `npm test`) and `python3 test/reader-e2e.py` (Playwright, reader calls mocked; needs the dev server running).
- `test/fixtures/reader-result.json` is a STAND-IN made to match the brief's numbers (60 moves, move 14 read as Qf4 instead of Rfd1). Replace it with the real read when available; the "26 of 60" and "33 of 60" expectations may need adjusting to the real file.
- Review line (changed 15 Nov 2026 with the owner's OK): a move joins the "left to check" queue below confidence 0.70 (`LOW_CONF`); from 0.70 to 0.90 (`NOTE_CONF`) it only gets a ! on its chip. Reason: on 5 hand-labelled test sheets, 0.90 flagged 74 of 601 moves and 46 of those were correct.
- `fixCase` also repairs capital-letter slips the model makes: F3 -> f3, KF4 -> Kf4, Exd5 -> exd5, X -> x. `written` still keeps the original text.

## Classroom mini window (picture-in-picture)

Code: `src/pip.jsx`, used from `src/class.jsx`; styles are the `.pip…` and `.pbtn` rules at the end of `class.html`.

- **Mini window** button in the dock (only on browsers that can't open it by themselves; hidden on Chrome/Edge computers since 15 Nov 2026, where it opens automatically on tab switch), and **Open app** in the class header (opens the website in a new tab and starts the mini window, so the class is never left).
- Chrome, Edge, Opera, Brave on a computer use Document Picture-in-Picture: a real floating window showing everyone (`PipWindow`, rendered with a React portal; the page's styles are copied into it). It can be moved, resized and closed. It also opens by itself when the user switches tabs (`mediaSession` action `enterpictureinpicture`; Chrome allows this while the camera or microphone is in use, and the user can switch it off in the site settings).
- Other browsers and phones get one picture-in-picture video with everyone drawn into it on a canvas (`useVideoPip`, `drawEveryone`). It has no buttons, and it has not been tried on a real iPhone, Android phone, Safari or Firefox.
- `window.open` must come **after** `requestWindow` in the same click (the other order is refused by Chrome).
- Test without a class: `test/harness/pip.jsx` (see the top of that file). Not tested in a real class with real cameras.

## Before joining a class (lobby, 15 Nov 2026)
- After the class opens, everyone sees "Ready to join?" with a camera preview and mic / camera buttons (like Google Meet), then **Join now**. `Lobby` in `src/class.jsx`, styles `.lobby…` in `class.html`.
- Starting choice: last time's choice on this device (localStorage `cs.av`), otherwise camera on, mic on for the teacher and off for students.
- If the browser blocks the camera or mic, that switch turns off and a note says to allow it in the address bar.
- Test: `node test/dev-server.mjs` then `python3 /home/claude/tools/lobby.py` (fake camera, desktop + phone sizes).

## Puzzle from the teacher's screen (Puzzle panel → "My screen", 15 Nov 2026)
- The teacher shows a puzzle on the shared screen and presses **Read the board**. One picture of the shared screen is read; the teacher checks the position (unsure squares have a gold ring; pick a piece, tap a square to fix), sets which side is at the bottom and who moves, presses **Use this position**, plays the answer as with a FEN, and sends.
- Not sharing? The browser asks for one window or tab, takes one picture and stops.
- Sharing the **whole screen**: while the teacher is on another tab, a picture is kept every 1.5 s (`useAwaySnapshots`); the newest one is read, because at the moment of the click the screen shows this class page.
- Code: `src/boardscan.js` (finds the board, cuts 64 squares, small neural network, chess-rule cleanup), `src/scanworker.js` (runs it off the main thread), `src/screengrab.js` (picture taking), `ScreenPosition` in `src/puzzle.jsx`. Model: `public/scan/pieces.bin` (360 KB, loaded only when used). All on the teacher's device; nothing is sent to a server.
- Accuracy on test screenshots: 36 of 36 boards found; 100% of squares on 24 flat boards, 99.9% on 12 wood/marble boards. Works best on flat 2D boards (Lichess, Chess.com, our app); 3D boards, photos and arrows drawn on the board will need fixing by hand. Not yet tried in a real class.
- Retrain: `tools/boardscan/` (`gen.py` makes squares from Lichess piece sets in a lila checkout, `train.py` trains and writes the .bin, `shots.py` + `run.mjs` test whole screenshots).
- Test: `npx vite --port 5179` then `python3 test/scan-e2e.py`.

## Speed (15 Nov 2026)
- One font file served from this site: `public/fonts/instrument-sans.woff2` (30 KB, weights 400–700, Latin; SIL OFL in `public/fonts/OFL.txt`), preloaded on every page. No Google Fonts connections any more. The classroom page dropped Unbounded and JetBrains Mono (design rule: one font).
- Cache headers in `vercel.json`: `/assets`, `/vendor`, `/fonts` 1 year (file names change when content changes); `/stockfish`, `/mediapipe`, `/scan`, `/voice` 30 days; icons, worlds, backgrounds, sounds 7 days. **When you replace a file in a 30-day/7-day folder, give it a new name or a new `?v=`** (the board-reader model is loaded as `pieces.bin?v=1`).
- Classroom: the background-blur engine (MediaPipe) loads 3 s after the class opens instead of with the page (class code 306 KB → 263 KB gzipped). When a Join / Start button is on screen (Home tile or Live tab), the classroom code is downloaded in the background (`prefetchClass` in `index.html`).
- Home "Live class" tile draws last time's list at once (localStorage `cs-classes:<username>`, up to 6 h old), then the fresh one. The same GET sent twice within 4 s shares one request (`liveApi`).
- Server functions already run in Mumbai (bom1).
- Puzzle map art (`public/worlds/w0..w5.webp`): re-saved at WebP quality 65 (1.5 MB → 1.06 MB, same 1024×1536 size). Each world first shows a tiny blurred preview built into the page (`WORLD_TINY`), then the full picture: the current world's at once, the others only when scrolled near (IntersectionObserver). Home fetches the current world's picture while idle. Pictures load as `?v=2`; bump it (and remake `WORLD_TINY`) if the art changes.

## Openings tab (15 Nov 2026)
- New tab **Openings** (`#openings`, after Lessons). 26 openings explained move by move in simple words: 5 easy traps shown first (Scholar's Mate, Fool's Mate, Légal's Mate, Blackburne Shilling, Englund trap, each with how to stop it), 9 for White, 12 defences for Black; 73 lines, 953 move notes, each with an "About" text and 3 key ideas. Plus every named line from the Lichess chess-openings list (CC0): 149 families, 3,865 lines, searchable by name or moves.
- Pages: `#openings` (cards + search + all families), `#ofam?f=<family>` (all lines of a family, filter box), `#opening?id=<id>&l=<line>` (explained line) and `#opening?f=<family>&i=<n>` (Lichess line). Player: Start/Back/Play/Next/Flip, tap any move, arrow keys. Switching to a variation jumps to the move where it leaves the main line.
- Lichess lines use our written note when the same move order appears in the guide; other moves get a plain description ("Black develops the knight to f6").
- Data: `public/openings/guide.json` (48 KB) and `all.json` (300 KB, 52 KB gzipped, loaded only when searching or listing families). Edit the text in `tools/openings/guide1-3.py`, then run `python3 tools/openings/build.py public/openings` (needs `pip install chess` and a clone of lichess-org/chess-openings in `co/` next to the script). Bump `?v=` in `opLoad` (guide.json is v=2) when the files change.
- Code: "Openings" block before `const VIEWS` in `public/index.html`.

## Repo moved (15 Nov 2026)
- Code now lives at **AnkitKumarGupta-cloud/chess-sarthi** (branch main), full history copied. Vercel project chess-sathi-live is connected to it; every push to main deploys.
- Why: the Vercel account's GitHub sign-in became AnkitKumarGupta-cloud, so the old repo (kishkishkish123-wq/chess-) showed "Project Link not found" and stopped deploying. The old repo still exists but is no longer used; don't push there.
- Plain intros (17 Nov 2026): every explained opening has `short`, `starts`, `why`, `named` (text in `tools/openings/intro.py`). Cards show the short line; the opening page starts with a "What is the …?" box. List is grouped: traps, Playing White, Black vs 1.e4, Black vs 1.d4, with a "What is an opening?" note at the top. guide.json is v=3.
