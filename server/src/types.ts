export type PlayerCommandType = "play" | "pause" | "seek" | "change_track";

export type PlaybackState = {
  revision: number;
  videoId: string;
  musicUrl: string;
  title?: string;
  thumbnailUrl?: string;
  isPlaying: boolean;
  positionSeconds: number;
  updatedAtServerMs: number;
};

export type Participant = {
  id: string;
  reconnectToken: string;
  socketId: string | null;
  nickname: string;
  joinedAt: number;
  disconnectedAt: number | null;
};

export type Room = {
  code: string;
  createdAt: number;
  hostParticipantId: string;
  participants: Map<string, Participant>;
  playback: PlaybackState | null;
  queue: QueueTrack[];
  activeQueueItemId: string | null;
};

export type PublicParticipant = {
  id: string;
  nickname: string;
  isHost: boolean;
  isConnected: boolean;
};

export type RoomSnapshot = {
  roomCode: string;
  hostParticipantId: string;
  participants: PublicParticipant[];
  playback: PlaybackState | null;
  queue: QueueTrackView[];
  activeQueueItemId: string | null;
};

export type PlayerCommand = {
  type: PlayerCommandType;
  videoId: string;
  musicUrl: string;
  title?: string;
  positionSeconds: number;
  clientCommandId: string;
  isPlaying?: boolean;
};

export type QueueTrack = {
  id: string;
  videoId: string;
  musicUrl: string;
  title?: string;
  thumbnailUrl?: string;
  addedByParticipantId: string;
  addedByName: string;
  addedAt: number;
};

export type QueueTrackView = {
  id: string;
  videoId: string;
  musicUrl: string;
  title?: string;
  thumbnailUrl?: string;
  addedByName: string;
};

export type QueueReorderInput = {
  orderedTrackIds: string[];
};
