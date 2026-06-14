export type PlaylistTrack = {
  id: string;
  title: string;
  videoId: string;
  musicUrl: string;
  thumbnailUrl?: string;
  position: number;
};

export type Playlist = {
  id: string;
  name: string;
  updatedAt: string;
  tracks: PlaylistTrack[];
};

export async function listPlaylists(): Promise<Playlist[]> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 900);
  const response = await fetch("/api/playlists", { signal: controller.signal }).finally(() => {
    window.clearTimeout(timeout);
  });
  if (!response.ok) throw new Error("PLAYLISTS_FETCH_FAILED");
  const payload = (await response.json()) as { playlists: Playlist[] };
  return payload.playlists;
}

export async function savePlaylist(name: string, musicUrls: string[]): Promise<Playlist> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, musicUrls }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("PLAYLIST_SAVE_FAILED");
    const payload = (await response.json()) as { playlist: Playlist };
    return payload.playlist;
  } catch (error: unknown) {
    if ((error as Error)?.name === "AbortError") throw new Error("PLAYLIST_SAVE_TIMEOUT");
    throw new Error(((error as Error)?.message ?? "PLAYLIST_SAVE_FAILED") as string);
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const response = await fetch(`/api/playlists/${playlistId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("PLAYLIST_DELETE_FAILED");
}

export async function reorderPlaylist(playlistId: string, musicUrls: string[]): Promise<Playlist> {
  const response = await fetch(`/api/playlists/${playlistId}/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ musicUrls }),
  });
  if (!response.ok) throw new Error("PLAYLIST_REORDER_FAILED");
  const payload = (await response.json()) as { playlist: Playlist };
  return payload.playlist;
}
