import { createServer, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { Server, type Socket } from "socket.io";
import type { Config } from "./config.js";
import { originAllowed } from "./config.js";
import { createPlaylistRepository, playlistPersistenceMode } from "./playlist-repository.js";
import { PlaylistService } from "./playlist-service.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { RoomStore, StoreError } from "./room-store.js";
import {
  clockPingSchema,
  createRoomSchema,
  joinRoomSchema,
  leaveRoomSchema,
  playerCommandSchema,
  playlistSaveSchema,
  queueAddSchema,
  queueReorderSchema,
  reconnectRoomSchema,
  stateReportSchema,
} from "./schemas.js";

type Session = {
  roomCode: string;
  participantId: string;
};

export type AppInstance = {
  httpServer: HttpServer;
  io: Server;
  store: RoomStore;
};

export function createApp(config: Config): AppInstance {
  const app = express();
  app.use(cors());
  app.use(express.json());
  const playlistService = new PlaylistService(createPlaylistRepository());
  // Log persistence mode on startup to help diagnose deployment issues where
  // the server may accidentally use the in-memory repository (causing lists
  // to disappear after deploy).
  try {
    const mode = playlistPersistenceMode();
    // eslint-disable-next-line no-console
    console.log("Playlist persistence mode:", mode);
    if (mode === "supabase-postgres") {
      // Warm the playlist cache and verify DB connectivity.
      playlistService
        .listPlaylists()
        .then((lists) => {
          // eslint-disable-next-line no-console
          console.log(`Loaded ${lists.length} playlists from DB`);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("Error loading playlists from DB:", err?.message ?? err);
        });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Unable to determine playlist persistence mode:", err?.message ?? err);
  }
  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      rooms: store.rooms.size,
      playlistPersistence: playlistPersistenceMode(),
    });
  });
  app.get("/api/playlists", async (_request, response) => {
    response.json({ playlists: await playlistService.listPlaylists() });
  });
  app.post("/api/playlists", async (request, response) => {
    const parsed = playlistSaveSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: "Gecersiz liste verisi." });
      return;
    }
    try {
      const playlist = await playlistService.savePlaylist(parsed.data.name, parsed.data.musicUrls);
      response.json({ playlist });
    } catch (error) {
      response.status(400).json({ message: mapPlaylistError(error) });
    }
  });
  app.post("/api/playlists/:playlistId/reorder", async (request, response) => {
    const parsed = queueAddSchema.safeParse({ musicUrls: request.body?.musicUrls });
    if (!parsed.success) {
      response.status(400).json({ message: "Gecersiz sira verisi." });
      return;
    }
    try {
      const playlist = await playlistService.reorderPlaylist(request.params.playlistId, parsed.data.musicUrls);
      response.json({ playlist });
    } catch {
      response.status(400).json({ message: "Liste sirasi guncellenemedi." });
    }
  });
  app.delete("/api/playlists/:playlistId", async (request, response) => {
    try {
      await playlistService.deletePlaylist(request.params.playlistId);
      response.status(204).end();
    } catch {
      response.status(404).json({ message: "Liste bulunamadi." });
    }
  });

  const webDistDir = path.resolve(process.cwd(), config.webDistDir);
  const indexPath = path.join(webDistDir, "index.html");
  if (existsSync(indexPath)) {
    app.use(express.static(webDistDir));
    app.get(/^(?!\/health|\/socket\.io).*/, (_request, response) => {
      response.sendFile(indexPath);
    });
  }

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, originAllowed(origin, config.allowedOrigins)),
      methods: ["GET", "POST"],
    },
  });
  const store = new RoomStore({
    roomCapacity: config.roomCapacity,
    roomCodeLength: config.roomCodeLength,
  });
  const ipLimiter = new FixedWindowRateLimiter(20, 60_000);
  const disconnectTimers = new Map<string, NodeJS.Timeout>();

  io.use((socket, next) => {
    if (!originAllowed(socket.handshake.headers.origin, config.allowedOrigins)) {
      next(new Error("ORIGIN_NOT_ALLOWED"));
      return;
    }
    next();
  });

  io.on("connection", (socket) => {
    const commandLimiter = new FixedWindowRateLimiter(10, 1_000);

    socket.on("room:create", (payload) => {
      void handle(socket, createRoomSchema, payload, async (data) => {
        enforceIpLimit(socket, ipLimiter);
        leaveCurrentSession(socket, io, store, disconnectTimers);
        const { room, participant } = store.createRoom(data.nickname, socket.id);
        setSession(socket, room.code, participant.id);
        socket.join(room.code);
        socket.emit("room:joined", {
          participantId: participant.id,
          reconnectToken: participant.reconnectToken,
          snapshot: store.snapshot(room),
        });
      });
    });

    socket.on("room:join", (payload) => {
      void handle(socket, joinRoomSchema, payload, async (data) => {
        enforceIpLimit(socket, ipLimiter);
        leaveCurrentSession(socket, io, store, disconnectTimers);
        const { room, participant } = store.joinRoom(data.roomCode, data.nickname, socket.id);
        setSession(socket, room.code, participant.id);
        socket.join(room.code);
        socket.emit("room:joined", {
          participantId: participant.id,
          reconnectToken: participant.reconnectToken,
          snapshot: store.snapshot(room),
        });
        socket.to(room.code).emit("room:participant-joined", store.snapshot(room));
      });
    });

    socket.on("room:reconnect", (payload) => {
      void handle(socket, reconnectRoomSchema, payload, async (data) => {
        leaveCurrentSession(socket, io, store, disconnectTimers);
        const { room, participant } = store.reconnect(
          data.roomCode,
          data.participantId,
          data.reconnectToken,
          socket.id,
        );
        clearDisconnectTimer(disconnectTimers, room.code, participant.id);
        setSession(socket, room.code, participant.id);
        socket.join(room.code);
        socket.emit("room:joined", {
          participantId: participant.id,
          reconnectToken: participant.reconnectToken,
          snapshot: store.snapshot(room),
        });
        io.to(room.code).emit("room:snapshot", store.snapshot(room));
      });
    });

    socket.on("room:leave", (payload) => {
      void handle(socket, leaveRoomSchema, payload, async (data) => {
        const session = getSession(socket);
        if (!session || session.roomCode !== data.roomCode) return;
        removeSessionParticipant(socket, io, store, disconnectTimers);
      });
    });

    socket.on("player:command", (payload) => {
      if (!commandLimiter.allow(socket.id)) {
        emitError(socket, "RATE_LIMITED", "Cok fazla komut gonderildi.");
        return;
      }
      void handle(socket, playerCommandSchema, payload, async (data) => {
        const session = requireSession(socket);
        const playback = await store.applyPlayerCommand(session.roomCode, session.participantId, data);
        io.to(session.roomCode).emit("player:state", playback);
      });
    });

    socket.on("player:state-report", (payload) => {
      void handle(socket, stateReportSchema, payload, async () => {
        requireSession(socket);
        // Reserved for diagnostics; playback authority remains with host commands.
      });
    });

    socket.on("queue:add", (payload) => {
      void handle(socket, queueAddSchema, payload, async (data) => {
        const session = requireSession(socket);
        await store.addQueueTracks(session.roomCode, session.participantId, data.musicUrls, data.insertAfterId);
        const room = store.rooms.get(session.roomCode);
        if (!room) throw new RequestError("ROOM_NOT_FOUND", "Oda bulunamadi.");
        io.to(session.roomCode).emit("room:snapshot", store.snapshot(room));
      });
    });

    socket.on("queue:replace", (payload) => {
      void handle(socket, queueAddSchema, payload, async (data) => {
        const session = requireSession(socket);
        await store.replaceQueueTracks(session.roomCode, session.participantId, data.musicUrls);
        const room = store.rooms.get(session.roomCode);
        if (!room) throw new RequestError("ROOM_NOT_FOUND", "Oda bulunamadi.");
        io.to(session.roomCode).emit("room:snapshot", store.snapshot(room));
      });
    });

    socket.on("queue:reorder", (payload) => {
      void handle(socket, queueReorderSchema, payload, async (data) => {
        const session = requireSession(socket);
        store.reorderQueue(session.roomCode, session.participantId, data.orderedTrackIds);
        const room = store.rooms.get(session.roomCode);
        if (!room) throw new RequestError("ROOM_NOT_FOUND", "Oda bulunamadi.");
        io.to(session.roomCode).emit("room:snapshot", store.snapshot(room));
      });
    });

    socket.on("queue:advance", () => {
      void handle(socket, { safeParse: () => ({ success: true as const, data: undefined }) }, undefined, async () => {
        const session = requireSession(socket);
        const playback = store.advanceQueue(session.roomCode, session.participantId);
        const room = store.rooms.get(session.roomCode);
        if (!room) throw new RequestError("ROOM_NOT_FOUND", "Oda bulunamadi.");
        io.to(session.roomCode).emit("room:snapshot", store.snapshot(room));
        if (playback) io.to(session.roomCode).emit("player:state", playback);
      });
    });

    socket.on("queue:previous", () => {
      void handle(socket, { safeParse: () => ({ success: true as const, data: undefined }) }, undefined, async () => {
        const session = requireSession(socket);
        const playback = store.previousQueue(session.roomCode, session.participantId);
        const room = store.rooms.get(session.roomCode);
        if (!room) throw new RequestError("ROOM_NOT_FOUND", "Oda bulunamadi.");
        io.to(session.roomCode).emit("room:snapshot", store.snapshot(room));
        if (playback) io.to(session.roomCode).emit("player:state", playback);
      });
    });

    socket.on("clock:ping", (payload) => {
      void handle(socket, clockPingSchema, payload, async (data) => {
        socket.emit("clock:pong", {
          clientSentAtMs: data.clientSentAtMs,
          serverTimeMs: Date.now(),
        });
      });
    });

    socket.on("disconnect", () => {
      const session = getSession(socket);
      if (!session) return;
      store.markDisconnected(session.roomCode, session.participantId);
      const key = timerKey(session.roomCode, session.participantId);
      clearDisconnectTimer(disconnectTimers, session.roomCode, session.participantId);
      disconnectTimers.set(
        key,
        setTimeout(() => {
          disconnectTimers.delete(key);
          removeParticipant(io, store, session.roomCode, session.participantId);
        }, config.reconnectGraceMs),
      );
      const room = store.rooms.get(session.roomCode);
      if (room) io.to(room.code).emit("room:snapshot", store.snapshot(room));
    });
  });

  return { httpServer, io, store };
}

