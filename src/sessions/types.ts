/** Metadata about a single Copilot session tied to a chat. */
export interface SessionInfo {
  sessionId: string;
  chatId: string;
  createdAt: Date;
  summary?: string;
}

/** Per-chat state for tracking active and historical sessions. */
export interface ChatState {
  activeSessionId: string | null;
  sessions: Map<string, SessionInfo>;
}
