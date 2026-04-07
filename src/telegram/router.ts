import type { SessionManager, CopilotAttachments } from "../sessions/manager.js";
import type { TelegramApi, TelegramMessage } from "./api.js";

/** Routes Telegram messages into Copilot sessions. */
export class MessageRouter {
  private readonly sessionManager: SessionManager;
  private readonly telegram: TelegramApi;

  constructor(sessionManager: SessionManager, telegram: TelegramApi) {
    this.sessionManager = sessionManager;
    this.telegram = telegram;
  }

  /** Route a text message into the active session. */
  async routeTextMessage(msg: TelegramMessage): Promise<void> {
    const chatId = String(msg.chat.id);
    const from = msg.from?.first_name || msg.from?.username || "Unknown";
    const text = msg.text ?? "";
    if (!text) return;

    const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
    console.log(`[router] 💬 ${from}: ${preview}`);

    try {
      await this.sessionManager.sendMessage(chatId, `[Telegram from ${from}]: ${text}`);
    } catch (err) {
      console.error(`[router] Failed to send message:`, err);
      try {
        await this.telegram.sendMessage(
          chatId,
          "⚠️ Failed to send message to Copilot session. Try again or use /new to start a fresh session.",
        );
      } catch (notifyErr) {
        console.warn("[router] Failed to send error notification:", notifyErr);
      }
    }
  }

  /** Route a photo message into the active session as a blob attachment. */
  async routePhotoMessage(msg: TelegramMessage): Promise<void> {
    const chatId = String(msg.chat.id);
    const from = msg.from?.first_name || msg.from?.username || "Unknown";
    const caption = msg.caption || "What do you see in this image?";

    const preview = caption.length > 80 ? caption.slice(0, 80) + "…" : caption;
    console.log(`[router] 📷 ${from}: ${preview}`);

    try {
      if (!msg.photo || msg.photo.length === 0) {
        throw new Error("Photo message has no photo data");
      }
      const photo = msg.photo[msg.photo.length - 1];
      const fileInfo = await this.telegram.getFile(photo.file_id);
      if (!fileInfo.file_path) throw new Error("No file path returned");

      const { data, mimeType } = await this.telegram.downloadFile(fileInfo.file_path);
      const base64Data = data.toString("base64");

      const attachments: CopilotAttachments = [
        {
          type: "blob",
          data: base64Data,
          mimeType,
          displayName: fileInfo.file_path.split("/").pop() ?? "photo.jpg",
        },
      ];

      await this.sessionManager.sendMessage(
        chatId,
        `[Telegram from ${from}]: ${caption}`,
        attachments,
      );
    } catch (err) {
      console.error(`[router] Failed to process photo:`, err);
      try {
        await this.telegram.sendMessage(
          chatId,
          "⚠️ Failed to process that image. Try again or send as text.",
        );
      } catch (notifyErr) {
        console.warn("[router] Failed to send error notification:", notifyErr);
      }
    }
  }
}
