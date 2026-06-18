import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import { createApp } from "../src/app.js";

const sockets: Socket[] = [];
const servers: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  for (const app of servers.splice(0)) {
    await new Promise<void>((resolve) => app.io.close(() => resolve()));
    app.httpServer.close();
  }
});

describe("Socket.IO room flow", () => {
  it("creates a room, joins a guest, and rejects guest playback commands", async () => {
    const app = createApp({
      port: 0,
      roomCapacity: 10,
      reconnectGraceMs: 20,
      roomCodeLength: 6,
      allowedOrigins: ["http://localhost:*"],
      webDistDir: "../web/dist",
    });
    servers.push(app);
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const port = (app.httpServer.address() as AddressInfo).port;

    const host = connect(port);
    const guest = connect(port);
    sockets.push(host, guest);
    await Promise.all([waitFor(host, "connect"), waitFor(guest, "connect")]);

    host.emit("room:create", { nickname: "Host" });
    const hostJoined = await waitFor<{ snapshot: { roomCode: string } }>(host, "room:joined");

    guest.emit("room:join", { roomCode: hostJoined.snapshot.roomCode, nickname: "Guest" });
    await waitFor(guest, "room:joined");

    guest.emit("player:command", {
      type: "play",
      videoId: "dQw4w9WgXcQ",
      musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      positionSeconds: 0,
      clientCommandId: "guest-command",
    });
    await expect(waitFor<{ code: string }>(guest, "server:error")).resolves.toMatchObject({
      code: "HOST_ONLY",
    });
  });

  it("allows guests to add queue tracks without changing playback", async () => {
    const app = createApp({
      port: 0,
      roomCapacity: 10,
      reconnectGraceMs: 20,
      roomCodeLength: 6,
      allowedOrigins: ["http://localhost:*"],
      webDistDir: "../web/dist",
    });
    servers.push(app);
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const port = (app.httpServer.address() as AddressInfo).port;

    const host = connect(port);
    const guest = connect(port);
    sockets.push(host, guest);
    await Promise.all([waitFor(host, "connect"), waitFor(guest, "connect")]);

    host.emit("room:create", { nickname: "Host" });
    const hostJoined = await waitFor<{ snapshot: { roomCode: string } }>(host, "room:joined");

    guest.emit("room:join", { roomCode: hostJoined.snapshot.roomCode, nickname: "Guest" });
    await waitFor(guest, "room:joined");

    const snapshotPromise = waitFor<{ queue: Array<{ videoId: string; addedByName: string }> }>(host, "room:snapshot");
    guest.emit("queue:add", {
      musicUrls: [
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=y8MArfXrn80",
      ],
    });

    await expect(snapshotPromise).resolves.toMatchObject({
      queue: [
        { videoId: "dQw4w9WgXcQ", addedByName: "Guest" },
        { videoId: "y8MArfXrn80", addedByName: "Guest" },
      ],
    });
  });

  it("transfers host control and enforces the new host authority", async () => {
    const app = createApp({
      port: 0,
      roomCapacity: 10,
      reconnectGraceMs: 20,
      roomCodeLength: 6,
      allowedOrigins: ["http://localhost:*"],
      webDistDir: "../web/dist",
    });
    servers.push(app);
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const port = (app.httpServer.address() as AddressInfo).port;

    const host = connect(port);
    const guest = connect(port);
    sockets.push(host, guest);
    await Promise.all([waitFor(host, "connect"), waitFor(guest, "connect")]);

    host.emit("room:create", { nickname: "Host" });
    const hostJoined = await waitFor<{ participantId: string; snapshot: { roomCode: string } }>(host, "room:joined");

    guest.emit("room:join", { roomCode: hostJoined.snapshot.roomCode, nickname: "Guest" });
    const guestJoined = await waitFor<{ participantId: string }>(guest, "room:joined");

    const hostChangedForHost = waitFor<{ hostParticipantId: string; snapshot: { hostParticipantId: string } }>(
      host,
      "room:host-changed",
    );
    const hostChangedForGuest = waitFor<{ hostParticipantId: string; snapshot: { hostParticipantId: string } }>(
      guest,
      "room:host-changed",
    );
    host.emit("room:transfer-host", { targetParticipantId: guestJoined.participantId });

    await expect(hostChangedForHost).resolves.toMatchObject({
      hostParticipantId: guestJoined.participantId,
      snapshot: { hostParticipantId: guestJoined.participantId },
    });
    await expect(hostChangedForGuest).resolves.toMatchObject({
      hostParticipantId: guestJoined.participantId,
      snapshot: { hostParticipantId: guestJoined.participantId },
    });

    host.emit("player:command", {
      type: "play",
      videoId: "dQw4w9WgXcQ",
      musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      positionSeconds: 0,
      clientCommandId: "old-host-command",
    });
    await expect(waitFor<{ code: string }>(host, "server:error")).resolves.toMatchObject({
      code: "HOST_ONLY",
    });

    const playerState = waitFor<{ videoId: string }>(guest, "player:state");
    guest.emit("player:command", {
      type: "play",
      videoId: "y8MArfXrn80",
      musicUrl: "https://music.youtube.com/watch?v=y8MArfXrn80",
      positionSeconds: 0,
      clientCommandId: "new-host-command",
    });
    await expect(playerState).resolves.toMatchObject({
      videoId: "y8MArfXrn80",
    });
  });

  it("moves to the previous queued track", async () => {
    const app = createApp({
      port: 0,
      roomCapacity: 10,
      reconnectGraceMs: 20,
      roomCodeLength: 6,
      allowedOrigins: ["http://localhost:*"],
      webDistDir: "../web/dist",
    });
    servers.push(app);
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const port = (app.httpServer.address() as AddressInfo).port;

    const host = connect(port);
    sockets.push(host);
    await waitFor(host, "connect");

    host.emit("room:create", { nickname: "Host" });
    await waitFor(host, "room:joined");

    host.emit("queue:add", {
      musicUrls: [
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=y8MArfXrn80",
      ],
    });
    await waitFor(host, "room:snapshot");

    host.emit("queue:advance");
    await waitFor(host, "player:state");

    host.emit("queue:previous");
    await expect(waitFor<{ videoId: string }>(host, "player:state")).resolves.toMatchObject({
      videoId: "y8MArfXrn80",
    });
  });

  it("reorders queue tracks and broadcasts the snapshot", async () => {
    const app = createApp({
      port: 0,
      roomCapacity: 10,
      reconnectGraceMs: 20,
      roomCodeLength: 6,
      allowedOrigins: ["http://localhost:*"],
      webDistDir: "../web/dist",
    });
    servers.push(app);
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const port = (app.httpServer.address() as AddressInfo).port;

    const host = connect(port);
    sockets.push(host);
    await waitFor(host, "connect");

    host.emit("room:create", { nickname: "Host" });
    await waitFor(host, "room:joined");

    host.emit("queue:add", {
      musicUrls: [
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=y8MArfXrn80",
      ],
    });
    const initial = await waitFor<{ queue: Array<{ id: string; videoId: string }> }>(host, "room:snapshot");

    const reorderedSnapshot = waitFor<{ queue: Array<{ videoId: string }> }>(host, "room:snapshot");
    host.emit("queue:reorder", { orderedTrackIds: [initial.queue[1].id, initial.queue[0].id] });

    await expect(reorderedSnapshot).resolves.toMatchObject({
      queue: [{ videoId: "y8MArfXrn80" }, { videoId: "dQw4w9WgXcQ" }],
    });
  });
});

function connect(port: number): Socket {
  return createClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    extraHeaders: { origin: "http://localhost:5173" },
  });
}

function waitFor<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 2_000);
    socket.once(event, (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}
