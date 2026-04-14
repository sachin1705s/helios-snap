# Helios Snap

A fresh React + Vite rebuild of the app around the documented Reactor JavaScript SDK `2.9.0` flow.

What this version does:

- loads a Reactor API key from `.env.local` or a browser override
- fetches a Reactor session token from `https://api.reactor.inc/tokens`
- connects to the `helios` model with `ReactorProvider`
- lets you capture a camera snapshot or upload an image
- sends the full selected image as `image_b64`
- sends `set_image`, `set_prompt`, and `start`
- shows model messages, WebRTC stats, and basic playback controls

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file:

```bash
cp .env.local.example .env.local
```

3. Add your Reactor API key:

```env
VITE_REACTOR_API_KEY=rk_your_api_key_here
```

4. Start the app:

```bash
npm run dev -- --host 0.0.0.0
```

## Notes

- This rebuild keeps the `2.9.0` SDK and currently sends the selected image directly as `image_b64` without extra compression so the raw image path can be tested in isolation.
- The app mints tokens directly from the browser for local testing. For production, move key handling server-side.
- If you previously had a Gemini-based flow in this project, that is intentionally not part of this rebuild. This version is a Reactor-first Helios playground.
