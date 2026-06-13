type SavedSession = {
  roomCode: string;
  participantId: string;
  reconnectToken: string;
};

const PREFIX = "withyou:session:";

export function saveSession(session: SavedSession) {
  localStorage.setItem(`${PREFIX}${session.roomCode}`, JSON.stringify(session));
}

export function loadSession(roomCode: string): SavedSession | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${roomCode.toUpperCase()}`);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(roomCode: string) {
  localStorage.removeItem(`${PREFIX}${roomCode.toUpperCase()}`);
}