function handle<T>(
  socket: Socket,
  schema: { safeParse: (payload: unknown) => { success: true; data: T } | { success: false; error: unknown } },
  payload: unknown,
  action: (data: T) => void | Promise<void>,
): Promise<void> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    emitError(socket, "INVALID_PAYLOAD", "Gecersiz istek.");
    return Promise.resolve();
  }
  return Promise.resolve(action(parsed.data)).catch((error) => {
    if (error instanceof StoreError) {
      emitError(socket, error.code, error.message);
      return;
    }
    if (error instanceof RequestError) {
      emitError(socket, error.code, error.message);
      return;
    }
    console.error(error);
    emitError(socket, "INTERNAL_ERROR", "Sunucu hatasi.");
  });
}

function enforceIpLimit(socket: Socket, limiter: FixedWindowRateLimiter) {
  if (!limiter.allow(socket.handshake.address)) {
    throw new RequestError("RATE_LIMITED", "Cok fazla oda istegi gonderildi.");
  }
}

function requireSession(socket: Socket): Session {
  const session = getSession(socket);
  if (!session) throw new RequestError("NOT_IN_ROOM", "Bir odaya bagli degilsiniz.");
  return session;
}

function getSession(socket: Socket): Session | null {
  return (socket.data.session as Session | undefined) ?? null;
}

