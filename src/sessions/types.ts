export interface SessionInfo {
  sessionId: string;
  chatId: string;
  createdAt: Date;
  summary?: string;
}

export interface ChatState {
  activeSessionId: string | null;
  sessions: Map<string, SessionInfo>;
}
