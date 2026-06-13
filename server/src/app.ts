import { createServer, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { Server, type Socket } from "socket.io";
import type { Config } from "./config.js";
import { originAllowed } from "./config.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { RoomStore, StoreError } from "./room-store.js";
import {
  clockPingSchema,
  createRoomSchema,
  joinRoomSchema,
  leaveRoomSchema,
  playerCommandSchema,
  queueAddSchema,
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
  app.get("/health", (_request, response) => {
    response.json({ ok: true, rooms: store.rooms.size });
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
      handle(socket, createRoomSchema, payload, (data) => {
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
      handle(socket, joinRoomSchema, payload, (data) => {
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
      handle(socket, reconnectRoomSchema, payload, (data) => {
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
      handle(socket, leaveRoomSchema, payload, (data) => {
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
      handle(socket, playerCommandSchema, payload, (data) => {
        const session = requireSession(socket);
        const playback = store.applyPlayerCommand(session.roomCode, session.participantId, data);
        io.to(session.roomCode).emit("player:state", playback);
      });
    });

    socket.on("player:state-report", (payload) => {
      handle(socket, stateReportSchema, payload, () => {
        requireSession(socket);
        // Reserved for diagnostics; playback authority remains with host commands.
      });
    });

    socket.on("queue:add", (payload) => {
      handle(socket, queueAddSchema, payload, (data) => {
        const session = requireSession(socket);
        const playback = store.addQueueTracks(session.roomCode, session.participantId, data.musicUrls);
        const room = store.rooms.get(session.roomCode);
        if (!room) throw new RequestError("ROOM_NOT_FOUND", "Oda bulunamadi.");
        io.to(session.roomCode).emit("room:snapshot", store.snapshot(room));
        if (playback) io.to(session.roomCode).emit("player:state", playback);
      });
    });

    socket.on("queue:advance", () => {
      handle(socket, { safeParse: () => ({ success: true as const, data: undefined }) }, undefined, () => {
        const session = requireSession(socket);
        const playback = store.advanceQueue(session.roomCode, session.participantId);
        const room = store.rooms.get(session.roomCode);
        if (!room) throw new RequestError("ROOM_NOT_FOUND", "Oda bulunamadi.");
        io.to(session.roomCode).emit("room:snapshot", store.snapshot(room));
        if (playback) io.to(session.roomCode).emit("player:state", playback);
      });
    });

    socket.on("clock:ping", (payload) => {
      handle(socket, clockPingSchema, payload, (data) => {
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
  action: (data: T) => void,
) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    emitError(socket, "INVALID_PAYLOAD", "Gecersiz istek.");
    return;
  }
  try {
    action(parsed.data);
  } catch (error) {
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
  }
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
