import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { clearSession, loadSession, saveSession } from "../lib/session";
import { acceptsRevision, median } from "../lib/sync";
import type { PlayerCommand, PlaybackState, RoomSnapshot } from "../types";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useRoom(initialRoomCode: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const participantIdRef = useRef<string | null>(null);
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  const clockOffsetsRef = useRef<number[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  const updateSnapshot = useCallback((incoming: RoomSnapshot) => {
    incoming = normalizeSnapshot(incoming);
    const currentPlayback = snapshotRef.current?.playback;
    if (
      currentPlayback &&
      incoming.playback &&
      !acceptsRevision(currentPlayback.revision, incoming.playback.revision)
    ) {
      incoming = { ...incoming, playback: currentPlayback };
    }
    snapshotRef.current = incoming;
    setSnapshot(incoming);
  }, []);

  useEffect(() => {
    const socket = io({ autoConnect: false });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("connected");
      setError(null);
      if (initialRoomCode) {
        const saved = loadSession(initialRoomCode);
        if (saved) socket.emit("room:reconnect", saved);
      }
    });
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("connect_error", () => {
      setStatus("disconnected");
      setError("Sunucuya baglanilamadi.");
    });
    socket.on(
      "room:joined",
      (payload: { participantId: string; reconnectToken: string; snapshot: RoomSnapshot }) => {
        participantIdRef.current = payload.participantId;
        setParticipantId(payload.participantId);
        updateSnapshot(payload.snapshot);
        saveSession({
          roomCode: payload.snapshot.roomCode,
          participantId: payload.participantId,
          reconnectToken: payload.reconnectToken,
        });
        const targetPath = `/room/${payload.snapshot.roomCode}`;
        if (window.location.pathname !== targetPath) window.history.replaceState({}, "", targetPath);
      },
    );
    socket.on("room:snapshot", updateSnapshot);
    socket.on("room:participant-joined", updateSnapshot);
    socket.on("room:participant-left", updateSnapshot);
    socket.on("room:host-changed", (payload: { snapshot: RoomSnapshot }) => updateSnapshot(payload.snapshot));
    socket.on("player:state", (playback: PlaybackState) => {
      const current = snapshotRef.current;
      if (!current || !acceptsRevision(current.playback?.revision ?? 0, playback.revision)) return;
      updateSnapshot({ ...current, playback });
    });
    socket.on("clock:pong", (payload: { clientSentAtMs: number; serverTimeMs: number }) => {
      const receivedAt = Date.now();
      const roundTripMs = receivedAt - payload.clientSentAtMs;
      const offset = payload.serverTimeMs + roundTripMs / 2 - receivedAt;
      clockOffsetsRef.current = [...clockOffsetsRef.current.slice(-4), offset];
      setServerOffsetMs(median(clockOffsetsRef.current));
    });
    socket.on("server:error", (payload: { code: string; message: string }) => {
      if (payload.code === "INVALID_RECONNECT" || payload.code === "ROOM_NOT_FOUND") {
        if (initialRoomCode) clearSession(initialRoomCode);
      }
      setError(payload.message);
    });

    socket.connect();
    const ping = () => socket.emit("clock:ping", { clientSentAtMs: Date.now() });
    const interval = window.setInterval(ping, 10_000);
    ping();

    return () => {
      window.clearInterval(interval);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [initialRoomCode, updateSnapshot]);

  const createRoom = useCallback((nickname: string) => {
    setError(null);
    socketRef.current?.emit("room:create", { nickname });
  }, []);

  const joinRoom = useCallback((roomCode: string, nickname: string) => {
    setError(null);
    socketRef.current?.emit("room:join", { roomCode, nickname });
  }, []);

  const sendPlayerCommand = useCallback((command: PlayerCommand) => {
    socketRef.current?.emit("player:command", command);
  }, []);

  const addQueueTracks = useCallback((musicUrls: string[], insertAfterId?: string) => {
    socketRef.current?.emit("queue:add", { musicUrls, insertAfterId });
  }, []);

  const replaceQueueTracks = useCallback((musicUrls: string[]) => {
    socketRef.current?.emit("queue:replace", { musicUrls });
  }, []);

  const advanceQueue = useCallback(() => {
    socketRef.current?.emit("queue:advance");
  }, []);

  const previousQueue = useCallback(() => {
    socketRef.current?.emit("queue:previous");
  }, []);

  const reorderQueue = useCallback((orderedTrackIds: string[]) => {
    socketRef.current?.emit("queue:reorder", { orderedTrackIds });
  }, []);

  const transferHost = useCallback((targetParticipantId: string) => {
    socketRef.current?.emit("room:transfer-host", { targetParticipantId });
  }, []);

  const serverNow = useCallback(() => Date.now() + serverOffsetMs, [serverOffsetMs]);

  const leaveRoom = useCallback(() => {
    const roomCode = snapshotRef.current?.roomCode;
    if (!roomCode) return;
    socketRef.current?.emit("room:leave", { roomCode });
    clearSession(roomCode);
    participantIdRef.current = null;
    snapshotRef.current = null;
    setParticipantId(null);
    setSnapshot(null);
    window.history.replaceState({}, "", "/");
  }, []);

  return {
    status,
    snapshot,
    participantId,
    error,
    serverNow,
    createRoom,
    joinRoom,
    sendPlayerCommand,
    addQueueTracks,
    replaceQueueTracks,
    reorderQueue,
    transferHost,
    advanceQueue,
    previousQueue,
    leaveRoom,
  };
}

function normalizeSnapshot(snapshot: RoomSnapshot): RoomSnapshot {
  return {
    ...snapshot,
    participants: snapshot.participants ?? [],
    queue: snapshot.queue ?? [],
    activeQueueItemId: snapshot.activeQueueItemId ?? null,
  };
}
