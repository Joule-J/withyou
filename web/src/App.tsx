import { useMemo } from "react";
import { FlowerBurst } from "./components/flower-burst";
import { Landing } from "./components/landing";
import { Room } from "./components/room";
import MobileRoom from "./components/mobile-room";
import { useRoom } from "./hooks/use-room";

export default function App() {
  const initialRoomCode = useMemo(() => roomCodeFromPath(window.location.pathname), []);
  const room = useRoom(initialRoomCode);
  const isMobile = useMemo(() => typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent), []);

  if (room.snapshot && room.participantId) {
    if (isMobile) {
      return (
        <>
          <FlowerBurst />
          <MobileRoom
            snapshot={room.snapshot}
            participantId={room.participantId}
            status={room.status}
            error={room.error}
            serverNow={room.serverNow}
            onCommand={room.sendPlayerCommand}
            onAddQueueTracks={room.addQueueTracks}
            onReplaceQueueTracks={room.replaceQueueTracks}
            onReorderQueue={room.reorderQueue}
            onAdvanceQueue={room.advanceQueue}
            onPreviousQueue={room.previousQueue}
            onLeave={room.leaveRoom}
          />
        </>
      );
    }

    return (
      <>
        <FlowerBurst />
        <Room
          snapshot={room.snapshot}
          participantId={room.participantId}
          status={room.status}
          error={room.error}
          serverNow={room.serverNow}
          onCommand={room.sendPlayerCommand}
          onAddQueueTracks={room.addQueueTracks}
          onReplaceQueueTracks={room.replaceQueueTracks}
          onReorderQueue={room.reorderQueue}
          onAdvanceQueue={room.advanceQueue}
          onPreviousQueue={room.previousQueue}
          onLeave={room.leaveRoom}
        />
      </>
    );
  }

  return (
    <>
      <FlowerBurst />
      <Landing
        initialRoomCode={initialRoomCode ?? ""}
        connected={room.status === "connected"}
        error={room.error}
        onCreate={room.createRoom}
        onJoin={room.joinRoom}
      />
    </>
  );
}

export function roomCodeFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/room\/([A-Za-z0-9]{6})\/?$/);
  return match ? match[1].toUpperCase() : null;
}
