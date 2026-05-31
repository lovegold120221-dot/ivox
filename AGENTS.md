# AGENTS.md

## Commands

```bash
npm run dev      # Start dev server on port 3000, binds 0.0.0.0
npm run build    # Production build via Vite
npm run lint     # Typecheck only (tsc --noEmit) — no ESLint, no Prettier
```

There is no test framework, no CI, and no pre-commit hooks.

## Environment

- `.env.local` holds all secrets. It is gitignored but an example is at `.env.example`.
- `GEMINI_API_KEY` is injected as `process.env.GEMINI_API_KEY` (not `VITE_`-prefixed) via `vite.config.ts` `define`. Do not rename this key.
- Firebase config (`VITE_FIREBASE_*`), Google OAuth (`VITE_GOOGLE_CLIENT_ID`), and Supabase URL/key are all `VITE_`-prefixed env vars.
- `DISABLE_HMR=true` disables HMR (used in AI Studio to prevent flickering during agent edits). Keep this check in `vite.config.ts`.
- `APP_URL` is injected by AI Studio at runtime for Cloud Run deployments. Do not hardcode a base URL.
- `VITE_SANDBOX_URL` points to the backend server (default `http://localhost:4200`).
- Server-only vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SANDBOX_PORT`, `SANDBOX_ROOT`, `WA_AUTH_ROOT`, `WA_LOG_LEVEL`) are read by `server/index.ts` via `dotenv/config`.

## Architecture

Single-package Vite + React 19 + TypeScript app + optional Express backend (server/). Firebase handles auth and data, Gemini Live API handles the AI voice pipeline. The backend server provides WhatsApp integration (Baileys + Cloud API) and web glance API; run separately with `npx tsx server/index.ts`.

**Entry point:** `index.html` → `src/main.tsx` → `src/App.tsx`

**`src/App.tsx`** (~200 lines) is the slim orchestrator: auth state, Firebase init, user routing (EntryFlow → AuthPage or BeatriceAgent). All business logic is extracted to separate modules.

**Key source files:**

| File | Purpose |
| --- | --- |
| `src/App.tsx` | Root orchestrator: auth state, user routing |
| `src/constants.ts` | Shared constants (`LANGUAGES` array) |
| `src/components/BeatriceAgent.tsx` | Main AI voice agent: Gemini Live session, audio pipeline, tool calling, settings panel, camera feed, document generation |
| `src/components/AuthPage.tsx` | Auth UI: sign in / register / reset password forms, Google OAuth trigger via props |
| `src/components/EntryFlow.tsx` | Splash → Onboarding flow + `isGoogleLinked` helper |
| `src/firebase.ts` | Firebase init + `handleFirestoreError()` helper |
| `src/lib/audio.ts` | `AudioStreamer` (TTS playback) and `AudioRecorder` (mic capture) |
| `src/components/UnifiedTranscript.tsx` | Animated word-by-word transcript |
| `src/index.css` | Single `@import "tailwindcss";` line (Tailwind v4) |
| `vite.config.ts` | Path alias `@` → `.`, Tailwind v4 plugin, env injection |
| `src/components/WhatsAppSettings.tsx` | WhatsApp pairing UI, permission toggles, Firestore sync |
| `src/lib/whatsappClient.ts` | WhatsApp backend API client (pair, send, status, contacts) |
| `src/lib/audio.ts` | `AudioStreamer` (TTS playback) and `AudioRecorder` (mic capture) |
| `src/lib/supabase.ts` | Supabase client setup + error handling |
| `src/lib/supabaseStorage.ts` | Avatar + knowledge file upload/list/delete to Supabase Storage |
| `src/firebase.ts` | Firebase init + `handleFirestoreError()` helper |
| `server/index.ts` | Express backend: WhatsApp + web glance + health API routes |
| `server/whatsapp.ts` | WhatsAppManager: Baileys / Cloud API session lifecycle |
| `server/whatsapp-tools.ts` | Permission-gated WhatsApp tool handlers |

## Firebase + Firestore

- Config lives in `firebase-applet-config.json` (not `.env`).
- Firestore blueprint: `firebase-blueprint.json` defines `User` and `Message` schemas.
- **Messages are immutable** — `allow update, delete: if false` in `firestore.rules`. Never attempt to edit or delete messages.
- Every Firestore operation must use `handleFirestoreError()` from `src/firebase.ts` for structured error logging (includes auth context).
- Security invariants in `security_spec.md` must be preserved: user data isolation, timestamp validation (`== request.time`), role constrained to `user`/`model`, field validation by whitelist, length limits (`personaName` ≤ 50, `customPrompt` ≤ 2000, `message.text` ≤ 5000, document ID ≤ 128 chars matching `^[a-zA-Z0-9_\-]+$`).

## Gemini Live API

- SDK: `@google/genai` (`^1.29.0`), model: `gemini-2.5-flash-native-audio-preview-09-2025`.
- Audio modalities are used for real-time bidirectional voice; tool calls (`functionCall` in `onmessage` callback) drive WhatsApp, Google Services (Gmail, Calendar, Tasks, Contacts), web search, document generation, camera, and phone dialing.
- 17 tools declared. Execution is a single switch statement inside the `onmessage` closure.
- The voice personality prompt (`VOICE_PERSONALITY_PROMPT`) is a ~350-line constant in `src/components/BeatriceAgent.tsx`. Do not alter it casually — it defines the entire agent persona.
- Permissions (10 boolean toggles, all default `false`) are injected into the system instruction at session start. Changes require session reconnect.
- Document generation uses a separate non-voice Gemini session (`gemini-2.5-flash`, non-streaming).
- Audio output is PCM16 mono 24kHz, streamed via `AudioStreamer` (decode → queue → schedule → play).

## UI / Styling

- Tailwind CSS v4 via `@tailwindcss/vite` plugin — uses `@import "tailwindcss"` syntax, no `tailwind.config.*`.
- Animation library: `motion` (formerly framer-motion), imported as `motion/react`.
- Icons: `lucide-react`.
- Markdown rendering: `react-markdown` for chat messages.
- Dark theme: `#050505` background, amber/warm peach (`#d0a78b`) accent.

## Reference UI

`public/reference-ui.html` contains the canonical landing page design with the orb animation, blob drift keyframes, peach glow, transcription area, and bottom nav. Use this as the design source of truth for UI changes.

## File to ignore

`temp.txt` is scrap data (Gemini SDK type definitions). Do not reference, import, or modify it.
