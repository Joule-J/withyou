import { PrismaClient } from "@prisma/client";

export type PlaylistTrackRecord = {
  id: string;
  title: string;
  videoId: string;
  musicUrl: string;
  thumbnailUrl?: string;
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
    thumbnailUrl?: string;
  }>;
};

export interface PlaylistRepository {
  list(): Promise<PlaylistRecord[]>;
  save(input: PlaylistDraft): Promise<PlaylistRecord>;
  rename(playlistId: string, name: string): Promise<PlaylistRecord>;
  reorder(playlistId: string, orderedMusicUrls: string[]): Promise<PlaylistRecord>;
  replaceTracks(playlistId: string, tracks: PlaylistDraft["tracks"]): Promise<PlaylistRecord>;
  delete(playlistId: string): Promise<void>;
}

export function playlistPersistenceMode(env: NodeJS.ProcessEnv = process.env): "supabase-postgres" | "in-memory" {
  return env.DATABASE_URL ? "supabase-postgres" : "in-memory";
}

export class InMemoryPlaylistRepository implements PlaylistRepository {
  private playlists = new Map<string, PlaylistRecord>();

  async list(): Promise<PlaylistRecord[]> {
    return [...this.playlists.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(input: PlaylistDraft): Promise<PlaylistRecord> {
    const existing = [...this.playlists.values()].find((playlist) => samePlaylistName(playlist.name, input.name));
    if (existing) throw new Error("LIST_NAME_EXISTS");
    const next: PlaylistRecord = {
      id: `playlist-${Math.random().toString(36).slice(2, 10)}`,
      name: input.name,
      updatedAt: new Date().toISOString(),
      tracks: input.tracks.map((track, index) => ({
        id: `${input.name}-${index}`,
        title: track.title,
        videoId: track.videoId,
        musicUrl: track.musicUrl,
        thumbnailUrl: track.thumbnailUrl,
        position: index,
      })),
    };
    this.playlists.set(next.id, next);
    return next;
  }

  async rename(playlistId: string, name: string): Promise<PlaylistRecord> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) throw new Error("PLAYLIST_NOT_FOUND");
    const duplicate = [...this.playlists.values()].find(
      (item) => item.id !== playlistId && samePlaylistName(item.name, name),
    );
    if (duplicate) throw new Error("LIST_NAME_EXISTS");
    const next = { ...playlist, name };
    this.playlists.set(playlistId, next);
    return next;
  }

  async delete(playlistId: string): Promise<void> {
    this.playlists.delete(playlistId);
  }

  async replaceTracks(playlistId: string, tracks: PlaylistDraft["tracks"]): Promise<PlaylistRecord> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) throw new Error("PLAYLIST_NOT_FOUND");
    const next = {
      ...playlist,
      tracks: tracks.map((track, index) => ({
        id: `${playlistId}-${index}`,
        title: track.title,
        videoId: track.videoId,
        musicUrl: track.musicUrl,
        thumbnailUrl: track.thumbnailUrl,
        position: index,
      })),
    };
    this.playlists.set(playlistId, next);
    return next;
  }

  async reorder(playlistId: string, orderedMusicUrls: string[]): Promise<PlaylistRecord> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) throw new Error("PLAYLIST_NOT_FOUND");
    const byUrl = new Map(playlist.tracks.map((track) => [track.musicUrl, track]));
    if (orderedMusicUrls.length !== playlist.tracks.length) throw new Error("INVALID_PLAYLIST_ORDER");

    const tracks = orderedMusicUrls.map((musicUrl, index) => {
      const track = byUrl.get(musicUrl);
      if (!track) throw new Error("INVALID_PLAYLIST_ORDER");
      return { ...track, position: index };
    });

    const next = { ...playlist, updatedAt: new Date().toISOString(), tracks };
    this.playlists.set(playlistId, next);
    return next;
  }
}

export class PrismaPlaylistRepository implements PlaylistRepository {
  private cache: PlaylistRecord[] = [];

  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<PlaylistRecord[]> {
    if (this.cache.length > 0) {
      void this.refreshCache(true);
      return this.cache;
    }

    return this.refreshCache(false);
  }

  async save(input: PlaylistDraft): Promise<PlaylistRecord> {
    const playlist = await this.prisma.playlist.create({
      data: {
        name: input.name,
      },
    });

    await this.prisma.$transaction([
      this.prisma.playlistTrack.deleteMany({ where: { playlistId: playlist.id } }),
      this.prisma.playlistTrack.createMany({
        data: input.tracks.map((track, index) => ({
          playlistId: playlist.id,
          title: track.title,
          videoId: track.videoId,
          musicUrl: track.musicUrl,
          thumbnailUrl: track.thumbnailUrl,
          position: index,
        })),
      }),
    ]);

    const refreshed = await this.prisma.playlist.findUniqueOrThrow({
      where: { id: playlist.id },
      include: {
        tracks: {
          orderBy: { position: "asc" },
        },
      },
    });

    const record = this.toRecord(refreshed);
    this.cache = [record, ...this.cache.filter((item) => item.id !== record.id)];
    return record;
  }

