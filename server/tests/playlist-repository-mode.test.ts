import { describe, expect, it } from "vitest";
import { playlistPersistenceMode } from "../src/playlist-repository.js";

describe("playlistPersistenceMode", () => {
  it("reports supabase-postgres when DATABASE_URL exists", () => {
    expect(playlistPersistenceMode({ DATABASE_URL: "postgresql://example" } as NodeJS.ProcessEnv)).toBe(
      "supabase-postgres",
    );
  });

  it("reports in-memory when DATABASE_URL is missing", () => {
    expect(playlistPersistenceMode({} as NodeJS.ProcessEnv)).toBe("in-memory");
  });
});
