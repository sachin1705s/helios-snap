# Helios Console (Reactor)

A local React + Vite app to connect to the Reactor Helios model, stream video in real time, and control prompts on chunk boundaries.

## Requirements

- Node.js 18+
- Reactor API key

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` in the project root:

```bash
cp .env.local.example .env.local
```

3. Add your API key:

```
VITE_REACTOR_API_KEY=rk_your_api_key_here
```

4. Start the dev server:

```bash
npm run dev
```

Open the printed local URL in your browser.

## Notes

- The app uses `fetchInsecureJwtToken` on the client. For production, fetch tokens server-side.
- Helios runs in 33-frame chunks. Prompt changes apply at the next chunk boundary.
