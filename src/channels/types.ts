/** Contract for messaging channel adapters (Telegram, Slack, etc.). */
export interface MessagingChannel {
  readonly name: string;

  /** Send a text message to a chat or thread. */
  sendMessage(chatId: string, text: string): Promise<void>;
  /** Emit a typing indicator when supported. */
  sendTypingAction(chatId: string): Promise<void>;

  /** Start the channel connection. */
  start(): Promise<void>;
  /** Stop the channel connection. */
  stop(): void;
}
