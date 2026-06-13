import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const OWNER_KEY_STORAGE = "withyou.saved-tracks.owner-key";
const LOCAL_TRACKS_STORAGE = "withyou.saved-tracks.local";

export type SavedTrack = {
  id: string;
  title: string;
  videoId: string;
  musicUrl: string;
  createdAt: string;
};

type SavedTrackRow = {
  id: string;
  owner_key: string;
  title: string;
  video_id: string;
  music_url: string;
  created_at: string;
};

let supabaseClient: SupabaseClient | null | undefined;

export function getSavedTracksOwnerKey(): string {
  const existing = window.localStorage.getItem(OWNER_KEY_STORAGE);
  if (existing) return existing;

  const created = crypto.randomUUID();
  window.localStorage.setItem(OWNER_KEY_STORAGE, created);
  return created;
}

export async function listSavedTracks(ownerKey: string): Promise<SavedTrack[]> {
  const client = getSupabaseClient();
  if (!client) return readLocalTracks();

  const { data, error } = await client
    .from("saved_tracks")
    .select("id, owner_key, title, video_id, music_url, created_at")
    .eq("owner_key", ownerKey)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRowToTrack);
}

export async function saveTrack(ownerKey: string, track: Omit<SavedTrack, "id" | "createdAt">): Promise<SavedTrack> {
  const client = getSupabaseClient();
  if (!client) {
    return saveTrackLocally(track);
  }

  const { data, error } = await client
    .from("saved_tracks")
    .upsert(
      {
        owner_key: ownerKey,
        title: track.title,
        video_id: track.videoId,
        music_url: track.musicUrl,
      },
      { onConflict: "owner_key,video_id" },
    )
    .select("id, owner_key, title, video_id, music_url, created_at")
    .single();

  if (error) throw error;
  return mapRowToTrack(data);
}

export async function deleteTrack(ownerKey: string, savedTrackId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    writeLocalTracks(readLocalTracks().filter((track) => track.id !== savedTrackId));
    return;
  }

  const { error } = await client.from("saved_tracks").delete().eq("owner_key", ownerKey).eq("id", savedTrackId);
  if (error) throw error;
}

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient !== undefined) return supabaseClient;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    supabaseClient = null;
    return supabaseClient;
  }

  supabaseClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

function mapRowToTrack(row: SavedTrackRow): SavedTrack {
  return {
    id: row.id,
    title: row.title,
    videoId: row.video_id,
    musicUrl: row.music_url,
    createdAt: row.created_at,
  };
}

function readLocalTracks(): SavedTrack[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_TRACKS_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTrack[];
    return parsed
      .filter((track) => track.id && track.title && track.videoId && track.musicUrl && track.createdAt)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

function writeLocalTracks(tracks: SavedTrack[]) {
  window.localStorage.setItem(LOCAL_TRACKS_STORAGE, JSON.stringify(tracks));
}

function saveTrackLocally(track: Omit<SavedTrack, "id" | "createdAt">): SavedTrack {
  const existing = readLocalTracks();
  const match = existing.find((entry) => entry.videoId === track.videoId);
  const saved: SavedTrack = {
    id: match?.id ?? crypto.randomUUID(),
    title: track.title,
    videoId: track.videoId,
    musicUrl: track.musicUrl,
    createdAt: match?.createdAt ?? new Date().toISOString(),
  };

  writeLocalTracks([saved, ...existing.filter((entry) => entry.videoId !== track.videoId)]);
  return saved;
}
