import { PrismaClient } from "@prisma/client";

export type PlaylistTrackRecord = {
  id: string;
  title: string;
  videoId: string;
  musicUrl: string;
  position: number;
};

export type PlaylistRecord = {
  id: string;
  name: string;
  tracks: PlaylistTrackRecord[];
  updatedAt: string;
};

export type PlaylistDraft = {
  name: string;
  tracks: Array<{
    title: string;
    videoId: string;
    musicUrl: string;
  }>;
};

export interface PlaylistRepository {
  list(): Promise<PlaylistRecord[]>;
  save(input: PlaylistDraft): Promise<PlaylistRecord>;
  delete(playlistId: string): Promise<void>;
}

export class InMemoryPlaylistRepository implements PlaylistRepository {
  private playlists = new Map<string, PlaylistRecord>();

  async list(): Promise<PlaylistRecord[]> {
    return [...this.playlists.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(input: PlaylistDraft): Promise<PlaylistRecord> {
    const existing = [...this.playlists.values()].find((playlist) => playlist.name === input.name);
    const next: PlaylistRecord = {
      id: existing?.id ?? `playlist-${Math.random().toString(36).slice(2, 10)}`,
      name: input.name,
      updatedAt: new Date().toISOString(),
      tracks: input.tracks.map((track, index) => ({
        id: `${existing?.id ?? input.name}-${index}`,
        title: track.title,
        videoId: track.videoId,
        musicUrl: track.musicUrl,
        position: index,
      })),
    };
    this.playlists.set(next.id, next);
    return next;
  }

  async delete(playlistId: string): Promise<void> {
    this.playlists.delete(playlistId);
  }
}

export class PrismaPlaylistRepository implements PlaylistRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<PlaylistRecord[]> {
    const playlists = await this.prisma.playlist.findMany({
      include: {
        tracks: {
          orderBy: { position: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      updatedAt: playlist.updatedAt.toISOString(),
      tracks: playlist.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        videoId: track.videoId,
        musicUrl: track.musicUrl,
        position: track.position,
      })),
    }));
  }

  async save(input: PlaylistDraft): Promise<PlaylistRecord> {
    const playlist = await this.prisma.playlist.upsert({
      where: { name: input.name },
      update: {
        tracks: {
          deleteMany: {},
          create: input.tracks.map((track, index) => ({
            title: track.title,
            videoId: track.videoId,
            musicUrl: track.musicUrl,
            position: index,
          })),
        },
      },
      create: {
        name: input.name,
        tracks: {
          create: input.tracks.map((track, index) => ({
            title: track.title,
            videoId: track.videoId,
            musicUrl: track.musicUrl,
            position: index,
          })),
        },
      },
      include: {
        tracks: {
          orderBy: { position: "asc" },
        },
      },
    });

    return {
      id: playlist.id,
      name: playlist.name,
      updatedAt: playlist.updatedAt.toISOString(),
      tracks: playlist.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        videoId: track.videoId,
        musicUrl: track.musicUrl,
        position: track.position,
      })),
    };
  }

  async delete(playlistId: string): Promise<void> {
    await this.prisma.playlist.delete({ where: { id: playlistId } });
  }
}

let prismaClient: PrismaClient | null = null;

export function createPlaylistRepository(env: NodeJS.ProcessEnv = process.env): PlaylistRepository {
  if (!env.DATABASE_URL) {
    return new InMemoryPlaylistRepository();
  }

  prismaClient ??= new PrismaClient();
  return new PrismaPlaylistRepository(prismaClient);
}