function setSession(socket: Socket, roomCode: string, participantId: string) {
  socket.data.session = { roomCode, participantId } satisfies Session;
}

function leaveCurrentSession(
  socket: Socket,
  io: Server,
  store: RoomStore,
  timers: Map<string, NodeJS.Timeout>,
) {
  if (getSession(socket)) removeSessionParticipant(socket, io, store, timers);
}

function removeSessionParticipant(
  socket: Socket,
  io: Server,
  store: RoomStore,
  timers: Map<string, NodeJS.Timeout>,
) {
  const session = getSession(socket);
  if (!session) return;
  clearDisconnectTimer(timers, session.roomCode, session.participantId);
  socket.leave(session.roomCode);
  socket.data.session = undefined;
  removeParticipant(io, store, session.roomCode, session.participantId);
}

function removeParticipant(io: Server, store: RoomStore, roomCode: string, participantId: string) {
  const result = store.removeParticipant(roomCode, participantId);
  if (!result.removed) return;
  if (!result.room) return;
  io.to(roomCode).emit("room:participant-left", store.snapshot(result.room));
  if (result.newHostId) {
    io.to(roomCode).emit("room:host-changed", {
      hostParticipantId: result.newHostId,
      snapshot: store.snapshot(result.room),
    });
  }
}

function clearDisconnectTimer(timers: Map<string, NodeJS.Timeout>, roomCode: string, participantId: string) {
  const key = timerKey(roomCode, participantId);
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

function timerKey(roomCode: string, participantId: string) {
  return `${roomCode}:${participantId}`;
}

function emitError(socket: Socket, code: string, message: string) {
  socket.emit("server:error", { code, message });
}

class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function mapPlaylistError(error: unknown): string {
  if (!(error instanceof Error)) return "Liste kaydedilemedi.";
  if (error.message === "LIST_NAME_REQUIRED") return "Liste ismi gerekli.";
  if (error.message === "LIST_TRACKS_REQUIRED") return "Listede en az bir sarki olmali.";
  if (error.message === "INVALID_MUSIC_URL") return "Listede gecersiz YouTube Music baglantisi var.";
  return "Liste kaydedilemedi.";
}
