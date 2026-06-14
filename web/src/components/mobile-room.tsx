import { useCallback, useState } from "react";
import type { PlayerCommand, RoomSnapshot } from "../types";
import type { YouTubePlayerHandle } from "./youtube-player";
import { YouTubePlayer } from "./youtube-player";

type Props = {
  snapshot: RoomSnapshot;
  participantId: string;
  status: "connecting" | "connected" | "disconnected";
  error: string | null;
  serverNow: () => number;
  onCommand: (command: PlayerCommand) => void;
  onAddQueueTracks: (musicUrls: string[], insertAfterId?: string) => void;
  onReplaceQueueTracks: (musicUrls: string[]) => void;
  onReorderQueue: (orderedTrackIds: string[]) => void;
  onAdvanceQueue: () => void;
  onPreviousQueue: () => void;
  onLeave: () => void;
};

export function MobileRoom({
  snapshot,
  participantId,
  status,
  error,
  serverNow,
  onCommand,
  onAddQueueTracks,
  onReplaceQueueTracks,
  onAdvanceQueue,
  onPreviousQueue,
  onLeave,
}: Props) {
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [showQueue, setShowQueue] = useState(true);
  const playback = snapshot.playback;
  const isHost = snapshot.hostParticipantId === participantId;

  const playPause = useCallback(() => {
    if (!playback) return;
    onCommand({
      type: playback.isPlaying ? "pause" : "play",
      videoId: playback.videoId,
      musicUrl: playback.musicUrl,
      title: playback.title,
      positionSeconds: playback.positionSeconds ?? 0,
      clientCommandId: crypto.randomUUID(),
    });
  }, [playback, onCommand]);

  const skipNext = useCallback(() => {
    if (!isHost) return;
    onAdvanceQueue();
  }, [isHost, onAdvanceQueue]);

  const skipPrev = useCallback(() => {
    if (!isHost) return;
    onPreviousQueue();
  }, [isHost, onPreviousQueue]);

  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-brand">
          <strong>WithYou</strong>
          <button className="mobile-leave" onClick={onLeave}>Çık</button>
        </div>
        <div className="mobile-status">{status}</div>
      </header>

      <main className="mobile-main">
        <div className="mobile-player">
          {playback ? (
            <YouTubePlayer onReady={() => {}} onError={() => {}} onEnded={() => { if (isHost) onAdvanceQueue(); }} />
          ) : (
            <div className="mobile-empty">Şarkı bekleniyor</div>
          )}
          <div className="mobile-now">
            <div className="mobile-now-title">{playback?.title ?? "Henüz çalmıyor"}</div>
            <div className="mobile-now-controls">
              <button onClick={skipPrev} aria-label="Önceki">◀◀</button>
              <button onClick={playPause} aria-label="Oynat/Duraklat">{playback?.isPlaying ? "⏸" : "▶"}</button>
              <button onClick={skipNext} aria-label="Sonraki">▶▶</button>
            </div>
          </div>
        </div>

        <div className="mobile-actions">
          <button onClick={() => setShowPlaylists((s) => !s)} className="mobile-action">📚 Listeler</button>
          <button onClick={() => setShowQueue((s) => !s)} className="mobile-action">📜 Sıra</button>
        </div>

        {showPlaylists ? (
          <section className="mobile-panel mobile-playlists">
            <h3>Listeler</h3>
            <p className="muted">Tüm listeler burada gösterilecek — dokunup çalın.</p>
            <ul>
              {snapshot && snapshot.queue && snapshot.queue.slice(0, 20).map((t) => (
                <li key={t.id} className="mobile-list-item">
                  <button onClick={() => {
                    if (!isHost) return;
                    onCommand({
                      type: "change_track",
                      videoId: t.videoId,
                      musicUrl: t.musicUrl,
                      title: t.title,
                      positionSeconds: 0,
                      clientCommandId: crypto.randomUUID(),
                      isPlaying: true,
                    });
                  }}>{t.title}</button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {showQueue ? (
          <section className="mobile-panel mobile-queue">
            <h3>Kuyruk</h3>
            <ol>
              {snapshot.queue.map((t) => (
                <li key={t.id} className={`mobile-queue-item ${t.id === snapshot.activeQueueItemId ? "active" : ""}`}>
                  <div className="q-title">{t.title}</div>
                  <div className="q-actions">
                    <button onClick={() => {
                      if (!isHost) return;
                      onCommand({ type: "change_track", videoId: t.videoId, musicUrl: t.musicUrl, title: t.title, positionSeconds: 0, clientCommandId: crypto.randomUUID(), isPlaying: true });
                    }}>Çal</button>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default MobileRoom;
