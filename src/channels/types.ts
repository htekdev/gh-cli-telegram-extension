export interface MessagingChannel {
  readonly name: string;

  sendMessage(chatId: string, text: string): Promise<void>;
  sendTypingAction(chatId: string): Promise<void>;

  start(): Promise<void>;
  stop(): void;
}
