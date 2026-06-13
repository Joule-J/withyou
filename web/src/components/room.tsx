import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { parseMusicUrl } from "../lib/music-url";
import {
  POST_ACTION_SETTLE_MS,
  canCorrectDrift,
  driftAmount,
  isHardSyncRequired,
  shouldCorrectDrift,
  targetPosition,
} from "../lib/sync";
import type { PlayerCommand, RoomSnapshot } from "../types";
import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player";

type Props = {
  snapshot: RoomSnapshot;
  participantId: string;
  status: "connecting" | "connected" | "disconnected";
  error: string | null;
  serverNow: () => number;
  onCommand: (command: PlayerCommand) => void;
  onAddQueueTracks: (musicUrls: string[]) => void;
  onAdvanceQueue: () => void;
  onLeave: () => void;
};

export function Room({
  snapshot,
  participantId,
  status,
  error,
  serverNow,
  onCommand,
  onAddQueueTracks,
  onAdvanceQueue,
  onLeave,
}: Props) {
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [musicUrl, setMusicUrl] = useState("");
  const [queueDraft, setQueueDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekValue, setSeekValue] = useState(0);
  const lastCorrectionAtRef = useRef(0);
  const advancedRevisionRef = useRef(0);
  const settleUntilRef = useRef(0);
  const appliedRevisionRef = useRef(0);
  const isHost = snapshot.hostParticipantId === participantId;
  const playback = snapshot.playback;
  const participants = snapshot.participants ?? [];
  const queue = snapshot.queue ?? [];
  const activeQueueItemId = snapshot.activeQueueItemId ?? null;

  const applyPlayback = useCallback(
    (mode: "snapshot" | "drift" = "snapshot") => {
      const player = playerRef.current;
      if (!playerReady || !player || !playback) return;

      const now = Date.now();
      if (mode === "drift" && now < settleUntilRef.current) return;
      if (mode === "snapshot" && playback.revision < appliedRevisionRef.current) return;

      const target = targetPosition(playback, serverNow());
      const playerState = player.state();
      const currentVideoId = player.videoId();
      const currentPosition = player.currentTime();

      if (currentVideoId !== playback.videoId) {
        player.load(playback.videoId, target, playback.isPlaying);
        settleUntilRef.current = now + POST_ACTION_SETTLE_MS;
        appliedRevisionRef.current = playback.revision;
      } else {
        if (canCorrectDrift(playerState) && shouldCorrectDrift(currentPosition, target)) {
          if (mode === "snapshot" || isHardSyncRequired(currentPosition, target)) {
            player.seek(target);
            lastCorrectionAtRef.current = now;
            settleUntilRef.current = now + POST_ACTION_SETTLE_MS;
          }
        }

        if (playback.isPlaying && playerState !== 1 && now >= settleUntilRef.current) {
          player.play();
        }

        if (!playback.isPlaying && playerState !== 2) {
          if (driftAmount(currentPosition, target) > 0.15) {
            player.seek(target);
          }
          player.pause();
        }

        appliedRevisionRef.current = Math.max(appliedRevisionRef.current, playback.revision);
      }

      if (playback.isPlaying) {
        window.setTimeout(() => setNeedsUnlock(playerRef.current?.state() !== 1), 1_200);
      } else {
        setNeedsUnlock(false);
      }
    },
    [playback, playerReady, serverNow],
  );

  useEffect(() => {
    applyPlayback("snapshot");
  }, [applyPlayback]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const current = player.currentTime();
      setPosition(current);
      setSeekValue((existing) => (document.activeElement?.id === "seek-range" ? existing : current));
      setDuration(player.duration());

      if (playback && playerReady && Date.now() - lastCorrectionAtRef.current >= 5_000) {
        const target = targetPosition(playback, serverNow());
        if (canCorrectDrift(player.state()) && shouldCorrectDrift(current, target)) {
          applyPlayback("drift");
        }
      }
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [applyPlayback, playback, playerReady, serverNow]);

  function command(type: PlayerCommand["type"], nextPosition = position) {
    if (!playback) return;
    onCommand({
      type,
      videoId: playback.videoId,
      musicUrl: playback.musicUrl,
      title: playback.title,
      positionSeconds: Math.max(0, nextPosition),
      clientCommandId: crypto.randomUUID(),
    });
  }

  function submitTrack(event: FormEvent) {
    event.preventDefault();
    const parsed = parseMusicUrl(musicUrl);
    if (!parsed) {
      setLinkError("Geçerli bir music.youtube.com/watch bağlantısı gir.");
      return;
    }

    setLinkError(null);
    onCommand({
      type: "change_track",
      videoId: parsed.videoId,
      musicUrl: parsed.normalizedUrl,
      positionSeconds: 0,
      clientCommandId: crypto.randomUUID(),
      isPlaying: true,
    });
    setMusicUrl("");
  }

  function submitQueue(event: FormEvent) {
    event.preventDefault();
    const urls = queueDraft
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setQueueError("En az bir YouTube Music bağlantısı yapıştır.");
      return;
    }
    if (urls.some((url) => !parseMusicUrl(url))) {
      setQueueError("Listede geçersiz YouTube Music bağlantısı var.");
      return;
    }

    setQueueError(null);
    onAddQueueTracks(urls);
    setQueueDraft("");
  }

  function copyInvite() {
    void navigator.clipboard.writeText(`${window.location.origin}/room/${snapshot.roomCode}`);
  }

  function handlePlayerEnded() {
    if (!isHost || !playback || queue.length === 0) return;
    if (advancedRevisionRef.current === playback.revision) return;
    advancedRevisionRef.current = playback.revision;
    onAdvanceQueue();
  }

  return (
    <main className="room-shell">
      <header className="room-header">
        <div className="brand-lockup">
          <p className="eyebrow">WITHYOU</p>
          <div className="brand-row">
            <img className="brand-logo" src="/love.png" alt="" aria-hidden="true" />
            <h1>WithYou</h1>
            <button className="room-code" onClick={copyInvite} title="Oda davet bağlantısını kopyala">
              {snapshot.roomCode}
            </button>
          </div>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${status}`}>{status === "connected" ? "Bağlı" : "Bağlantı kesildi"}</span>
          <button className="text-button" onClick={onLeave}>Odadan çık</button>
        </div>
      </header>

      <div className="room-grid">
        <section className="player-panel">
          <div className="panel-title wide">
            <div>
              <h2>Birlikte Dinle</h2>
              <p className="panel-copy">Host parçayı belirler, oda aynı anda dinler.</p>
            </div>
            {playback ? <span>{formatTime(position)} / {formatTime(duration)}</span> : null}
          </div>

          <YouTubePlayer
            ref={playerRef}
            onReady={() => setPlayerReady(true)}
            onError={setPlayerError}
            onEnded={handlePlayerEnded}
          />

          <div className="track-meta">
            <div>
              <span>Şimdi çalıyor</span>
              <strong>{playback?.title || playback?.videoId || "Host henüz bir şarkı seçmedi"}</strong>
            </div>
            {playback ? (
              <a href={playback.musicUrl} target="_blank" rel="noreferrer">YouTube Music</a>
            ) : null}
          </div>

          {needsUnlock ? (
            <button
              className="unlock-button"
              onClick={() => {
                const player = playerRef.current;
                if (player && playback) {
                  player.seek(targetPosition(playback, serverNow()));
                  player.play();
                  settleUntilRef.current = Date.now() + POST_ACTION_SETTLE_MS;
                }
                setNeedsUnlock(false);
              }}
            >
              Senkronizasyonu başlat
            </button>
          ) : null}

          {isHost ? (
            <div className="host-controls">
              <form className="track-form" onSubmit={submitTrack}>
                <label htmlFor="music-url">YouTube Music bağlantısı</label>
                <div>
                  <input
                    id="music-url"
                    type="url"
                    value={musicUrl}
                    placeholder="https://music.youtube.com/watch?v=..."
                    onChange={(event) => setMusicUrl(event.target.value)}
                  />
                  <button type="submit">Şarkıyı aç</button>
                </div>
                {linkError ? <p className="error-message" role="alert">{linkError}</p> : null}
              </form>

              <div className="transport-controls">
                <button disabled={!playback} onClick={() => command("play")}>Oynat</button>
                <button disabled={!playback} onClick={() => command("pause")}>Duraklat</button>
              </div>

              <div className="seek-control">
                <input
                  id="seek-range"
                  aria-label="Oynatma zamanı"
                  type="range"
                  min="0"
                  max={Math.max(duration, 1)}
                  step="1"
                  value={Math.min(seekValue, Math.max(duration, 1))}
                  disabled={!playback}
                  onChange={(event) => setSeekValue(Number(event.target.value))}
                />
                <button disabled={!playback} onClick={() => command("seek", seekValue)}>
                  Bu zamana git
                </button>
              </div>
            </div>
          ) : (
            <p className="guest-note">Müziği host kontrol ediyor. Senkronizasyon görünür fark oluştuğunda kendini toplar.</p>
          )}

          {error || playerError ? <p className="error-message" role="alert">{error || playerError}</p> : null}
        </section>

        <aside className="sidebar-stack">
          <section className="participants-panel">
            <div className="panel-title">
              <h2>Odadakiler</h2>
              <span>{participants.length}/10</span>
            </div>
            <ul>
              {participants.map((participant) => (
                <li key={participant.id}>
                  <span className={`presence-dot ${participant.isConnected ? "online" : ""}`} />
                  <span>{participant.nickname}{participant.id === participantId ? " (sen)" : ""}</span>
                  {participant.isHost ? <strong>Host</strong> : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="queue-panel">
            <div className="panel-title">
              <h2>Şarkı Sırası</h2>
              <span>{queue.length} parça</span>
            </div>

            {isHost ? (
              <form className="queue-form" onSubmit={submitQueue}>
                <label htmlFor="queue-links">YouTube Music linkleri</label>
                <textarea
                  id="queue-links"
                  value={queueDraft}
                  rows={4}
                  placeholder={"https://music.youtube.com/watch?v=...\nhttps://music.youtube.com/watch?v=..."}
                  onChange={(event) => setQueueDraft(event.target.value)}
                />
                <button type="submit">Sıraya ekle</button>
                {queueError ? <p className="error-message" role="alert">{queueError}</p> : null}
              </form>
            ) : (
              <p className="queue-note">Sırayı host düzenler; şarkılar bitince liste başa döner.</p>
            )}

            <ol className="queue-list">
              {queue.length > 0 ? (
                queue.map((track, index) => (
                  <li className={track.id === activeQueueItemId ? "active" : ""} key={track.id}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{track.title || track.videoId}</strong>
                      <small>{track.addedByName}</small>
                    </div>
                  </li>
                ))
              ) : (
                <li className="queue-empty">Sıraya link eklenmedi.</li>
              )}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
