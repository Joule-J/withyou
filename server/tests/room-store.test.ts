import { describe, expect, it } from "vitest";
import { RoomStore, StoreError } from "../src/room-store.js";
import type { TrackMetadata } from "../src/track-metadata.js";

function createStore(
  options: {
    capacity?: number;
    now?: () => number;
    codes?: string[];
    resolveTrackTitle?: (videoId: string) => Promise<string | null>;
    resolveTrackMetadata?: (videoId: string) => Promise<TrackMetadata>;
  } = {},
) {
  const codes = options.codes ?? ["ABC123"];
  let index = 0;
  return new RoomStore({
    roomCapacity: options.capacity ?? 10,
    roomCodeLength: 6,
    now: options.now,
    codeGenerator: () => codes[Math.min(index++, codes.length - 1)],
    resolveTrackTitle: options.resolveTrackTitle,
    resolveTrackMetadata: options.resolveTrackMetadata,
  });
}

describe("RoomStore", () => {
  it("retries when a generated room code collides", () => {
    const store = createStore({ codes: ["ABC123", "ABC123", "XYZ789"] });
    expect(store.createRoom("Host One", "socket-1").room.code).toBe("ABC123");
    expect(store.createRoom("Host Two", "socket-2").room.code).toBe("XYZ789");
  });

  it("creates and joins a room", () => {
    const store = createStore();
    const created = store.createRoom("Host", "socket-1");
    const joined = store.joinRoom(created.room.code, "Guest", "socket-2");
    const snapshot = store.snapshot(joined.room);

    expect(snapshot.participants).toHaveLength(2);
    expect(snapshot.hostParticipantId).toBe(created.participant.id);
  });

  it("rejects joins above room capacity", () => {
    const store = createStore({ capacity: 1 });
    const { room } = store.createRoom("Host", "socket-1");
    expect(() => store.joinRoom(room.code, "Guest", "socket-2")).toThrowError(StoreError);
  });

  it("allows only the host to change playback and increments revisions", async () => {
    let now = 1_000;
    const store = createStore({ now: () => now });
    const { room, participant: host } = store.createRoom("Host", "socket-1");
    const { participant: guest } = store.joinRoom(room.code, "Guest", "socket-2");
    const command = {
      type: "play" as const,
      videoId: "dQw4w9WgXcQ",
      musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      positionSeconds: 12,
      clientCommandId: "command-1",
    };

    await expect(store.applyPlayerCommand(room.code, guest.id, command)).rejects.toThrowError("host");
    await expect(store.applyPlayerCommand(room.code, host.id, command)).resolves.toMatchObject({
      revision: 1,
      isPlaying: true,
      updatedAtServerMs: 1_000,
    });

    now = 2_000;
    await expect(
      store.applyPlayerCommand(room.code, host.id, {
        ...command,
        type: "pause",
        clientCommandId: "command-2",
      }),
    ).resolves.toMatchObject({ revision: 2, isPlaying: false, updatedAtServerMs: 2_000 });
  });

  it("reconnects with the matching token", () => {
    const store = createStore();
    const { room, participant } = store.createRoom("Host", "socket-1");
    store.markDisconnected(room.code, participant.id);
    const result = store.reconnect(room.code, participant.id, participant.reconnectToken, "socket-2");
    expect(result.participant.socketId).toBe("socket-2");
    expect(result.participant.disconnectedAt).toBeNull();
  });

  it("promotes the oldest connected participant when host leaves", () => {
    let now = 100;
    const store = createStore({ now: () => now++ });
    const { room, participant: host } = store.createRoom("Host", "socket-1");
    const firstGuest = store.joinRoom(room.code, "First", "socket-2").participant;
    store.joinRoom(room.code, "Second", "socket-3");

    const result = store.removeParticipant(room.code, host.id);
    expect(result.newHostId).toBe(firstGuest.id);
    expect(result.room?.hostParticipantId).toBe(firstGuest.id);
  });

  it("deletes an empty room", () => {
    const store = createStore();
    const { room, participant } = store.createRoom("Host", "socket-1");
    store.removeParticipant(room.code, participant.id);
    expect(store.rooms.has(room.code)).toBe(false);
  });

  it("stores resolved track titles for playback and queue", async () => {
    const store = createStore({
      resolveTrackTitle: async (videoId) => `Title ${videoId}`,
    });
    const { room, participant: host } = store.createRoom("Host", "socket-1");

    await store.applyPlayerCommand(room.code, host.id, {
      type: "change_track",
      videoId: "dQw4w9WgXcQ",
      musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      positionSeconds: 0,
      clientCommandId: "command-1",
      isPlaying: true,
    });
    await store.addQueueTracks(room.code, host.id, ["https://music.youtube.com/watch?v=y8MArfXrn80"]);

    expect(room.playback?.title).toBe("Title dQw4w9WgXcQ");
    expect(store.snapshot(room).queue[0]?.title).toBe("Title y8MArfXrn80");
  });

  it("stores resolved thumbnails for playback and queue snapshots", async () => {
    const store = createStore({
      resolveTrackMetadata: async (videoId) => ({
        title: `Title ${videoId}`,
        thumbnailUrl: `https://img.example/${videoId}.jpg`,
      }),
    });
    const { room, participant: host } = store.createRoom("Host", "socket-1");

    await store.applyPlayerCommand(room.code, host.id, {
      type: "change_track",
      videoId: "dQw4w9WgXcQ",
      musicUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      positionSeconds: 0,
      clientCommandId: "command-1",
      isPlaying: true,
    });
    await store.addQueueTracks(room.code, host.id, ["https://music.youtube.com/watch?v=y8MArfXrn80"]);

    expect(room.playback?.thumbnailUrl).toBe("https://img.example/dQw4w9WgXcQ.jpg");
    expect(store.snapshot(room).queue[0]?.thumbnailUrl).toBe("https://img.example/y8MArfXrn80.jpg");
  });

  it("adds queue tracks and loops through them", async () => {
    const store = createStore();
    const { room, participant: host } = store.createRoom("Host", "socket-1");
    await store.addQueueTracks(room.code, host.id, [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=y8MArfXrn80",
    ]);

    expect(room.playback).toBeNull();
    expect(store.snapshot(room).queue).toHaveLength(2);
    expect(store.advanceQueue(room.code, host.id)?.videoId).toBe("dQw4w9WgXcQ");
    expect(store.advanceQueue(room.code, host.id)?.videoId).toBe("y8MArfXrn80");
    expect(store.advanceQueue(room.code, host.id)?.videoId).toBe("dQw4w9WgXcQ");
    expect(store.previousQueue(room.code, host.id)?.videoId).toBe("y8MArfXrn80");
  });

  it("reorders queue tracks", async () => {
    const store = createStore();
    const { room, participant: host } = store.createRoom("Host", "socket-1");
    await store.addQueueTracks(room.code, host.id, [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=y8MArfXrn80",
    ]);

    const before = store.snapshot(room).queue;
    store.reorderQueue(room.code, host.id, [before[1].id, before[0].id]);

    expect(store.snapshot(room).queue.map((track) => track.videoId)).toEqual(["y8MArfXrn80", "dQw4w9WgXcQ"]);
  });

  it("autoplays the first queue track after replacing an empty room queue", async () => {
    const store = createStore();
    const { room, participant: host } = store.createRoom("Host", "socket-1");

    const playback = await store.replaceQueueTracks(room.code, host.id, [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=y8MArfXrn80",
    ]);

    expect(playback?.videoId).toBe("dQw4w9WgXcQ");
    expect(room.playback?.videoId).toBe("dQw4w9WgXcQ");
    expect(room.activeQueueItemId).toBe(room.queue[0]?.id);
  });

  it("starts the first replacement queue track even when another track is already playing", async () => {
    const store = createStore();
    const { room, participant: host } = store.createRoom("Host", "socket-1");

    await store.applyPlayerCommand(room.code, host.id, {
      type: "change_track",
      videoId: "oldTrack",
      musicUrl: "https://music.youtube.com/watch?v=oldTrack",
      positionSeconds: 12,
      clientCommandId: "command-1",
      isPlaying: true,
    });

    const playback = await store.replaceQueueTracks(room.code, host.id, [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=y8MArfXrn80",
    ]);

    expect(playback?.videoId).toBe("dQw4w9WgXcQ");
    expect(playback?.positionSeconds).toBe(0);
    expect(room.playback?.videoId).toBe("dQw4w9WgXcQ");
    expect(room.activeQueueItemId).toBe(room.queue[0]?.id);
  });

  it("marks the matching queue item active when changing to a queued track", async () => {
    const store = createStore();
    const { room, participant: host } = store.createRoom("Host", "socket-1");
    await store.addQueueTracks(room.code, host.id, [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=y8MArfXrn80",
    ]);

    await store.applyPlayerCommand(room.code, host.id, {
      type: "change_track",
      videoId: "y8MArfXrn80",
      musicUrl: "https://music.youtube.com/watch?v=y8MArfXrn80",
      positionSeconds: 0,
      clientCommandId: "command-1",
      isPlaying: true,
    });

    expect(room.activeQueueItemId).toBe(room.queue[1]?.id);
  });
});
