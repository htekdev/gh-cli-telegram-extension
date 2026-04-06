import type { SessionManager } from "../sessions/manager.js";
import type { TelegramApi, TelegramMessage } from "./api.js";

const CROSS_SESSION_HINT =
  "\n\n[System: You are in a multi-session environment. Other sessions " +
  "(including scheduled task sessions prefixed with 'cron-') may contain " +
  "relevant context. If the user references work from another session or " +
  "a scheduled task, use session store queries (sql tool with database " +
  "'session_store') to search across sessions for the needed information.]";

export class MessageRouter {
  private readonly sessionManager: SessionManager;
  private readonly telegram: TelegramApi;

  constructor(sessionManager: SessionManager, telegram: TelegramApi) {
    this.sessionManager = sessionManager;
    this.telegram = telegram;
  }

  async routeTextMessage(msg: TelegramMessage): Promise<void> {
    const chatId = String(msg.chat.id);
    const from = msg.from?.first_name || msg.from?.username || "Unknown";
    const text = msg.text!;

    const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
    console.log(`[router] 💬 ${from}: ${preview}`);

    const prompt = `[Telegram from ${from}]: ${text}${CROSS_SESSION_HINT}`;

    try {
      await this.sessionManager.sendMessage(chatId, prompt);
    } catch (err) {
      console.error(`[router] Failed to send message:`, err);
      await this.telegram.sendMessage(
        chatId,
        "⚠️ Failed to send message to Copilot session. Try again or use /new to start a fresh session.",
      );
    }
  }

  async routePhotoMessage(msg: TelegramMessage): Promise<void> {
    const chatId = String(msg.chat.id);
    const from = msg.from?.first_name || msg.from?.username || "Unknown";
    const caption = msg.caption || "What do you see in this image?";

    const preview = caption.length > 80 ? caption.slice(0, 80) + "…" : caption;
    console.log(`[router] 📷 ${from}: ${preview}`);

    const prompt = `[Telegram from ${from}]: ${caption}${CROSS_SESSION_HINT}`;

    try {
      const photo = msg.photo![msg.photo!.length - 1];
      const fileInfo = await this.telegram.getFile(photo.file_id);
      if (!fileInfo.file_path) throw new Error("No file path returned");

      const { data, mimeType } = await this.telegram.downloadFile(fileInfo.file_path);
      const base64Data = data.toString("base64");

      await this.sessionManager.sendMessage(
        chatId,
        prompt,
        [
          {
            type: "blob",
            data: base64Data,
            mimeType,
            displayName: fileInfo.file_path.split("/").pop() ?? "photo.jpg",
          },
        ],
      );
    } catch (err) {
      console.error(`[router] Failed to process photo:`, err);
      await this.telegram.sendMessage(
        chatId,
        "⚠️ Failed to process that image. Try again or send as text.",
      );
    }
  }
}
