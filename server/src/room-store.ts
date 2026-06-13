import { randomBytes, randomUUID } from "node:crypto";
import type {
  Participant,
  PlaybackState,
  PlayerCommand,
  PublicParticipant,
  QueueTrack,
  QueueTrackView,
  Room,
  RoomSnapshot,
} from "./types.js";
import { parseMusicUrl } from "./schemas.js";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type StoreOptions = {
  roomCapacity: number;
  roomCodeLength: number;
  now?: () => number;
  codeGenerator?: () => string;
};

export class RoomStore {
  readonly rooms = new Map<string, Room>();
  private readonly roomCapacity: number;
  private readonly roomCodeLength: number;
  private readonly now: () => number;
  private readonly codeGenerator?: () => string;

  constructor(options: StoreOptions) {
    this.roomCapacity = options.roomCapacity;
    this.roomCodeLength = options.roomCodeLength;
    this.now = options.now ?? Date.now;
    this.codeGenerator = options.codeGenerator;
  }

  createRoom(nickname: string, socketId: string) {
    const code = this.createUniqueCode();
    const participant = this.createParticipant(nickname, socketId);
    const room: Room = {
      code,
      createdAt: this.now(),
      hostParticipantId: participant.id,
      participants: new Map([[participant.id, participant]]),
      playback: null,
      queue: [],
      activeQueueItemId: null,
    };
    this.rooms.set(code, room);
    return { room, participant };
  }

  joinRoom(code: string, nickname: string, socketId: string) {
    const room = this.requireRoom(code);
    if (room.participants.size >= this.roomCapacity) {
      throw new StoreError("ROOM_FULL", "Oda dolu.");
    }

    const participant = this.createParticipant(nickname, socketId);
    room.participants.set(participant.id, participant);
    return { room, participant };
  }

  reconnect(code: string, participantId: string, reconnectToken: string, socketId: string) {
    const room = this.requireRoom(code);
    const participant = room.participants.get(participantId);
    if (!participant || participant.reconnectToken !== reconnectToken) {
      throw new StoreError("INVALID_RECONNECT", "Yeniden baglanma bilgileri gecersiz.");
    }

    participant.socketId = socketId;
    participant.disconnectedAt = null;
    return { room, participant };
  }

  markDisconnected(code: string, participantId: string) {
    const room = this.rooms.get(code);
    const participant = room?.participants.get(participantId);
    if (!room || !participant) return null;

    participant.socketId = null;
    participant.disconnectedAt = this.now();
    return { room, participant };
  }

  removeParticipant(code: string, participantId: string) {
    const room = this.rooms.get(code);
    if (!room) return { room: null, removed: null, newHostId: null };

    const removed = room.participants.get(participantId) ?? null;
    if (!removed) return { room, removed: null, newHostId: null };
    room.participants.delete(participantId);

    if (room.participants.size === 0) {
      this.rooms.delete(code);
      return { room: null, removed, newHostId: null };
    }

    let newHostId: string | null = null;
    if (room.hostParticipantId === participantId) {
      const nextHost = [...room.participants.values()]
        .filter((participant) => participant.socketId !== null)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (nextHost) {
        room.hostParticipantId = nextHost.id;
        newHostId = nextHost.id;
      }
    }

    return { room, removed, newHostId };
  }

  applyPlayerCommand(code: string, participantId: string, command: PlayerCommand): PlaybackState {
    const room = this.requireRoom(code);
    if (room.hostParticipantId !== participantId) {
      throw new StoreError("HOST_ONLY", "Bu islemi yalnizca host yapabilir.");
    }

    const parsedUrl = parseMusicUrl(command.musicUrl);
    if (!parsedUrl || parsedUrl.videoId !== command.videoId) {
      throw new StoreError("INVALID_MUSIC_URL", "Gecersiz YouTube Music adresi.");
    }

    const previous = room.playback;
    const isPlaying =
      command.type === "play"
        ? true
        : command.type === "pause"
          ? false
          : command.type === "change_track"
            ? (command.isPlaying ?? true)
            : (previous?.isPlaying ?? false);

    room.playback = {
      revision: (previous?.revision ?? 0) + 1,
      videoId: command.videoId,
      musicUrl: parsedUrl.normalizedUrl,
      title: command.title,
      isPlaying,
      positionSeconds: command.positionSeconds,
      updatedAtServerMs: this.now(),
    };
    if (command.type === "change_track") room.activeQueueItemId = null;
    return room.playback;
  }

