# WithYou

WithYou is a small synchronized listening room for YouTube Music links. The server
shares playback metadata only; audio and video are loaded directly from YouTube in
each participant's browser.

## Requirements

- Node.js 20 or newer
- Chrome or Edge for manual testing

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies Socket.IO and `/health` to the backend
on port `3000`.

## Production build

```bash
npm run build
npm start
```

The Express server serves `web/dist` and Socket.IO from `http://localhost:3000`.

Environment variables:

```text
PORT=3000
ALLOWED_WEB_ORIGINS=http://localhost:5173,http://localhost:3000
WEB_DIST_DIR=../web/dist
ROOM_CAPACITY=10
RECONNECT_GRACE_MS=15000
ROOM_CODE_LENGTH=6
```

For Railway, deploy the repository root with one instance. Set
`ALLOWED_WEB_ORIGINS` to the public HTTPS origin.

## Manual browser test

1. Start the app with `npm run dev`.
2. Open the site in two separate Chrome profiles.
3. Create a room in the first profile and join its URL from the second.
4. As host, paste a link such as
   `https://music.youtube.com/watch?v=dQw4w9WgXcQ`.
5. Test play, pause, and seeking.
6. Join late or refresh a client to verify snapshot and reconnect behavior.
7. Close the host tab for more than 15 seconds and verify that the oldest
   connected participant becomes host.

Some browsers block playback before a user gesture. In that case use the
`Senkronizasyonu başlat` button shown above the controls.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run audit:prod
```
