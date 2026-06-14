import { useCallback, useEffect, useRef, useState } from "react";
import { listPlaylists, type Playlist } from "../lib/playlists";
import type { PlayerCommand, RoomSnapshot } from "../types";
import type { YouTubePlayerHandle } from "./youtube-player";
import { YouTubePlayer } from "./youtube-player";
import { POST_ACTION_SETTLE_MS, canCorrectDrift, shouldCorrectDrift, targetPosition } from "../lib/sync";

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
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [savedPlaylists, setSavedPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [showPlaylistOverlay, setShowPlaylistOverlay] = useState(false);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const playback = snapshot.playback;
  const isHost = snapshot.hostParticipantId === participantId;
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const settleUntilRef = useRef(0);
  const mediaSessionActionsRef = useRef<{
    play: () => void;
    pause: () => void;
    nexttrack: () => void;
    previoustrack: () => void;
  } | null>(null);

  useEffect(() => {
    if (!showPlaylists) return;
    let cancelled = false;
    setPlaylistsLoading(true);
    void listPlaylists()
      .then((items) => {
        if (cancelled) return;
        setSavedPlaylists(items);
        setPlaylistsError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setPlaylistsError("Listeler yuklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setPlaylistsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showPlaylists]);

  useEffect(() => {
    if (!showPlaylistOverlay) return;
    let cancelled = false;
    setPlaylistsLoading(true);
    void listPlaylists()
      .then((items) => {
        if (cancelled) return;
        setSavedPlaylists(items);
        setPlaylistsError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setPlaylistsError("Listeler yuklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setPlaylistsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showPlaylistOverlay]);

  useEffect(() => {
    const player = playerRef.current;
    if (!playerReady || !player || !playback) return;

    const now = Date.now();
    if (now < settleUntilRef.current) return;

    const target = targetPosition(playback, serverNow());
    const playerState = player.state();
    const currentVideoId = player.videoId();
    const currentPosition = player.currentTime();

    if (currentVideoId !== playback.videoId) {
      player.load(playback.videoId, target, playback.isPlaying);
      settleUntilRef.current = now + POST_ACTION_SETTLE_MS;
      return;
    }

    if (canCorrectDrift(playerState) && shouldCorrectDrift(currentPosition, target)) {
      player.seek(target);
      settleUntilRef.current = now + POST_ACTION_SETTLE_MS;
    }

    if (playback.isPlaying && playerState !== 1) {
      player.play();
    }

    if (!playback.isPlaying && playerState !== 2) {
      player.pause();
    }
  }, [playback, playerReady, serverNow]);

  const playPause = useCallback(() => {
    if (!playback || !isHost) return;
    setSoundUnlocked(true);
    playerRef.current?.unmute();
    if (!playback.isPlaying) {
      playerRef.current?.play();
    }
    onCommand({
      type: playback.isPlaying ? "pause" : "play",
      videoId: playback.videoId,
      musicUrl: playback.musicUrl,
      title: playback.title,
      positionSeconds: playback.positionSeconds ?? 0,
      clientCommandId: crypto.randomUUID(),
    });
  }, [playback, onCommand, isHost]);

  const skipNext = useCallback(() => {
    if (!isHost) return;
    setSoundUnlocked(true);
    playerRef.current?.unmute();
    onAdvanceQueue();
  }, [isHost, onAdvanceQueue]);

  const skipPrev = useCallback(() => {
    if (!isHost) return;
    setSoundUnlocked(true);
    playerRef.current?.unmute();
    onPreviousQueue();
  }, [isHost, onPreviousQueue]);

  const unlockSound = useCallback(() => {
    if (!isHost) return;
    setSoundUnlocked(true);
    playerRef.current?.unmute();
  }, [isHost]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !playback) return;

    const mediaSession = navigator.mediaSession;
    const updatePositionState = () => {
      if (typeof mediaSession.setPositionState !== "function") return;
      const duration = playerRef.current?.duration() ?? 0;
      const position = playerRef.current?.currentTime() ?? playback.positionSeconds ?? 0;
      const playbackRate = playback.isPlaying ? 1 : 0;
      try {
        mediaSession.setPositionState({
          duration: Number.isFinite(duration) ? Math.max(duration, 0) : 0,
          position: Math.max(0, position),
          playbackRate,
        });
      } catch {
        // Ignore browsers that reject incomplete position data.
      }
    };

    mediaSession.metadata = new MediaMetadata({
      title: playback.title ?? "WithYou",
      artist: "WithYou",
      album: snapshot.roomCode,
      artwork: playback.thumbnailUrl
        ? [{ src: playback.thumbnailUrl, sizes: "512x512", type: "image/jpeg" }]
        : undefined,
    });

    mediaSession.playbackState = playback.isPlaying ? "playing" : "paused";
    updatePositionState();

    mediaSessionActionsRef.current = {
      play: () => {
        if (!isHost) return;
        unlockSound();
        playerRef.current?.play();
        mediaSession.playbackState = "playing";
        updatePositionState();
        onCommand({
          type: "play",
          videoId: playback.videoId,
          musicUrl: playback.musicUrl,
          title: playback.title,
          positionSeconds: playback.positionSeconds ?? 0,
          clientCommandId: crypto.randomUUID(),
        });
      },
      pause: () => {
        if (!isHost) return;
        playerRef.current?.pause();
        mediaSession.playbackState = "paused";
        updatePositionState();
        onCommand({
          type: "pause",
          videoId: playback.videoId,
          musicUrl: playback.musicUrl,
          title: playback.title,
          positionSeconds: playback.positionSeconds ?? 0,
          clientCommandId: crypto.randomUUID(),
        });
      },
      nexttrack: () => {
        if (!isHost) return;
        unlockSound();
        onAdvanceQueue();
      },
      previoustrack: () => {
        if (!isHost) return;
        unlockSound();
        onPreviousQueue();
      },
    };

    const handlers = mediaSessionActionsRef.current;
    mediaSession.setActionHandler("play", handlers.play);
    mediaSession.setActionHandler("pause", handlers.pause);
    mediaSession.setActionHandler("nexttrack", handlers.nexttrack);
    mediaSession.setActionHandler("previoustrack", handlers.previoustrack);

    return () => {
      mediaSession.setActionHandler("play", null);
      mediaSession.setActionHandler("pause", null);
      mediaSession.setActionHandler("nexttrack", null);
      mediaSession.setActionHandler("previoustrack", null);
    };
  }, [isHost, onAdvanceQueue, onCommand, onPreviousQueue, playback, snapshot.roomCode, unlockSound]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !playback) return;
    const mediaSession = navigator.mediaSession;
    mediaSession.playbackState = playback.isPlaying ? "playing" : "paused";
    if (typeof mediaSession.setPositionState === "function") {
      try {
        mediaSession.setPositionState({
          duration: playerRef.current?.duration() ?? 0,
          position: playerRef.current?.currentTime() ?? playback.positionSeconds ?? 0,
          playbackRate: playback.isPlaying ? 1 : 0,
        });
      } catch {
        // Ignore unsupported browsers.
      }
    }
  }, [playback?.isPlaying, playback?.positionSeconds, playback?.updatedAtServerMs]);

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
            <YouTubePlayer
              ref={playerRef}
              onReady={() => setPlayerReady(true)}
              onError={(message) => setPlayerError(message)}
              onEnded={() => { if (isHost) onAdvanceQueue(); }}
            />
          ) : (
            <div className="mobile-empty">Şarkı bekleniyor</div>
          )}
          <div className="mobile-now">
            <div className="mobile-now-title">{playback?.title ?? "Henüz çalmıyor"}</div>
            <div className="mobile-now-controls">
              <button onClick={skipPrev} aria-label="Önceki" disabled={!isHost}>◀◀</button>
              <button onClick={playPause} aria-label="Oynat/Duraklat" disabled={!isHost}>{playback?.isPlaying ? "⏸" : "▶"}</button>
              <button onClick={skipNext} aria-label="Sonraki" disabled={!isHost}>▶▶</button>
            </div>
            {isHost && !soundUnlocked ? (
              <button type="button" className="mobile-sound-unlock" onClick={unlockSound}>
                Sesi aç
              </button>
            ) : null}
            {!isHost ? <div className="mobile-readonly">Client modunda kontrol kapalı.</div> : null}
          </div>
        </div>

        <div className="mobile-actions">
          <button onClick={() => setShowPlaylists((s) => !s)} className="mobile-action">📚 Listeler</button>
          <button onClick={() => setShowPlaylistOverlay(true)} className="mobile-action">🌐 Tüm listeler</button>
          <button onClick={() => setShowQueue((s) => !s)} className="mobile-action">📜 Sıra</button>
        </div>

        {showPlaylists ? (
          <section className="mobile-panel mobile-playlists">
            <h3>Listeler</h3>
            {playlistsError ? <p className="mobile-error">{playlistsError}</p> : null}
            {playlistsLoading ? <p className="muted">Listeler yükleniyor...</p> : null}
            <ul>
              {savedPlaylists.map((playlist) => (
                <li key={playlist.id} className="mobile-list-item">
                  <button
                    disabled={!isHost}
                    onClick={() => {
                      if (!isHost) return;
                      onReplaceQueueTracks(playlist.tracks.map((track) => track.musicUrl));
                    }}
                  >
                    {playlist.name} · {playlist.tracks.length} şarkı
                  </button>
                </li>
              ))}
              {!playlistsLoading && savedPlaylists.length === 0 ? (
                <li className="mobile-empty-list">Kayıtlı liste yok.</li>
              ) : null}
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
                    <button disabled={!isHost} onClick={() => {
                      if (!isHost) return;
                      onCommand({ type: "change_track", videoId: t.videoId, musicUrl: t.musicUrl, title: t.title, positionSeconds: 0, clientCommandId: crypto.randomUUID(), isPlaying: true });
                    }}>Çal</button>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {playerError ? <p className="mobile-error" role="alert">{playerError}</p> : null}
      </main>

      {showPlaylistOverlay ? (
        <div className="playlist-overlay" role="dialog" aria-modal="true" aria-label="Tüm listeler">
          <div className="playlist-overlay-backdrop" onClick={() => setShowPlaylistOverlay(false)} />
          <section className="playlist-overlay-panel">
            <div className="playlist-overlay-header">
              <div>
                <h2>Tüm listeler</h2>
                <p className="panel-copy">DB’de kayıtlı tüm listeler burada görünür.</p>
              </div>
              <button type="button" className="icon-menu-button" onClick={() => setShowPlaylistOverlay(false)} aria-label="Kapat">
                ×
              </button>
            </div>
            <div className="playlist-overlay-toolbar">
              <button type="button" className="refresh-button" onClick={() => void listPlaylists().then(setSavedPlaylists)}>
                Yenile
              </button>
              <span className="panel-count-pill">{savedPlaylists.length} liste</span>
            </div>
            <div className="playlist-overlay-list-shell">
              {savedPlaylists.length > 0 ? (
                <ul className="playlist-overlay-list">
                  {savedPlaylists.map((playlist, index) => (
                    <li key={playlist.id} className={playlist.id === snapshot.activeQueueItemId ? "selected" : ""}>
                      <div className={`playlist-cover cover-${index % 4}`}>
                        <span>{playlist.name.slice(0, 1).toUpperCase()}</span>
                      </div>
                      <div className="playlist-item-copy">
                        <div className="playlist-item-topline">
                          <strong>{playlist.name}</strong>
                        </div>
                        <small>{playlist.tracks.length} şarkı</small>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="saved-empty">Kayıtlı liste yok.</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default MobileRoom;
