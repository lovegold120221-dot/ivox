# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Development
- `npm run dev` - Start the Vite frontend development server (port 3000, binds 0.0.0.0)
- `npm run dev:api` - Start the Express backend API server
- `npm run dev:full` - Start both frontend and backend concurrently
- `npm run build` - Production build via Vite

### Quality & Maintenance
- `npm run lint` - Run type-checking using `tsc --noEmit`
- `npm run clean` - Remove the `dist` directory

## Architecture & Project Structure

### High-Level Overview
Eburon AI Beatrice is a real-time voice AI assistant utilizing the Gemini Live API for natural audio interaction, Firebase for authentication and messaging, and Supabase for user settings and knowledge base persistence.

### Core Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Motion, Lucide-react.
- **AI Layer**: Gemini Live API (`gemini-2.5-flash-native-audio-preview`) via `@google/genai` SDK.
- **Authentication**: Firebase Auth (Google Sign-In).
- **Data Persistence**:
    - **Firestore**: Primary store for conversation messages.
    - **Supabase**: User settings, knowledge base metadata (`knowledge_files` table), and storage buckets (`avatars`, `knowledge-base`).
    - **LocalStorage**: Local fallback cache for settings and domains.
- **Backend**: Express.js server managing WhatsApp sessions (via Baileys for Linked Devices and official Cloud API for Business accounts).

### Key Directory Structure
- `src/` - Frontend React source code.
    - `App.tsx` - The central coordinator for the application.
    - `components/` - UI components (e.g., `VideoPage`, `ComputerPage`, `ProfilePage`, `KaraokeTranscript`).
    - `lib/` - Core utilities, including `audio.ts` (AudioStreamer/Recorder), `supabase.ts`, and `firebase.ts`.
- `server/` - Node.js backend source.
    - `index.ts` - Main Express server entry point.
- `functions/` - Firebase Cloud Functions.
- `public/` - Static assets and HTML templates used by the AI for document generation.

### Critical Workflows
- **Audio Pipeline**: Uses `AudioRecorder` for mic capture and `AudioStreamer` for TTS playback, feeding into the Gemini Live API.
- **Tool Execution**: Gemini triggers tool calls (Google Calendar, Gmail, etc.) which are executed by the frontend after user confirmation.
- **WhatsApp Integration**: Uses isolated authentication directories per user under `WA_AUTH_ROOT` on the server to support multiple concurrent sessions.
- **Document Generation**: The AI generates self-contained HTML documents based on templates in `public/`, which are rendered directly in the `ComputerPage`.
