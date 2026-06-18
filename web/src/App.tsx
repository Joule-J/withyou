import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowerBurst } from "./components/flower-burst";
import { Landing } from "./components/landing";
import { Room } from "./components/room";
import MobileRoom from "./components/mobile-room";
import { useRoom } from "./hooks/use-room";

const EXIT_GUARD_STATE_KEY = "withyouRoomExitGuard";

export default function App() {
  const initialRoomCode = useMemo(() => roomCodeFromPath(window.location.pathname), []);
  const room = useRoom(initialRoomCode);
  const isMobile = useMemo(() => typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent), []);
  const [vinylShift, setVinylShift] = useState(false);
  const [decorVinylSrc, setDecorVinylSrc] = useState("/vinyls/13.png");
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const lastTrackIdRef = useRef<string | null>(null);
  const vinylShiftTimeoutRef = useRef<number | null>(null);
  const guardedRoomCodeRef = useRef<string | null>(null);
  const exitGuardActiveRef = useRef(false);

  const triggerVinylShift = useCallback((nextVinylSrc?: string) => {
    if (vinylShiftTimeoutRef.current !== null) {
      window.clearTimeout(vinylShiftTimeoutRef.current);
    }

    setVinylShift(false);
    window.requestAnimationFrame(() => {
      setVinylShift(true);
      if (nextVinylSrc) {
        window.setTimeout(() => setDecorVinylSrc(nextVinylSrc), 650);
      }
      vinylShiftTimeoutRef.current = window.setTimeout(() => {
        setVinylShift(false);
        vinylShiftTimeoutRef.current = null;
      }, 1_550);
    });
  }, []);

  useEffect(() => {
    const trackId = room.snapshot?.playback?.videoId ?? null;
    if (!trackId) return;
    if (lastTrackIdRef.current === null) {
      lastTrackIdRef.current = trackId;
      return;
    }
    if (lastTrackIdRef.current === trackId) return;

    lastTrackIdRef.current = trackId;
    triggerVinylShift();
  }, [room.snapshot?.playback?.videoId, triggerVinylShift]);

  useEffect(() => {
    return () => {
      if (vinylShiftTimeoutRef.current !== null) {
        window.clearTimeout(vinylShiftTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const roomCode = room.snapshot?.roomCode ?? null;
    if (!roomCode || !room.participantId) {
      exitGuardActiveRef.current = false;
      guardedRoomCodeRef.current = null;
      setShowExitConfirm(false);
      return;
    }

    const ensureGuardEntry = () => {
      window.history.pushState({ [EXIT_GUARD_STATE_KEY]: true, roomCode }, "", `/room/${roomCode}`);
      guardedRoomCodeRef.current = roomCode;
      exitGuardActiveRef.current = true;
    };

    const snapshotStillActive = (code: string) =>
      exitGuardActiveRef.current &&
      guardedRoomCodeRef.current === code &&
      room.snapshot?.roomCode === code;

    if (!snapshotStillActive(roomCode)) {
      ensureGuardEntry();
    }

    const handlePopState = () => {
      if (!snapshotStillActive(roomCode)) return;
      ensureGuardEntry();
      setShowExitConfirm(true);
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!snapshotStillActive(roomCode)) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [room.snapshot?.roomCode, room.participantId, room.leaveRoom]);

  const requestLeaveRoom = useCallback(() => {
    setShowExitConfirm(true);
  }, []);

  const confirmLeaveRoom = useCallback(() => {
    exitGuardActiveRef.current = false;
    guardedRoomCodeRef.current = null;
    setShowExitConfirm(false);
    room.leaveRoom();
  }, [room.leaveRoom]);

  const cancelLeaveRoom = useCallback(() => {
    setShowExitConfirm(false);
  }, []);

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
            onTransferHost={room.transferHost}
            onAdvanceQueue={room.advanceQueue}
            onPreviousQueue={room.previousQueue}
            onLeave={requestLeaveRoom}
          />
          {showExitConfirm ? (
            <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Odadan çıkış onayı">
              <div className="confirm-overlay-backdrop" onClick={cancelLeaveRoom} />
              <section className="confirm-panel">
                <div className="confirm-copy">
                  <span className="modal-kicker">ARE YOU SURE?</span>
                  <h2>Odadan çık</h2>
                  <p>Bu oda görünümünden ayrılacaksın.</p>
                </div>
                <div className="confirm-actions">
                  <button type="button" className="confirm-secondary" onClick={cancelLeaveRoom}>
                    Kal
                  </button>
                  <button type="button" className="confirm-danger" onClick={confirmLeaveRoom}>
                    Çık
                  </button>
                </div>
              </section>
            </div>
          ) : null}
        </>
      );
    }

    return (
      <>
        <FlowerBurst />
        <div
          className={`vinyl-decor spinning${room.snapshot.playback?.isPlaying ? "" : " paused"}${vinylShift ? " shifting" : ""}`}
          aria-hidden="true"
        >
          <img src={decorVinylSrc} alt="" />
        </div>
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
          onTransferHost={room.transferHost}
          onAdvanceQueue={room.advanceQueue}
          onPreviousQueue={room.previousQueue}
          onPlaylistVinylSwap={triggerVinylShift}
          onLeave={requestLeaveRoom}
        />
        {showExitConfirm ? (
          <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Odadan çıkış onayı">
            <div className="confirm-overlay-backdrop" onClick={cancelLeaveRoom} />
            <section className="confirm-panel">
              <div className="confirm-copy">
                <span className="modal-kicker">ARE YOU SURE?</span>
                <h2>Odadan çık</h2>
                <p>Bu oda görünümünden ayrılacaksın.</p>
              </div>
              <div className="confirm-actions">
                <button type="button" className="confirm-secondary" onClick={cancelLeaveRoom}>
                  Kal
                </button>
                <button type="button" className="confirm-danger" onClick={confirmLeaveRoom}>
                  Çık
                </button>
              </div>
            </section>
          </div>
        ) : null}
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
