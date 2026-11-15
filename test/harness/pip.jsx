// Test only: the classroom's mini window with made-up people, without a real class.
// Make the page first (a copy of class.html, so the styles are the real ones), then open it through `npx vite`:
//   sed 's#/src/class.jsx#/test/harness/pip.jsx#' class.html > test/harness/pip.html   ->   /test/harness/pip.html?n=8
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { RoomContext } from "@livekit/components-react";
import "@livekit/components-styles";
import { Room } from "livekit-client";
import { usePip, PipWindow, P, drawEveryone } from "../../src/pip.jsx";
const room = new Room();
const n = +new URLSearchParams(location.search).get("n") || 6;
const names = ["Aarav Sharma", "Diya Patel", "kabir", "अनिकेत", "Zoya", "Meera Nair", "Rohan", "Ishaan Gupta", "Tara", "Vivaan", "Anaya", "Dev"];
for (let i = 0; i < n - 1; i++) {
  const p = Object.create(room.localParticipant);
  for (const [k, v] of Object.entries({ name: names[i % names.length], identity: "id" + i, sid: "PA_" + i, isLocal: false })) Object.defineProperty(p, k, { value: v });
  room.remoteParticipants.set(p.identity, p);
}
Object.defineProperty(room.localParticipant, "name", { value: "Teacher", configurable: true });
window.__draw = drawEveryone;
function App() {
  const [note, setNote] = useState("");
  const [mine, setMine] = useState(false);
  const pip = usePip((t) => setNote(t));
  const hands = { id1: 1, ...(mine ? { [room.localParticipant.identity]: 1 } : {}) };
  return (
    <div data-lk-theme="default" style={{ padding: 20 }}>
      <button id="open" className="dbtn" aria-pressed={pip.on} onClick={pip.toggle}>{P.pip}<span className="lbl">Mini window</span></button>
      <p id="state">{pip.kind}:{pip.on ? "on" : "off"} {note}</p>
      {pip.win ? <PipWindow win={pip.win} close={pip.close} hands={hands} mine={mine} toggleHand={() => setMine((m) => !m)} isTeacher /> : null}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<RoomContext.Provider value={room}><App /></RoomContext.Provider>);
