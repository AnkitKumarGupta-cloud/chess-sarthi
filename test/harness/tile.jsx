// Test only: shows camera-off tiles for a few names without a real class.
import React from "react";
import { createRoot } from "react-dom/client";
import { RoomContext, TrackRefContext, TrackToggle } from "@livekit/components-react";
import "@livekit/components-styles";
import { Room, Track, LocalParticipant } from "livekit-client";
import { Tile } from "../../src/tile.jsx";
const room = new Room();
const names = ["Aarav Sharma", "Diya Patel", "Teacher", "kabir", "अनिकेत", "Zoya (demo)"];
const people = names.map((n, i) => { const p = Object.create(room.localParticipant); Object.defineProperty(p, "name", { value: n }); Object.defineProperty(p, "identity", { value: "id" + i }); return p; });
createRoot(document.getElementById("root")).render(
  <RoomContext.Provider value={room}><div className="g" data-lk-theme="default">
    {people.map((p, i) => <div key={i} className={i === 5 ? "small" : ""}><TrackRefContext.Provider value={{ participant: p, source: Track.Source.Camera }}><Tile /></TrackRefContext.Provider></div>)}
  </div>
  <div className="dock" style={{ position: "fixed", bottom: 10, left: 10, display: "flex", gap: 8 }}>
    <TrackToggle source={Track.Source.Microphone} showIcon={false} className="dbtn"><span className="i-on">ON</span><span className="i-off">OFF</span><span className="lbl">Mic</span></TrackToggle>
  </div></RoomContext.Provider>);