  addQueueTracks(code: string, participantId: string, musicUrls: string[]): PlaybackState | null {
    const room = this.requireRoom(code);
    const participant = this.requireHost(room, participantId);
    const tracks = musicUrls.map((musicUrl): QueueTrack => {
      const parsed = parseMusicUrl(musicUrl);
      if (!parsed) throw new StoreError("INVALID_MUSIC_URL", "Gecersiz YouTube Music adresi.");
      return {
        id: randomUUID(),
        videoId: parsed.videoId,
        musicUrl: parsed.normalizedUrl,
        addedByParticipantId: participant.id,
        addedByName: participant.nickname,
        addedAt: this.now(),
      };
    });

    room.queue.push(...tracks);
    if (!room.playback && tracks[0]) return this.playQueueTrack(room, tracks[0]);
    return null;
  }

  advanceQueue(code: string, participantId: string): PlaybackState | null {
    const room = this.requireRoom(code);
    this.requireHost(room, participantId);
    if (room.queue.length === 0) return null;

    const currentIndex = room.queue.findIndex((track) => track.id === room.activeQueueItemId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % room.queue.length : 0;
    return this.playQueueTrack(room, room.queue[nextIndex]);
  }

  snapshot(room: Room): RoomSnapshot {
    return {
      roomCode: room.code,
      hostParticipantId: room.hostParticipantId,
      participants: [...room.participants.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((participant): PublicParticipant => ({
          id: participant.id,
          nickname: participant.nickname,
          isHost: participant.id === room.hostParticipantId,
          isConnected: participant.socketId !== null,
        })),
      playback: room.playback,
      queue: room.queue.map((track): QueueTrackView => ({
        id: track.id,
        videoId: track.videoId,
        musicUrl: track.musicUrl,
        title: track.title,
        addedByName: track.addedByName,
      })),
      activeQueueItemId: room.activeQueueItemId,
    };
  }

  private requireHost(room: Room, participantId: string): Participant {
    if (room.hostParticipantId !== participantId) {
      throw new StoreError("HOST_ONLY", "Bu islemi yalnizca host yapabilir.");
    }
    const participant = room.participants.get(participantId);
    if (!participant) throw new StoreError("PARTICIPANT_NOT_FOUND", "Katilimci bulunamadi.");
    return participant;
  }

  private playQueueTrack(room: Room, track: QueueTrack): PlaybackState {
    room.activeQueueItemId = track.id;
    room.playback = {
      revision: (room.playback?.revision ?? 0) + 1,
      videoId: track.videoId,
      musicUrl: track.musicUrl,
      title: track.title,
      isPlaying: true,
      positionSeconds: 0,
      updatedAtServerMs: this.now(),
    };
    return room.playback;
  }

  private requireRoom(code: string): Room {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new StoreError("ROOM_NOT_FOUND", "Oda bulunamadi.");
    return room;
  }

  private createParticipant(nickname: string, socketId: string): Participant {
    return {
      id: randomUUID(),
      reconnectToken: randomBytes(32).toString("base64url"),
      socketId,
      nickname,
      joinedAt: this.now(),
      disconnectedAt: null,
    };
  }

  private createUniqueCode(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = (this.codeGenerator?.() ?? this.randomCode()).toUpperCase();
      if (!this.rooms.has(code)) return code;
    }
    throw new StoreError("CODE_GENERATION_FAILED", "Oda kodu olusturulamadi.");
  }

  private randomCode(): string {
    let result = "";
    const bytes = randomBytes(this.roomCodeLength);
    for (const byte of bytes) {
      result += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
    }
    return result;
  }
}

export class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
