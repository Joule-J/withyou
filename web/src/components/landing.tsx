import { useState, type FormEvent } from "react";

type Props = {
  initialRoomCode: string;
  connected: boolean;
  error: string | null;
  onCreate: (nickname: string) => void;
  onJoin: (roomCode: string, nickname: string) => void;
};

export function Landing({ initialRoomCode, connected, error, onCreate, onJoin }: Props) {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");

  const validNickname = nickname.trim().length >= 2 && nickname.trim().length <= 24;
  const validRoomCode = /^[A-Z0-9]{6}$/.test(roomCode.trim().toUpperCase());

  function createRoom(event: FormEvent) {
    event.preventDefault();
    if (validNickname && connected) onCreate(nickname.trim());
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    if (validNickname && validRoomCode && connected) {
      onJoin(roomCode.trim().toUpperCase(), nickname.trim());
    }
  }

  return (
    <main className="landing-shell">
      <section className="hero">
        <p className="eyebrow">WITHYOU</p>
        <div className="hero-logo-lockup">
          <img src="/love.png" alt="" aria-hidden="true" />
          <h1>WithYou</h1>
        </div>
        <p className="hero-copy">
          Aynı parçayı aynı anda dinlemek için oda aç, YouTube Music bağlantısını ekle ve arkadaşlarınla senkron kal.
        </p>
      </section>

      <div className="join-stack">
        <section className="join-card">
          <label htmlFor="nickname">Takma adın</label>
          <input
            id="nickname"
            value={nickname}
            maxLength={24}
            placeholder="Örn. Inan"
            onChange={(event) => setNickname(event.target.value)}
          />

          <form onSubmit={createRoom}>
            <button className="primary-button" disabled={!validNickname || !connected} type="submit">
              Yeni oda oluştur
            </button>
          </form>

          <div className="divider"><span>veya</span></div>

          <form className="join-form" onSubmit={joinRoom}>
            <label htmlFor="room-code">Oda kodu</label>
            <input
              id="room-code"
              value={roomCode}
              maxLength={6}
              placeholder="AB7K2M"
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            />
            <button disabled={!validNickname || !validRoomCode || !connected} type="submit">
              Odaya katıl
            </button>
          </form>
        </section>

        {error ? (
          <p className="landing-notice error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
