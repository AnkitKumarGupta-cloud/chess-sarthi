// Test-only harness: a teacher and two students wired together through fake LiveKit rooms.
import React from "react";
import { createRoot } from "react-dom/client";
import { Room, RoomEvent } from "livekit-client";
import { RoomContext } from "@livekit/components-react";
import { usePuzzle, TeacherPuzzle, StudentPuzzle } from "../../src/puzzle.jsx";

const P = {
  teacher: { identity: "teacher", name: "Teacher", metadata: '{"role":"teacher"}' },
  aarav: { identity: "aarav", name: "Aarav", metadata: '{"role":"student"}' },
  diya: { identity: "diya", name: "Diya", metadata: '{"role":"student"}' },
};
const rooms = {};
window.__log = [];
function mk(id) {
  const r = new Room();
  r.localParticipant.publishData = async (data, opts) => {
    window.__log.push({ from: id, to: opts.destinationIdentities || "all", msg: JSON.parse(new TextDecoder().decode(data)) });
    for (const [oid, other] of Object.entries(rooms)) {
      if (oid === id || !other.__present) continue;
      if (opts.destinationIdentities && !opts.destinationIdentities.includes(oid)) continue;
      setTimeout(() => other.emit(RoomEvent.DataReceived, data, P[id], undefined, opts.topic), 30);
    }
  };
  rooms[id] = r; return r;
}
const T = mk("teacher"), A = mk("aarav"), D = mk("diya");
T.__present = true; A.__present = true;
T.remoteParticipants.set("aarav", P.aarav);
A.remoteParticipants.set("teacher", P.teacher); D.remoteParticipants.set("teacher", P.teacher);
window.__join = () => { D.__present = true; T.remoteParticipants.set("diya", P.diya); T.emit(RoomEvent.ParticipantConnected, P.diya); };

function TeacherSide() { const pz = usePuzzle(true); window.__tpz = pz; return <TeacherPuzzle pz={pz} />; }
function StudentSide({ who }) { const pz = usePuzzle(false); window["__" + who] = pz; return <StudentPuzzle pz={pz} />; }
createRoot(document.getElementById("root")).render(
  <div className="wrap">
    <div className="col" id="tcol"><h3>TEACHER</h3><RoomContext.Provider value={T}><TeacherSide /></RoomContext.Provider></div>
    <div className="col" id="acol"><h3>AARAV</h3><RoomContext.Provider value={A}><StudentSide who="aarav" /></RoomContext.Provider></div>
    <div className="col" id="dcol"><h3>DIYA (joins late)</h3><RoomContext.Provider value={D}><StudentSide who="diya" /></RoomContext.Provider></div>
  </div>
);
