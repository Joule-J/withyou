import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  deletePlaylist as deleteNamedPlaylist,
  listPlaylists,
  savePlaylist as persistPlaylist,
  type Playlist,
} from "../lib/playlists";
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
  onReplaceQueueTracks: (musicUrls: string[]) => void;
  onAdvanceQueue: () => void;
  onPreviousQueue: () => void;
  onLeave: () => void;
};

export function Room({
  snapshot,
  participantId,
  status,
  error,
  serverNow,
  onCommand,
  onReplaceQueueTracks,
  onAdvanceQueue,
  onPreviousQueue,
  onLeave,
}: Props) {
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [musicUrl, setMusicUrl] = useState("");
  const [queueDraft, setQueueDraft] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
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
  const { previousTrack, nextTrack } = queueNeighbors(queue, activeQueueItemId);

  const refreshPlaylists = useCallback(async () => {
    setPlaylistBusy(true);
    try {
      setPlaylists(await listPlaylists());
      setPlaylistError(null);
    } catch {
      setPlaylistError("Listeler yuklenemedi.");
    } finally {
      setPlaylistBusy(false);
    }
  }, []);

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
    void refreshPlaylists();
  }, [refreshPlaylists, snapshot.roomCode]);

  useEffect(() => {
    applyPlayback("snapshot");
  }, [applyPlayback]);

  useEffect(() => {
    if (!playback) setPlayerReady(false);
  }, [playback]);

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

  async function submitPlaylist(event: FormEvent) {
    event.preventDefault();
    const urls = extractMusicUrls(queueDraft);
    if (!playlistName.trim()) {
      setPlaylistError("Liste ismi gir.");
      return;
    }
    if (urls.length === 0) {
      setPlaylistError("Listeye en az bir YouTube Music baglantisi ekle.");
      return;
    }

    setPlaylistBusy(true);
    try {
      const playlist = await persistPlaylist(playlistName, urls);
      setPlaylists((existing) => [playlist, ...existing.filter((item) => item.id !== playlist.id)]);
      setSelectedPlaylistId(playlist.id);
      setPlaylistError(null);
    } catch {
      setPlaylistError("Liste kaydedilemedi.");
    } finally {
      setPlaylistBusy(false);
    }
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

  function skipQueueTrack() {
    if (!isHost || queue.length === 0) return;
    onAdvanceQueue();
  }

  function previousQueueTrack() {
    if (!isHost || queue.length === 0) return;
    onPreviousQueue();
  }

  function applyPlaylist(playlist: Playlist) {
    setSelectedPlaylistId(playlist.id);
    setPlaylistName(playlist.name);
    setQueueDraft(playlist.tracks.map((track) => track.musicUrl).join("\n"));
    if (isHost) {
      onReplaceQueueTracks(playlist.tracks.map((track) => track.musicUrl));
    }
  }

  async function removePlaylist(playlistId: string) {
    setPlaylistBusy(true);
    try {
      await deleteNamedPlaylist(playlistId);
      setPlaylists((existing) => existing.filter((playlist) => playlist.id !== playlistId));
      if (selectedPlaylistId === playlistId) {
        setSelectedPlaylistId(null);
        setPlaylistName("");
        setQueueDraft("");
      }
      setPlaylistError(null);
    } catch {
      setPlaylistError("Liste silinemedi.");
    } finally {
      setPlaylistBusy(false);
    }
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

          {playback ? (
            <YouTubePlayer
              ref={playerRef}
              onReady={() => setPlayerReady(true)}
              onError={setPlayerError}
              onEnded={handlePlayerEnded}
            />
          ) : (
            <div className="player-frame empty-player">
              <img src="/love.png" alt="" aria-hidden="true" />
              <span>Şarkı bekleniyor</span>
            </div>
          )}

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
              <div className="transport-card compact">
                <div className="transport-controls">
                  <button
                    type="button"
                    className="transport-icon"
                    disabled={queue.length === 0}
                    onClick={previousQueueTrack}
                    aria-label="Önceki şarkı"
                  >
                    {"<<"}
                  </button>
                  <button
                    type="button"
                    className="transport-icon transport-primary"
                    disabled={!playback}
                    onClick={() => command(playback?.isPlaying ? "pause" : "play")}
                    aria-label={playback?.isPlaying ? "Duraklat" : "Oynat"}
                  >
                    {playback?.isPlaying ? "||" : ">"}
                  </button>
                  <button
                    type="button"
                    className="transport-icon"
                    disabled={queue.length === 0}
                    onClick={skipQueueTrack}
                    aria-label="Sonraki şarkı"
                  >
                    {">>"}
                  </button>
                </div>

                <div className="seek-stack">
                  <div className="queue-preview-card prev">
                    <span>Önceki</span>
                    <strong>{previousTrack?.title || previousTrack?.videoId || "Yok"}</strong>
                  </div>

                  <div className="seek-control">
                    <div className="timeline-shell">
                      <div className="timeline-readout">
                        <span>{formatTime(seekValue)}</span>
                        <span>{formatTime(duration)}</span>
                      </div>
                      <div className="timeline-track">
                        <span className="timeline-fill" style={{ width: `${timelinePercent(seekValue, duration)}%` }} />
                        <span className="timeline-cursor" style={{ left: `${timelinePercent(seekValue, duration)}%` }} />
                        <div className="timeline-ticks" aria-hidden="true">
                          {Array.from({ length: 9 }).map((_, index) => <i key={index} />)}
                        </div>
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
                      </div>
                    </div>
                    <button className="seek-commit" disabled={!playback} onClick={() => command("seek", seekValue)}>
                      Bu zamana git
                    </button>
                  </div>

                  <div className="queue-preview-card next">
                    <span>Sonraki</span>
                    <strong>{nextTrack?.title || nextTrack?.videoId || "Yok"}</strong>
                  </div>
                </div>
              </div>

              <div className="track-meta compact">
                <strong>{playback?.title || playback?.videoId || "Host henüz bir şarkı seçmedi"}</strong>
                {playback ? (
                  <div className="track-meta-actions">
                    <a href={playback.musicUrl} target="_blank" rel="noreferrer">YouTube Music</a>
                  </div>
                ) : null}
              </div>

              <form className="track-form compact" onSubmit={submitTrack}>
                <div className="track-form-row">
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
              <h2>Listeler</h2>
              <span>{playlists.length} liste</span>
            </div>

            {isHost ? (
              <form className="queue-form" onSubmit={submitPlaylist}>
                <label htmlFor="playlist-name">Liste adı</label>
                <input
                  id="playlist-name"
                  value={playlistName}
                  placeholder="liste1"
                  onChange={(event) => setPlaylistName(event.target.value)}
                />
                <label htmlFor="queue-links">Liste linkleri</label>
                <textarea
                  id="queue-links"
                  value={queueDraft}
                  rows={4}
                  placeholder={"https://music.youtube.com/watch?v=...\nhttps://music.youtube.com/watch?v=..."}
                  onChange={(event) => setQueueDraft(event.target.value)}
                />
                <div className="queue-form-actions">
                  <button type="submit" disabled={playlistBusy}>Listeyi kaydet</button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={playlistBusy || extractMusicUrls(queueDraft).length === 0}
                    onClick={() => onReplaceQueueTracks(extractMusicUrls(queueDraft))}
                  >
                    Odaya yükle
                  </button>
                </div>
                {playlistError ? <p className="error-message" role="alert">{playlistError}</p> : null}
              </form>
            ) : (
              <p className="queue-note">Host bir liste sectiginde oda sirasina otomatik yuklenir.</p>
            )}

            <div className="saved-tracks-block">
              <div className="saved-tracks-title">
                <h3>Kayitli Listeler</h3>
                <button type="button" className="ghost-button" onClick={() => void refreshPlaylists()}>
                  Yenile
                </button>
              </div>
              <ul className="saved-tracks-list playlist-list">
                {playlists.length > 0 ? (
                  playlists.map((playlist) => (
                    <li className={playlist.id === selectedPlaylistId ? "selected" : ""} key={playlist.id}>
                      <div>
                        <strong>{playlist.name}</strong>
                        <small>{playlist.tracks.length} sarki</small>
                      </div>
                      <div className="saved-track-actions">
                        <button type="button" className="ghost-button" onClick={() => applyPlaylist(playlist)}>
                          Sec
                        </button>
                        <button
                          type="button"
                          className="ghost-button danger"
                          disabled={playlistBusy}
                          onClick={() => void removePlaylist(playlist.id)}
                        >
                          Sil
                        </button>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="saved-empty">{playlistBusy ? "Yukleniyor..." : "Kayitli liste yok."}</li>
                )}
              </ul>
            </div>

            <div className="queue-note room-queue-label">Odadaki sıra</div>
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

function timelinePercent(value: number, duration: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (value / duration) * 100));
}

function extractMusicUrls(value: string): string[] {
  const matches = value.match(/https:\/\/music\.youtube\.com\/watch\?[^\s,]+/g) ?? [];
  return [...new Set(matches.map((entry) => entry.trim()).filter(Boolean))];
}

function queueNeighbors(queue: RoomSnapshot["queue"], activeQueueItemId: string | null) {
  if (queue.length === 0) {
    return { previousTrack: null, nextTrack: null };
  }

  const currentIndex = queue.findIndex((track) => track.id === activeQueueItemId);
  if (currentIndex === -1) {
    return {
      previousTrack: queue.length > 1 ? queue[queue.length - 1] : null,
      nextTrack: queue[0] ?? null,
    };
  }

  return {
    previousTrack: queue[(currentIndex - 1 + queue.length) % queue.length] ?? null,
    nextTrack: queue[(currentIndex + 1) % queue.length] ?? null,
  };
}
