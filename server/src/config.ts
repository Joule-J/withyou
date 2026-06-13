export type Config = {
  port: number;
  roomCapacity: number;
  reconnectGraceMs: number;
  roomCodeLength: number;
  allowedOrigins: string[];
  webDistDir: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: readPositiveNumber(env.PORT, 3000),
    roomCapacity: readPositiveNumber(env.ROOM_CAPACITY, 10),
    reconnectGraceMs: readPositiveNumber(env.RECONNECT_GRACE_MS, 15_000),
    roomCodeLength: readPositiveNumber(env.ROOM_CODE_LENGTH, 6),
    allowedOrigins: (env.ALLOWED_WEB_ORIGINS ?? "http://localhost:5173,http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    webDistDir: env.WEB_DIST_DIR ?? "../web/dist",
  };
}

function readPositiveNumber(rawValue: string | undefined, fallback: number): number {
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function originAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  return allowedOrigins.some((pattern) => {
    if (pattern.endsWith("*")) return origin.startsWith(pattern.slice(0, -1));
    return pattern === origin;
  });
}
