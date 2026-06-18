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
import { fallbackThumbnailUrl, resolveTrackMetadata, type TrackMetadata } from "./track-metadata.js";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type StoreOptions = {
  roomCapacity: number;
  roomCodeLength: number;
  now?: () => number;
  codeGenerator?: () => string;
  resolveTrackTitle?: (videoId: string) => Promise<string | null>;
  resolveTrackMetadata?: (videoId: string) => Promise<TrackMetadata>;
};

export class RoomStore {
  readonly rooms = new Map<string, Room>();
  private readonly roomCapacity: number;
  private readonly roomCodeLength: number;
  private readonly now: () => number;
  private readonly codeGenerator?: () => string;
  private readonly metadataResolver: (videoId: string) => Promise<TrackMetadata>;

  constructor(options: StoreOptions) {
    this.roomCapacity = options.roomCapacity;
    this.roomCodeLength = options.roomCodeLength;
    this.now = options.now ?? Date.now;
    this.codeGenerator = options.codeGenerator;
    this.metadataResolver =
      options.resolveTrackMetadata ??
      (options.resolveTrackTitle
        ? async (videoId) => ({
            title: await options.resolveTrackTitle?.(videoId) ?? null,
            thumbnailUrl: fallbackThumbnailUrl(videoId),
          })
        : resolveTrackMetadata);
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

  transferHost(code: string, currentHostId: string, targetParticipantId: string) {
    const room = this.requireRoom(code);
    this.requireHost(room, currentHostId);
    const target = this.requireParticipant(room, targetParticipantId);
    if (target.id === currentHostId) {
      throw new StoreError("INVALID_HOST_TRANSFER", "Secilen katilimci zaten host.");
    }
    if (target.socketId === null) {
      throw new StoreError("TARGET_NOT_CONNECTED", "Hostluk yalnizca bagli bir katilimciya verilebilir.");
    }

    room.hostParticipantId = target.id;
    return { room, newHostId: target.id };
  }

  async applyPlayerCommand(code: string, participantId: string, command: PlayerCommand): Promise<PlaybackState> {
    const room = this.requireRoom(code);
    if (room.hostParticipantId !== participantId) {
      throw new StoreError("HOST_ONLY", "Bu islemi yalnizca host yapabilir.");
    }

    const parsedUrl = parseMusicUrl(command.musicUrl);
    if (!parsedUrl || parsedUrl.videoId !== command.videoId) {
      throw new StoreError("INVALID_MUSIC_URL", "Gecersiz YouTube Music adresi.");
    }

    const metadata = await this.resolveMetadata(parsedUrl.videoId, command.title);
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
      title: metadata.title,
      thumbnailUrl: metadata.thumbnailUrl,
      isPlaying,
      positionSeconds: command.positionSeconds,
      updatedAtServerMs: this.now(),
    };
    if (command.type === "change_track") {
      room.activeQueueItemId =
        room.queue.find((track) => track.videoId === parsedUrl.videoId && track.musicUrl === parsedUrl.normalizedUrl)?.id ??
        null;
    }
    return room.playback;
  }

  async addQueueTracks(code: string, participantId: string, musicUrls: string[], insertAfterId?: string): Promise<void> {
    const room = this.requireRoom(code);
    const participant = this.requireParticipant(room, participantId);
    const tracks = await Promise.all(musicUrls.map(async (musicUrl): Promise<QueueTrack> => {
      const parsed = parseMusicUrl(musicUrl);
      if (!parsed) throw new StoreError("INVALID_MUSIC_URL", "Gecersiz YouTube Music adresi.");
      const metadata = await this.resolveMetadata(parsed.videoId);
      return {
        id: randomUUID(),
        videoId: parsed.videoId,
        musicUrl: parsed.normalizedUrl,
        title: metadata.title,
        thumbnailUrl: metadata.thumbnailUrl,
        addedByParticipantId: participant.id,
        addedByName: participant.nickname,
        addedAt: this.now(),
      };
    }));

    if (insertAfterId) {
      const index = room.queue.findIndex((t) => t.id === insertAfterId);
      if (index !== -1) {
        room.queue.splice(index + 1, 0, ...tracks);
        return;
      }
    }

    room.queue.push(...tracks);
  }

  async replaceQueueTracks(code: string, participantId: string, musicUrls: string[]): Promise<PlaybackState | null> {
    const room = this.requireRoom(code);
    this.requireHost(room, participantId);
    room.queue = [];
    room.activeQueueItemId = null;
    await this.addQueueTracks(code, participantId, musicUrls);
    return room.queue.length > 0 ? this.playQueueTrack(room, room.queue[0]) : null;
  }

  reorderQueue(code: string, participantId: string, orderedTrackIds: string[]): void {
    const room = this.requireRoom(code);
    this.requireHost(room, participantId);
    if (orderedTrackIds.length !== room.queue.length) {
      throw new StoreError("INVALID_QUEUE_ORDER", "Sira bilgisi eksik.");
    }

    const byId = new Map(room.queue.map((track) => [track.id, track]));
    const reordered = orderedTrackIds.map((trackId) => {
      const track = byId.get(trackId);
      if (!track) {
        throw new StoreError("INVALID_QUEUE_ORDER", "Sira bilgisi gecersiz.");
      }
      return track;
    });

    if (new Set(reordered.map((track) => track.id)).size !== room.queue.length) {
      throw new StoreError("INVALID_QUEUE_ORDER", "Sira bilgisi tekrarlaniyor.");
    }

    room.queue = reordered;
  }

  advanceQueue(code: string, participantId: string): PlaybackState | null {
    const room = this.requireRoom(code);
    this.requireHost(room, participantId);
    if (room.queue.length === 0) return null;

    const currentIndex = room.queue.findIndex((track) => track.id === room.activeQueueItemId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % room.queue.length : 0;
    return this.playQueueTrack(room, room.queue[nextIndex]);
  }

  previousQueue(code: string, participantId: string): PlaybackState | null {
    const room = this.requireRoom(code);
    this.requireHost(room, participantId);
    if (room.queue.length === 0) return null;

    const currentIndex = room.queue.findIndex((track) => track.id === room.activeQueueItemId);
    const previousIndex =
      currentIndex >= 0
        ? (currentIndex - 1 + room.queue.length) % room.queue.length
        : Math.max(0, room.queue.length - 1);
    return this.playQueueTrack(room, room.queue[previousIndex]);
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
        thumbnailUrl: track.thumbnailUrl,
        addedByName: track.addedByName,
      })),
      activeQueueItemId: room.activeQueueItemId,
    };
  }

  private requireHost(room: Room, participantId: string): Participant {
    if (room.hostParticipantId !== participantId) {
      throw new StoreError("HOST_ONLY", "Bu islemi yalnizca host yapabilir.");
    }
    return this.requireParticipant(room, participantId);
  }

  private requireParticipant(room: Room, participantId: string): Participant {
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
      thumbnailUrl: track.thumbnailUrl,
      isPlaying: true,
      positionSeconds: 0,
      updatedAtServerMs: this.now(),
    };
    return room.playback;
  }

  private async resolveMetadata(videoId: string, fallback?: string): Promise<{ title: string; thumbnailUrl: string }> {
    const resolved = await this.metadataResolver(videoId);
    return {
      title: resolved.title ?? fallback?.trim() ?? videoId,
      thumbnailUrl: resolved.thumbnailUrl || fallbackThumbnailUrl(videoId),
    };
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
