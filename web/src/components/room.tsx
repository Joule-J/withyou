import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  deletePlaylist as deleteNamedPlaylist,
  listPlaylists,
  reorderPlaylist as persistPlaylistOrder,
  savePlaylist as persistPlaylist,
  updatePlaylist as persistPlaylistUpdate,
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

const VINYL_ARTS = [
  "/vinyls/13.png",
  "/vinyls/12.png",
  "/vinyls/11.png",
  "/vinyls/1.png",
  "/vinyls/2.png",
  "/vinyls/3.png",
  "/vinyls/4.png",
  "/vinyls/5.png",
  "/vinyls/6.png",
  "/vinyls/7.png",
  "/vinyls/8.png",
  "/vinyls/9.png",
];

const PLAYLIST_VINYL_STORAGE_KEY = "withyou.playlistVinylChoices";

type PlaylistFormMode = "create" | "edit";

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
  onTransferHost: (targetParticipantId: string) => void;
  onAdvanceQueue: () => void;
  onPreviousQueue: () => void;
  onPlaylistVinylSwap?: (vinylSrc?: string) => void;
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
  onReplaceQueueTracks,
  onReorderQueue,
  onTransferHost,
  onAdvanceQueue,
  onPreviousQueue,
  onPlaylistVinylSwap,
  onLeave,
}: Props) {
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [queueLinkDraft, setQueueLinkDraft] = useState("");
  const [queueLinkError, setQueueLinkError] = useState<string | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playlistVinylChoices, setPlaylistVinylChoices] = useState<Record<string, string>>(() => loadPlaylistVinylChoices());
  const [showAddPlaylistOverlay, setShowAddPlaylistOverlay] = useState(false);
  const [playlistFormMode, setPlaylistFormMode] = useState<PlaylistFormMode>("create");
  const [playlistFormId, setPlaylistFormId] = useState<string | null>(null);
  const [playlistFormName, setPlaylistFormName] = useState("");
  const [playlistFormLinks, setPlaylistFormLinks] = useState("");
  const [playlistFormVinyl, setPlaylistFormVinyl] = useState(VINYL_ARTS[0]);
  const [pendingDeletePlaylist, setPendingDeletePlaylist] = useState<Playlist | null>(null);
  const [draggedQueueTrackId, setDraggedQueueTrackId] = useState<string | null>(null);
  const [playlistEditMode, setPlaylistEditMode] = useState(false);
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
  const currentTrackLabel = playback?.title || playback?.videoId || "Host henüz bir şarkı seçmedi";
  const queueListRef = useRef<HTMLUListElement | null>(null);

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

  // When the queue length changes, scroll the queue list to show newest items
  useEffect(() => {
    if (!queueListRef.current) return;
    try {
      queueListRef.current.scrollTo({ top: queueListRef.current.scrollHeight, behavior: "smooth" });
    } catch {
      queueListRef.current.scrollTop = queueListRef.current.scrollHeight;
    }
  }, [queue.length]);

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

  function applyHostAction(type: PlayerCommand["type"], nextPosition = position) {
    const player = playerRef.current;
    if (!isHost || !playback || !player) return;

    const target = Math.max(0, nextPosition);
    if (type === "pause") {
      player.pause();
    } else if (type === "play") {
      player.seek(target);
      player.play();
    } else if (type === "seek") {
      player.seek(target);
    }
  }

  function commitSeek(nextPosition: number) {
    if (!playback) return;
    applyHostAction("seek", nextPosition);
    command("seek", nextPosition);
  }

  function submitQueueLink(event: FormEvent) {
    event.preventDefault();
    const parsed = parseMusicUrl(queueLinkDraft);
    if (!parsed) {
      setQueueLinkError("Geçerli bir YouTube veya YouTube Music şarkı linki gir.");
      return;
    }

    setQueueLinkError(null);
    onAddQueueTracks([parsed.normalizedUrl], snapshot.activeQueueItemId ?? undefined);
    setQueueLinkDraft("");
  }

  async function submitPlaylist(event: FormEvent) {
    event.preventDefault();
    const name = playlistFormName.trim();
    const urls = extractMusicUrls(playlistFormLinks);
    if (!name) {
      setPlaylistError("Liste ismi gir.");
      return;
    }
    if (hasDuplicatePlaylistName(playlists, name, playlistFormMode === "edit" ? playlistFormId : null)) {
      setPlaylistError("Bu isimde bir liste zaten var.");
      return;
    }
    if (playlistFormMode === "create" && urls.length === 0) {
      setPlaylistError("Listeye en az bir YouTube Music baglantisi ekle.");
      return;
    }

    setPlaylistBusy(true);
    try {
      const playlist =
        playlistFormMode === "edit" && playlistFormId
          ? await persistPlaylistUpdate(playlistFormId, name)
          : await persistPlaylist(name, urls);

      const nextVinylSrc = playlistFormVinyl;
      setPlaylistVinylChoices((existing) => savePlaylistVinylChoice(existing, playlist.id, nextVinylSrc));
      setPlaylists((existing) =>
        playlistFormMode === "edit"
          ? existing.map((item) => (item.id === playlist.id ? playlist : item))
          : [playlist, ...existing.filter((item) => item.id !== playlist.id)],
      );
      setSelectedPlaylistId(playlist.id);
      onPlaylistVinylSwap?.(nextVinylSrc);
      setPlaylistError(null);
      setShowAddPlaylistOverlay(false);
      void refreshPlaylists();
    } catch {
      setPlaylistError(playlistFormMode === "edit" ? "Liste guncellenemedi." : "Liste kaydedilemedi.");
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

  function startSynchronization() {
    const player = playerRef.current;
    if (player && playback) {
      player.unmute();
      player.seek(targetPosition(playback, serverNow()));
      player.play();
      settleUntilRef.current = Date.now() + POST_ACTION_SETTLE_MS;
    }
    setNeedsUnlock(false);
  }

  function applyPlaylist(playlist: Playlist) {
    const vinylSrc = playlistVinylSrc(playlist, playlistVinylChoices);
    if (playlist.id !== selectedPlaylistId) {
      onPlaylistVinylSwap?.(vinylSrc);
    }
    setSelectedPlaylistId(playlist.id);
    if (isHost) {
      onReplaceQueueTracks(playlist.tracks.map((track) => track.musicUrl));
    }
  }

  function openCreatePlaylistOverlay() {
    setPlaylistFormMode("create");
    setPlaylistFormId(null);
    setPlaylistFormName("");
    setPlaylistFormLinks("");
    setPlaylistFormVinyl(VINYL_ARTS[0]);
    setPlaylistError(null);
    setShowAddPlaylistOverlay(true);
  }

  function openEditPlaylistOverlay(playlist: Playlist) {
    setPlaylistFormMode("edit");
    setPlaylistFormId(playlist.id);
    setPlaylistFormName(playlist.name);
    setPlaylistFormLinks("");
    setPlaylistFormVinyl(playlistVinylSrc(playlist, playlistVinylChoices));
    setPlaylistError(null);
    setShowAddPlaylistOverlay(true);
  }

  async function removePlaylist(playlistId: string) {
    setPlaylistBusy(true);
    try {
      await deleteNamedPlaylist(playlistId);
      setPlaylistVinylChoices((existing) => {
        const next = { ...existing };
        delete next[playlistId];
        savePlaylistVinylChoices(next);
        return next;
      });
      setPlaylists((existing) => existing.filter((p) => p.id !== playlistId));
      if (selectedPlaylistId === playlistId) {
        setSelectedPlaylistId(null);
      }
      setPlaylistError(null);
      setPendingDeletePlaylist(null);
      void refreshPlaylists();
    } catch {
      setPlaylistError("Liste silinemedi.");
    } finally {
      setPlaylistBusy(false);
    }
  }

  async function reorderQueueTracks(targetTrackId: string) {
    if (!isHost || !draggedQueueTrackId || draggedQueueTrackId === targetTrackId) return;

    const fromIndex = queue.findIndex((track) => track.id === draggedQueueTrackId);
    const toIndex = queue.findIndex((track) => track.id === targetTrackId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextQueue = [...queue];
    const [movedTrack] = nextQueue.splice(fromIndex, 1);
    nextQueue.splice(toIndex, 0, movedTrack);
    onReorderQueue(nextQueue.map((track) => track.id));

    if (selectedPlaylistId && nextQueue.length > 0) {
      try {
        const playlist = await persistPlaylistOrder(selectedPlaylistId, nextQueue.map((track) => track.musicUrl));
        setPlaylists((existing) => existing.map((entry) => (entry.id === playlist.id ? playlist : entry)));
        void refreshPlaylists();
      } catch {
        setPlaylistError("Liste sirasi kaydedilemedi.");
      }
    }
  }

  function playQueueTrack(track: RoomSnapshot["queue"][number]) {
    if (!isHost) return;
    onCommand({
      type: "change_track",
      videoId: track.videoId,
      musicUrl: track.musicUrl,
      title: track.title,
      positionSeconds: 0,
      clientCommandId: crypto.randomUUID(),
      isPlaying: true,
    });
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
          {status !== "connected" ? (
            <span className={`status-pill ${status}`}>{status === "connecting" ? "Bağlanıyor" : "Bağlantı kesildi"}</span>
          ) : null}
          {isHost ? (
            <button
              type="button"
              className={`playlist-edit-toggle${playlistEditMode ? " is-active" : ""}`}
              onClick={() => setPlaylistEditMode((active) => !active)}
              aria-pressed={playlistEditMode}
              title={playlistEditMode ? "Liste düzenlemeyi kapat" : "Listeleri düzenle"}
              aria-label={playlistEditMode ? "Liste düzenlemeyi kapat" : "Listeleri düzenle"}
            >
              <EditGlyph />
            </button>
          ) : null}
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

          <div className="host-controls">
            <div className="transport-card compact player-transport-panel">
              <div className="player-transport-header">
                {/* artwork and large current-track label removed per request */}
              </div>

              <div className="track-neighbors-inline">
                <button
                  type="button"
                  className="neighbor-track-button"
                  disabled={!isHost || queue.length === 0}
                  onClick={previousQueueTrack}
                  aria-label={`Önceki şarkı: ${previousTrack?.title || previousTrack?.videoId || "Yok"}`}
                >
                  <Artwork
                    className="mini-neighbor-cover"
                    src={previousTrack?.thumbnailUrl}
                    fallback={previousTrack?.title || previousTrack?.videoId || "Y"}
                  />
                  <div className="neighbor-copy">
                    <strong>{previousTrack?.title || previousTrack?.videoId || "Yok"}</strong>
                  </div>
                </button>
                <div className="current-track-inline">
                  <Artwork
                    className="mini-neighbor-cover playing"
                    src={playback?.thumbnailUrl}
                    fallback={currentTrackLabel}
                  />
                  <div className="neighbor-copy">
                    <strong>{currentTrackLabel}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="neighbor-track-button"
                  disabled={!isHost || queue.length === 0}
                  onClick={skipQueueTrack}
                  aria-label={`Sonraki şarkı: ${nextTrack?.title || nextTrack?.videoId || "Yok"}`}
                >
                  <Artwork
                    className="mini-neighbor-cover"
                    src={nextTrack?.thumbnailUrl}
                    fallback={nextTrack?.title || nextTrack?.videoId || "Y"}
                  />
                  <div className="neighbor-copy">
                    <strong>{nextTrack?.title || nextTrack?.videoId || "Yok"}</strong>
                  </div>
                </button>
              </div>

              <div className="player-transport-row">
                <div className="transport-controls icon-row">
                  <button
                    type="button"
                    className="transport-icon"
                    disabled={!isHost || queue.length === 0}
                    onClick={previousQueueTrack}
                    aria-label="Önceki şarkı"
                  >
                    <TransportGlyph kind="previous" />
                  </button>
                  <button
                    type="button"
                    className="transport-icon transport-primary"
                    disabled={!isHost || !playback}
                    onClick={() => {
                      if (!playback) return;
                      applyHostAction(playback.isPlaying ? "pause" : "play");
                      command(playback.isPlaying ? "pause" : "play");
                    }}
                    aria-label={playback?.isPlaying ? "Duraklat" : "Oynat"}
                  >
                    <TransportGlyph kind={playback?.isPlaying ? "pause" : "play"} />
                  </button>
                  <button
                    type="button"
                    className="transport-icon"
                    disabled={!isHost || queue.length === 0}
                    onClick={skipQueueTrack}
                    aria-label="Sonraki şarkı"
                  >
                    <TransportGlyph kind="next" />
                  </button>
                </div>

                <div className="seek-control player-seek-card">
                  <div className="timeline-shell">
                    <div className="timeline-track">
                      <span className="timeline-fill" style={{ width: `${timelinePercent(seekValue, duration)}%` }} />
                      <span className="timeline-cursor" style={{ left: `${timelinePercent(seekValue, duration)}%` }} />
                      <input
                        id="seek-range"
                        aria-label="Oynatma zamanı"
                        type="range"
                        min="0"
                        max={Math.max(duration, 1)}
                        step="1"
                        value={Math.min(seekValue, Math.max(duration, 1))}
                        disabled={!isHost || !playback}
                        onChange={(event) => setSeekValue(Number(event.target.value))}
                        onMouseUp={(event) => commitSeek(Number((event.target as HTMLInputElement).value))}
                        onTouchEnd={(event) => commitSeek(Number((event.target as HTMLInputElement).value))}
                        onKeyUp={(event) => {
                          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                            commitSeek(Number((event.target as HTMLInputElement).value));
                          }
                        }}
                      />
                    </div>
                    <div className="timeline-readout">
                      <span>{formatTime(seekValue)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {!isHost ? (
                <p className="guest-note">Müziği host kontrol ediyor. Senkronizasyon görünür fark oluştuğunda kendini toplar.</p>
              ) : null}
            </div>
          </div>

          {error || playerError ? <p className="error-message" role="alert">{error || playerError}</p> : null}
        </section>

        {needsUnlock ? (
          <button className="unlock-button" onClick={startSynchronization}>
            Senkronizasyonu başlat
          </button>
        ) : null}

        <aside className="sidebar-stack">
          <section className="participants-panel sidebar-card compact-panel">
            <div className="sidebar-section-title">
              <div className="sidebar-title-copy">
                <h2>Odadakiler</h2>
              </div>
            </div>
            <ul className="participant-list">
              {participants.map((participant) => (
                <li className="participant-card" key={participant.id}>
                  <div className="participant-copy">
                    <span>{participant.nickname}{participant.id === participantId ? " (sen)" : ""}</span>
                    <div className="participant-meta">
                      {participant.isHost ? <span className="host-badge">Host</span> : null}
                      {!participant.isConnected ? <span className="connection-badge">Koptu</span> : null}
                    </div>
                  </div>
                  {isHost && participant.id !== participantId && participant.isConnected ? (
                    <button
                      type="button"
                      className="transfer-host-button"
                      onClick={() => onTransferHost(participant.id)}
                    >
                      Host yap
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="queue-panel sidebar-card">
            <div className="sidebar-section-title queue-section-head">
              <div className="sidebar-title-copy">
                <SidebarGlyph kind="note" />
                <h2>Oda sırası</h2>
              </div>
              <button
                type="button"
                className="refresh-button"
                disabled={!isHost || queue.length === 0}
                onClick={() => onReplaceQueueTracks(queue.map((track) => track.musicUrl))}
              >
                <RefreshGlyph />
                Yenile
              </button>
            </div>
            <ol className="queue-list rich-queue-list" ref={queueListRef as any}>
              {queue.length > 0 ? (
                queue.map((track, index) => (
                  <li
                    className={track.id === activeQueueItemId ? "active" : ""}
                    key={track.id}
                    onClick={() => playQueueTrack(track)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void reorderQueueTracks(track.id)}
                  >
                    <span className="queue-rank">{index + 1}</span>
                    <Artwork
                      className={`queue-cover cover-${index % 4}`}
                      src={track.thumbnailUrl}
                      fallback={track.title || track.videoId}
                    />
                    <div className="queue-item-copy">
                      <strong>{track.title || track.videoId}</strong>
                      <small>{track.addedByName}</small>
                    </div>
                    <div className="queue-row-actions">
                      <button
                        type="button"
                        className="icon-menu-button queue-play-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          playQueueTrack(track);
                        }}
                        disabled={!isHost}
                        title="Bu parçayı çal"
                        aria-label={`${track.title || track.videoId} parçasını çal`}
                      >
                        <PlayMiniGlyph />
                      </button>
                      <button
                        type="button"
                        className="icon-menu-button queue-drag-handle"
                        draggable={isHost}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          setDraggedQueueTrackId(track.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setDraggedQueueTrackId(null)}
                        onClick={(event) => event.stopPropagation()}
                        disabled={!isHost}
                        title="Sırayı sürükle"
                        aria-label={`${track.title || track.videoId} sırasını değiştir`}
                      >
                        <ListGlyph />
                      </button>
                    </div>
                  </li>
                ))
              ) : (
                <li className="queue-empty">Sıraya link eklenmedi.</li>
              )}
            </ol>
          </section>

          <form className="sidebar-link-bar sidebar-card" onSubmit={submitQueueLink}>
            <LinkGlyph />
            <input
              type="url"
              value={queueLinkDraft}
              placeholder="YouTube Music linki ekle"
              onChange={(event) => setQueueLinkDraft(event.target.value)}
            />
            <button type="submit" disabled={!queueLinkDraft.trim()} aria-label="Linki sıraya ekle">
              <ChevronRightGlyph />
            </button>
          </form>
        </aside>
      </div>

      <section className="playlist-vinyl-rail" aria-label="Kayitli listeler">
        <div className="playlist-vinyl-scroller">
          {playlists.length > 0 ? (
            <div className="playlist-vinyl-row">
              {playlists.map((playlist) => {
                const isSelected = playlist.id === selectedPlaylistId;
                const showActions = isHost && playlistEditMode;
                const vinylSrc = playlistVinylSrc(playlist, playlistVinylChoices);

                return (
                  <div
                    key={playlist.id}
                    className={`vinyl-record-shell${isSelected ? " is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className={`vinyl-record-button${isSelected ? " is-active" : ""}`}
                      onClick={() => applyPlaylist(playlist)}
                      aria-label={`${playlist.name} listesini ${isHost ? "oda sirasina yukle" : "sec"}`}
                      title={`${playlist.name} · ${playlist.tracks.length} sarki`}
                    >
                      <img src={vinylSrc} alt="" aria-hidden="true" />
                    </button>
                    <span className="vinyl-record-name">{playlist.name}</span>
                    {isHost ? (
                      <>
                        <button
                          type="button"
                          className={`vinyl-edit-badge${showActions ? " is-visible" : ""}`}
                          disabled={playlistBusy}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditPlaylistOverlay(playlist);
                          }}
                          aria-label={`${playlist.name} listesini duzenle`}
                          title="Duzenle"
                        >
                          <EditGlyph />
                        </button>
                        <button
                          type="button"
                          className={`vinyl-delete-badge${showActions ? " is-visible" : ""}`}
                          disabled={playlistBusy}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDeletePlaylist(playlist);
                          }}
                          aria-label={`${playlist.name} listesini sil`}
                          title="Sil"
                        >
                          <CloseGlyph />
                        </button>
                      </>
                    ) : null}
                  </div>
                );
              })}

              <div className="vinyl-record-shell vinyl-record-shell--add">
                <button
                  type="button"
                  className="vinyl-record-button vinyl-record-button--plus"
                  onClick={openCreatePlaylistOverlay}
                  aria-label="Yeni liste olustur"
                  title="Yeni liste"
                >
                  <img src="/vinyls/11.png" alt="" aria-hidden="true" />
                  <span className="vinyl-record-plus">
                    <PlusGlyph />
                  </span>
                </button>
                <span className="vinyl-record-name">Yeni liste</span>
              </div>
            </div>
          ) : (
            <div className="playlist-vinyl-empty">
              {playlistBusy ? "Listeler yukleniyor..." : "Henuz kayitli liste yok. Yeni liste icin + plagi kullan."}
            </div>
          )}
        </div>
      </section>

      {showAddPlaylistOverlay ? (
        <div className="playlist-overlay" role="dialog" aria-modal="true">
          <div className="playlist-overlay-backdrop" onClick={() => setShowAddPlaylistOverlay(false)} />
          <section className="playlist-overlay-panel">
            <div className="playlist-overlay-header">
              <div>
                <span className="modal-kicker">{playlistFormMode === "edit" ? "LISTE AYARLARI" : "YENI KOLEKSIYON"}</span>
                <h2>{playlistFormMode === "edit" ? "Listeyi düzenle" : "Yeni liste"}</h2>
              </div>
              <button type="button" className="icon-menu-button" onClick={() => setShowAddPlaylistOverlay(false)} aria-label="Kapat">
                <CloseGlyph />
              </button>
            </div>
            <form className="pf-form playlist-create-form" onSubmit={submitPlaylist}>
              <div className="playlist-create-fields">
                <label htmlFor="playlist-name">Liste adı</label>
                <input
                  id="playlist-name"
                  value={playlistFormName}
                  placeholder="Gece sürüşü"
                  onChange={(event) => setPlaylistFormName(event.target.value)}
                />
                {playlistFormMode === "create" ? (
                  <>
                    <label htmlFor="queue-links">Linkler</label>
                    <textarea
                      id="queue-links"
                      value={playlistFormLinks}
                      rows={8}
                      placeholder={"https://music.youtube.com/watch?v=...\nhttps://music.youtube.com/watch?v=..."}
                      onChange={(event) => setPlaylistFormLinks(event.target.value)}
                    />
                  </>
                ) : (
                  <div className="playlist-edit-note">
                    Kapak ve isim güncellenir. Şarkı sırasını oda sırasından sürükleyerek değiştirebilirsin.
                  </div>
                )}
                <div className="pf-actions">
                  <button type="submit" className="pf-save" disabled={playlistBusy}>
                    {playlistFormMode === "edit" ? "Güncelle" : "Kaydet"}
                  </button>
                </div>
                {playlistError ? <p className="error-message" role="alert">{playlistError}</p> : null}
              </div>

              <div className="playlist-cover-picker">
                <label>Kapak</label>
                <div className="playlist-cover-preview">
                  <img src={playlistFormVinyl} alt="" aria-hidden="true" />
                </div>
                <div className="playlist-cover-grid">
                  {VINYL_ARTS.map((vinylSrc, index) => (
                    <button
                      type="button"
                      key={vinylSrc}
                      className={`playlist-cover-option${playlistFormVinyl === vinylSrc ? " is-selected" : ""}`}
                      onClick={() => setPlaylistFormVinyl(vinylSrc)}
                      aria-label={`Kapak ${index + 1}`}
                    >
                      <img src={vinylSrc} alt="" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {pendingDeletePlaylist ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Liste silme onayi">
          <div className="confirm-overlay-backdrop" onClick={() => setPendingDeletePlaylist(null)} />
          <section className="confirm-panel">
            <div className="confirm-vinyl">
              <img src={playlistVinylSrc(pendingDeletePlaylist, playlistVinylChoices)} alt="" aria-hidden="true" />
            </div>
            <div className="confirm-copy">
              <span className="modal-kicker">EMIN MISIN?</span>
              <h2>{pendingDeletePlaylist.name}</h2>
              <p>Bu liste kalıcı olarak silinecek.</p>
            </div>
            <div className="confirm-actions">
              <button type="button" className="confirm-secondary" onClick={() => setPendingDeletePlaylist(null)}>
                Vazgeç
              </button>
              <button
                type="button"
                className="confirm-danger"
                disabled={playlistBusy}
                onClick={() => void removePlaylist(pendingDeletePlaylist.id)}
              >
                Sil
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Artwork({ className, src, fallback }: { className: string; src?: string; fallback: string }) {
  const [hasError, setHasError] = useState(false);
  const showImage = src && !hasError;

  return (
    <div className={className}>
      {showImage ? (
        <img src={src} alt="" aria-hidden="true" onError={() => setHasError(true)} />
      ) : (
        <span>{fallback.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
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

function playlistVinylSrc(playlist: Playlist, choices: Record<string, string>) {
  return choices[playlist.id] ?? VINYL_ARTS[stableHash(playlist.id || playlist.name) % VINYL_ARTS.length];
}

function hasDuplicatePlaylistName(playlists: Playlist[], name: string, exceptPlaylistId: string | null): boolean {
  const normalized = name.trim().toLocaleLowerCase("tr");
  return playlists.some(
    (playlist) => playlist.id !== exceptPlaylistId && playlist.name.trim().toLocaleLowerCase("tr") === normalized,
  );
}

function savePlaylistVinylChoice(existing: Record<string, string>, playlistId: string, vinylSrc: string) {
  const next = { ...existing, [playlistId]: vinylSrc };
  savePlaylistVinylChoices(next);
  return next;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function loadPlaylistVinylChoices() {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(PLAYLIST_VINYL_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, string>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => VINYL_ARTS.includes(value)));
  } catch {
    return {};
  }
}

function savePlaylistVinylChoices(choices: Record<string, string>) {
  try {
    window.localStorage.setItem(PLAYLIST_VINYL_STORAGE_KEY, JSON.stringify(choices));
  } catch {
    // Ignore storage failures; deterministic cover fallback still works.
  }
}

type TransportGlyphProps = {
  kind: "previous" | "play" | "pause" | "next";
};

function TransportGlyph({ kind }: TransportGlyphProps) {
  if (kind === "play") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 6.5 18 12 8 17.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "pause") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="6.5" width="3.5" height="11" rx="1" fill="currentColor" />
        <rect x="13.5" y="6.5" width="3.5" height="11" rx="1" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "previous") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 6.5v11M17 6.8 9.2 12 17 17.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 6.5v11M7 6.8 14.8 12 7 17.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type SidebarGlyphProps = {
  kind: "people" | "heart" | "note";
};

function SidebarGlyph({ kind }: SidebarGlyphProps) {
  if (kind === "people") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 11.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm9 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 18.4c0-2.2 2.1-4 4.8-4s4.7 1.8 4.7 4v1.1H3v-1.1Zm10.6 1.1v-.8c0-1 .4-1.9 1-2.7 2.1.2 3.8 1.6 3.8 3.5v.1h-4.8Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "heart") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20.2c-.5 0-1-.2-1.4-.6C6 15.6 3.5 13 3.5 9.6 3.5 6.9 5.6 5 8.2 5c1.6 0 3 1 3.8 2.2C12.8 6 14.2 5 15.8 5c2.6 0 4.7 1.9 4.7 4.6 0 3.4-2.5 6-7.1 10-.4.4-.9.6-1.4.6Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 17.5V9.8m4.5 7.7V6.5m4.5 11V12m-10 7.5 10.8-1.9M5 6.5l2.4-.4 10.1-1.7a1 1 0 0 1 1.2 1v11.1a1 1 0 0 1-.8 1l-10.3 1.8a1 1 0 0 1-1.2-1V6.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6.5h.01M12 12h.01M12 17.5h.01" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function RefreshGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 0 1-13.7 5.6M4 12A8 8 0 0 1 17.7 6.4M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ListGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h11M8 12h11M8 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlayMiniGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7.5 17 12l-8 4.5Z" fill="currentColor" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19h4l9.2-9.2a2.1 2.1 0 0 0-3-3L6 16v3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m13.8 8.2 2 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13.5a4 4 0 0 0 5.7 0l2.1-2.1a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10.5a4 4 0 0 0-5.7 0l-2.1 2.1a4 4 0 0 0 5.7 5.7l1.2-1.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatRelativeDate(value: string): string {
  const updatedAt = Date.parse(value);
  if (Number.isNaN(updatedAt)) return "az önce";
  const diffDays = Math.max(0, Math.floor((Date.now() - updatedAt) / 86_400_000));
  if (diffDays === 0) return "bugün";
  if (diffDays === 1) return "dün";
  if (diffDays < 7) return `${diffDays} gün önce`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} hafta önce`;
  return `${Math.floor(diffDays / 30)} ay önce`;
}