  async rename(playlistId: string, name: string): Promise<PlaylistRecord> {
    const playlist = await this.prisma.playlist.update({
      where: { id: playlistId },
      data: { name },
      include: {
        tracks: {
          orderBy: { position: "asc" },
        },
      },
    });

    const record = this.toRecord(playlist);
    this.cache = this.cache.map((item) => (item.id === record.id ? record : item));
    return record;
  }

  async delete(playlistId: string): Promise<void> {
    await this.prisma.playlist.delete({ where: { id: playlistId } });
    this.cache = this.cache.filter((playlist) => playlist.id !== playlistId);
  }

  async replaceTracks(playlistId: string, tracks: PlaylistDraft["tracks"]): Promise<PlaylistRecord> {
    await this.prisma.$transaction([
      this.prisma.playlistTrack.deleteMany({ where: { playlistId } }),
      this.prisma.playlistTrack.createMany({
        data: tracks.map((track, index) => ({
          playlistId,
          title: track.title,
          videoId: track.videoId,
          musicUrl: track.musicUrl,
          thumbnailUrl: track.thumbnailUrl,
          position: index,
        })),
      }),
    ]);

    const refreshed = await this.prisma.playlist.findUniqueOrThrow({
      where: { id: playlistId },
      include: { tracks: { orderBy: { position: "asc" } } },
    });

    const record = this.toRecord(refreshed);
    this.cache = this.cache.map((item) => (item.id === record.id ? record : item));
    return record;
  }

  async reorder(playlistId: string, orderedMusicUrls: string[]): Promise<PlaylistRecord> {
    const playlist = await this.prisma.playlist.findUnique({
      where: { id: playlistId },
      include: { tracks: { orderBy: { position: "asc" } } },
    });
    if (!playlist) throw new Error("PLAYLIST_NOT_FOUND");
    if (orderedMusicUrls.length !== playlist.tracks.length) throw new Error("INVALID_PLAYLIST_ORDER");

    const byUrl = new Map(playlist.tracks.map((track) => [track.musicUrl, track]));
    const updatedTracks = orderedMusicUrls.map((musicUrl, index) => {
      const track = byUrl.get(musicUrl);
      if (!track) throw new Error("INVALID_PLAYLIST_ORDER");
      return { id: track.id, position: index };
    });

    await this.prisma.$transaction([
      ...updatedTracks.map((track, index) =>
        this.prisma.playlistTrack.update({
          where: { id: track.id },
          data: { position: -(index + 1) },
        }),
      ),
      ...updatedTracks.map((track) =>
        this.prisma.playlistTrack.update({
          where: { id: track.id },
          data: { position: track.position },
        }),
      ),
      this.prisma.playlist.update({
        where: { id: playlistId },
        data: { updatedAt: new Date() },
      }),
    ]);

    const refreshed = await this.prisma.playlist.findUniqueOrThrow({
      where: { id: playlistId },
      include: { tracks: { orderBy: { position: "asc" } } },
    });

    const record = this.toRecord(refreshed);
    this.cache = [record, ...this.cache.filter((item) => item.id !== record.id)];
    return record;
  }

  private async refreshCache(allowFallback: boolean): Promise<PlaylistRecord[]> {
    const mappedPromise = this.prisma.playlist
      .findMany({
        include: {
          tracks: {
            orderBy: { position: "asc" },
          },
        },
        orderBy: { updatedAt: "desc" },
      })
      .then((playlists) => playlists.map((playlist) => this.toRecord(playlist)));

    this.cache = allowFallback ? await withTimeout(mappedPromise, 800, this.cache) : await mappedPromise;
    return this.cache;
  }

  private toRecord(playlist: {
    id: string;
    name: string;
    updatedAt: Date;
    tracks: Array<{
      id: string;
      title: string;
      videoId: string;
      musicUrl: string;
      thumbnailUrl: string | null;
      position: number;
    }>;
  }): PlaylistRecord {
    return {
      id: playlist.id,
      name: playlist.name,
      updatedAt: playlist.updatedAt.toISOString(),
      tracks: playlist.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        videoId: track.videoId,
        musicUrl: track.musicUrl,
        thumbnailUrl: track.thumbnailUrl ?? undefined,
        position: track.position,
      })),
    };
  }
}

function samePlaylistName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("tr") === b.trim().toLocaleLowerCase("tr");
}

let prismaClient: PrismaClient | null = null;

export function createPlaylistRepository(env: NodeJS.ProcessEnv = process.env): PlaylistRepository {
  if (playlistPersistenceMode(env) === "in-memory") {
    return new InMemoryPlaylistRepository();
  }

  prismaClient ??= new PrismaClient();
  return new PrismaPlaylistRepository(prismaClient);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
