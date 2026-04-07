import { CopilotClient, approveAll } from "@github/copilot-sdk";
import type { Config } from "../config.js";
import type { MessagingChannel } from "../channels/types.js";
import type { SessionInfo, ChatState } from "./types.js";

const CROSS_SESSION_CONTEXT =
  "You are in a multi-session environment. Other sessions " +
  "(including scheduled task sessions prefixed with 'cron-') may contain " +
  "relevant context. If the user references work from another session or " +
  "a scheduled task, use session store queries (sql tool with database " +
  "'session_store') to search across sessions for the needed information.";

type CopilotSession = Awaited<ReturnType<CopilotClient["createSession"]>>;
type CopilotSendOptions = Parameters<CopilotSession["send"]>[0];
export type CopilotAttachments =
  CopilotSendOptions extends { attachments?: infer T } ? NonNullable<T> : never;

/** Manages Copilot sessions for a single messaging channel. */
export class SessionManager {
  private client: CopilotClient | null = null;
  private readonly chats = new Map<string, ChatState>();
  private readonly sessionMap = new Map<string, CopilotSession>();
  private readonly config: Config;
  private readonly channel: MessagingChannel;
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private sendLocks = new Map<string, Promise<void>>();
  private readonly attachedSessions = new Set<string>();

  constructor(config: Config, channel: MessagingChannel) {
    this.config = config;
    this.channel = channel;
  }

  /** Start the Copilot client for this channel. */
  async start(): Promise<void> {
    const opts: ConstructorParameters<typeof CopilotClient>[0] = {};

    if (this.config.cliUrl) {
      opts.cliUrl = this.config.cliUrl;
    }
    if (this.config.cliPort) {
      opts.port = this.config.cliPort;
    }

    this.client = new CopilotClient(opts);
    await this.client.start();
    console.log("[session-manager] CopilotClient started");
  }

  /** Stop the Copilot client and clear tracked sessions. */
  async stop(): Promise<void> {
    for (const [, interval] of this.typingIntervals) {
      clearInterval(interval);
    }
    this.typingIntervals.clear();

    for (const [sessionId, session] of this.sessionMap) {
      try {
        await session.disconnect();
        console.log(`[session-manager] Disconnected session ${sessionId}`);
      } catch (err) {
        console.warn(`[session-manager] Error disconnecting ${sessionId}:`, err);
      } finally {
        this.attachedSessions.delete(sessionId);
      }
    }
    this.sessionMap.clear();
    this.chats.clear();
    this.attachedSessions.clear();

    if (this.client) {
      await this.client.stop();
      this.client = null;
      console.log("[session-manager] CopilotClient stopped");
    }
  }

  private ensureClient(): CopilotClient {
    if (!this.client) throw new Error("CopilotClient not started");
    return this.client;
  }

  private getChatState(chatId: string): ChatState {
    let state = this.chats.get(chatId);
    if (!state) {
      state = { activeSessionId: null, sessions: new Map() };
      this.chats.set(chatId, state);
    }
    return state;
  }

  private generateSessionId(chatId: string): string {
    return `tg-${chatId}-${Date.now()}`;
  }

  /** Create or resume a Copilot session for the given chat. */
  async createSession(chatId: string, customSessionId?: string): Promise<SessionInfo> {
    const client = this.ensureClient();
    const sessionId = customSessionId ?? this.generateSessionId(chatId);

    // Try to resume if this is a named session that might already exist
    let session: CopilotSession;
    const sessionHooks = this.buildSessionHooks();

    if (customSessionId && this.sessionMap.has(sessionId)) {
      session = this.sessionMap.get(sessionId)!;
    } else if (customSessionId) {
      try {
        session = await client.resumeSession(sessionId, {
          onPermissionRequest: approveAll,
          hooks: sessionHooks,
        });
      } catch (resumeErr) {
        console.warn(`[session-manager] Could not resume session ${sessionId}, creating new:`, resumeErr);
        session = await client.createSession({
          sessionId,
          onPermissionRequest: approveAll,
          hooks: sessionHooks,
          infiniteSessions: {
            enabled: true,
            backgroundCompactionThreshold: 0.8,
            bufferExhaustionThreshold: 0.95,
          },
        });
      }
    } else {
      session = await client.createSession({
        sessionId,
        onPermissionRequest: approveAll,
        hooks: sessionHooks,
        infiniteSessions: {
          enabled: true,
          backgroundCompactionThreshold: 0.8,
          bufferExhaustionThreshold: 0.95,
        },
      });
    }

    this.sessionMap.set(sessionId, session);
    this.attachSessionHandlers(session, chatId, sessionId);

    const info: SessionInfo = {
      sessionId,
      chatId,
      createdAt: new Date(),
    };

    const chatState = this.getChatState(chatId);
    chatState.sessions.set(sessionId, info);
    chatState.activeSessionId = sessionId;

    console.log(`[session-manager] Created session ${sessionId} for chat ${chatId}`);
    return info;
  }

  /** Send a prompt to the active session for a chat. */
  async sendMessage(
    chatId: string,
    prompt: string,
    attachments?: CopilotAttachments,
  ): Promise<void> {
    // Per-chat mutex to prevent concurrent session creation
    const prevLock = this.sendLocks.get(chatId) ?? Promise.resolve();
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => { releaseLock = resolve; });
    this.sendLocks.set(chatId, lockPromise);

    await prevLock;

