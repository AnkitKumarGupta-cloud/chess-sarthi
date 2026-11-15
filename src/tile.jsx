import React from "react";
import { ParticipantTile, useMaybeTrackRefContext } from "@livekit/components-react";

// A tile that shows the person's initial in a coloured circle while their camera is off.
// The letter and colour reach the stylesheet as CSS variables on the tile.
const AVATAR_HUES = [4, 28, 48, 140, 172, 200, 226, 262, 292, 330];
export function Tile() {
  const ref = useMaybeTrackRefContext();
  const p = ref && ref.participant;
  const name = ((p && (p.name || p.identity)) || "?").trim();
  let h = 0; for (const ch of (p && p.identity) || name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initial = (name.match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase();
  return <ParticipantTile style={{ "--ini": JSON.stringify(initial), "--hue": AVATAR_HUES[h % AVATAR_HUES.length] }} />;
}
