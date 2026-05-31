export type LiveUserMessage = {
  id: string;
  role: 'user';
  text: string;
  sessionId: string;
  timestamp: string;
  isLiveTranscript?: boolean;
};

export type LiveUserTurn = {
  id: string;
  text: string;
  sessionId: string;
  timestamp: string;
};

export function normalizeTranscriptText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function mergeTranscriptText(previous: string, incoming: string) {
  const prev = normalizeTranscriptText(previous);
  const next = normalizeTranscriptText(incoming);

  if (!prev) return next;
  if (!next) return prev;
  if (next === prev) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  if (prev.endsWith(next)) return prev;

  return normalizeTranscriptText(`${prev} ${next}`);
}

export function createLiveUserTurn(sessionId: string): LiveUserTurn {
  return {
    id: `live-user-${sessionId}-${Date.now()}`,
    text: '',
    sessionId,
    timestamp: new Date().toISOString(),
  };
}

export function toLiveUserMessage(turn: LiveUserTurn): LiveUserMessage {
  return {
    id: turn.id,
    role: 'user',
    text: turn.text,
    sessionId: turn.sessionId,
    timestamp: turn.timestamp,
    isLiveTranscript: true,
  };
}
