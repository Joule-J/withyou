import { useMemo } from "react";
import { Landing } from "./components/landing";
import { Room } from "./components/room";
import { useRoom } from "./hooks/use-room";

export default function App() {
  const initialRoomCode = useMemo(() => roomCodeFromPath(window.location.pathname), []);
  const room = useRoom(initialRoomCode);

  if (room.snapshot && room.participantId) {
    return (
      <Room
        snapshot={room.snapshot}
        participantId={room.participantId}
        status={room.status}
        error={room.error}
        serverNow={room.serverNow}
        onCommand={room.sendPlayerCommand}
        onReplaceQueueTracks={room.replaceQueueTracks}
        onAdvanceQueue={room.advanceQueue}
        onPreviousQueue={room.previousQueue}
        onLeave={room.leaveRoom}
      />
    );
  }

  return (
    <Landing
      initialRoomCode={initialRoomCode ?? ""}
      connected={room.status === "connected"}
      error={room.error}
      onCreate={room.createRoom}
      onJoin={room.joinRoom}
    />
  );
}

export function roomCodeFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/room\/([A-Za-z0-9]{6})\/?$/);
  return match ? match[1].toUpperCase() : null;
}
