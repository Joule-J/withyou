export type PlaylistTrack = {
  id: string;
  title: string;
  videoId: string;
  musicUrl: string;
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
  const response = await fetch("/api/playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, musicUrls }),
  });
  if (!response.ok) throw new Error("PLAYLIST_SAVE_FAILED");
  const payload = (await response.json()) as { playlist: Playlist };
  return payload.playlist;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const response = await fetch(`/api/playlists/${playlistId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("PLAYLIST_DELETE_FAILED");
}