    try {
      const chatState = this.getChatState(chatId);

      // Auto-create session if none exists
      if (!chatState.activeSessionId || !this.sessionMap.has(chatState.activeSessionId)) {
        await this.createSession(chatId);
      }

      const session = this.sessionMap.get(chatState.activeSessionId!);
      if (!session) throw new Error("No active session");

      this.startTyping(chatId);

      const sendOpts: CopilotSendOptions & { attachments?: CopilotAttachments } = {
        prompt,
        mode: "enqueue",
      };
      if (attachments) {
        sendOpts.attachments = attachments;
      }

      await session.send(sendOpts);
    } catch (err) {
      this.stopTyping(chatId);
      throw err;
    } finally {
      releaseLock!();
    }
  }

  /** Send a prompt to a cron session without switching the active session. */
  async sendToCronSession(chatId: string, jobId: string, prompt: string): Promise<void> {
    const cronSessionId = `cron-${jobId}`;

    // Ensure the cron session exists (create or resume)
    if (!this.sessionMap.has(cronSessionId)) {
      await this.createSession(chatId, cronSessionId);
      // Don't switch the user's active session — cron runs in background
      const chatState = this.getChatState(chatId);
      const userActive = Array.from(chatState.sessions.values())
        .find(s => !s.sessionId.startsWith("cron-"));
      if (userActive) {
        chatState.activeSessionId = userActive.sessionId;
      }
    }

    const session = this.sessionMap.get(cronSessionId);
    if (!session) throw new Error(`No cron session for ${jobId}`);

    this.startTyping(chatId);
    try {
      await session.send({ prompt, mode: "enqueue" });
    } catch (err) {
      this.stopTyping(chatId);
      throw err;
    }
  }

  /** Switch the active session to the indexed session in the chat. */
  async switchSession(chatId: string, index: number): Promise<SessionInfo | null> {
    const chatState = this.getChatState(chatId);
    const sessions = Array.from(chatState.sessions.values());

    if (index < 1 || index > sessions.length) return null;

    const target = sessions[index - 1];

    // Resume if not already active
    if (!this.sessionMap.has(target.sessionId)) {
      const client = this.ensureClient();
      const session = await client.resumeSession(target.sessionId, {
        onPermissionRequest: approveAll,
        hooks: this.buildSessionHooks(),
      });
      this.sessionMap.set(target.sessionId, session);
      this.attachSessionHandlers(session, chatId, target.sessionId);
    }

    chatState.activeSessionId = target.sessionId;
    console.log(`[session-manager] Switched to session ${target.sessionId} in chat ${chatId}`);
    return target;
  }

  /** End and delete the active session for a chat. */
  async endSession(chatId: string): Promise<string | null> {
    const chatState = this.getChatState(chatId);
    const sessionId = chatState.activeSessionId;
    if (!sessionId) return null;

    const session = this.sessionMap.get(sessionId);
    try {
      if (session) {
        await session.disconnect();
      }
    } catch (disconnectErr) {
      console.warn(`[session-manager] Error disconnecting session ${sessionId}:`, disconnectErr);
    } finally {
      // Always clean up local state even if disconnect fails
      this.sessionMap.delete(sessionId);
      this.attachedSessions.delete(sessionId);
      chatState.sessions.delete(sessionId);
      this.stopTyping(chatId);
    }

    const client = this.ensureClient();
    try {
      await client.deleteSession(sessionId);
    } catch (deleteErr) {
      console.warn(`[session-manager] Could not delete session ${sessionId} (may already be removed):`, deleteErr);
    }

    // Switch to another session if available
    const remaining = Array.from(chatState.sessions.values());
    chatState.activeSessionId = remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null;

    console.log(`[session-manager] Ended session ${sessionId} in chat ${chatId}`);
    return sessionId;
  }

  /** List all known sessions for a chat. */
  listSessions(chatId: string): SessionInfo[] {
    const chatState = this.getChatState(chatId);
    return Array.from(chatState.sessions.values());
  }

  /** Return the active session ID for a chat, if any. */
  getActiveSessionId(chatId: string): string | null {
    return this.getChatState(chatId).activeSessionId;
  }

  /** Return the number of sessions tracked for a chat. */
  getSessionCount(chatId: string): number {
    return this.getChatState(chatId).sessions.size;
  }

  private startTyping(chatId: string): void {
    this.stopTyping(chatId);
    this.channel.sendTypingAction(chatId).catch((err) => {
      console.warn("[session-manager] Typing action failed:", err);
    });
    const interval = setInterval(() => {
      this.channel.sendTypingAction(chatId).catch((err) => {
        console.warn("[session-manager] Typing action failed:", err);
      });
    }, 4000);
    this.typingIntervals.set(chatId, interval);
  }

  private stopTyping(chatId: string): void {
    const interval = this.typingIntervals.get(chatId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(chatId);
    }
  }

  private buildSessionHooks() {
    return {
      onUserPromptSubmitted: async () => ({
        additionalContext: CROSS_SESSION_CONTEXT,
      }),
    };
  }

  private attachSessionHandlers(
    session: CopilotSession,
    chatId: string,
    sessionId: string,
  ): void {
    if (this.attachedSessions.has(sessionId)) return;
    this.attachedSessions.add(sessionId);

    session.on("assistant.message", (event) => {
      const content = event.data.content;
      if (!content || content.trim().length === 0) return;
      this.stopTyping(chatId);
      this.channel.sendMessage(chatId, content).catch((err) => {
        console.warn(
          `[session-manager] Failed to forward message on ${this.channel.name}:`,
          err,
        );
      });
    });

    session.on("session.idle", () => {
      this.stopTyping(chatId);
    });
  }

  /** Return true if the Copilot client is running. */
  isRunning(): boolean {
    return this.client !== null;
  }
}
