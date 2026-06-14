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
  type: "play" | "pause" | "seek" | "change_track";
  videoId: string;
  musicUrl: string;
  title?: string;
  positionSeconds: number;
  clientCommandId: string;
  isPlaying?: boolean;
};

export type QueueTrackView = {
  id: string;
  videoId: string;
  musicUrl: string;
  title?: string;
  thumbnailUrl?: string;
  addedByName: string;
};
