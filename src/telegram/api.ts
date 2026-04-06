const TELEGRAM_MAX_LENGTH = 4096;

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: unknown;
  video?: unknown;
  voice?: unknown;
  sticker?: unknown;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export class TelegramApi {
  private readonly apiBase: string;
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
    return data.result;
  }

  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe");
  }

  async getUpdates(
    offset: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; result: TelegramUpdate[]; description?: string }> {
    const res = await fetch(`${this.apiBase}/getUpdates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset,
        timeout,
        allowed_updates: ["message"],
      }),
      signal,
    });
    return (await res.json()) as {
      ok: boolean;
      result: TelegramUpdate[];
      description?: string;
    };
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!text || text.trim().length === 0) return;

    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += TELEGRAM_MAX_LENGTH) {
      chunks.push(text.slice(i, i + TELEGRAM_MAX_LENGTH));
    }

    for (const chunk of chunks) {
      try {
        await this.call("sendMessage", {
          chat_id: chatId,
          text: chunk,
          parse_mode: "Markdown",
        });
      } catch {
        await this.call("sendMessage", { chat_id: chatId, text: chunk });
      }
      if (chunks.length > 1) await sleep(150);
    }
  }

  async sendTypingAction(chatId: string): Promise<void> {
    try {
      await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
    } catch {
      /* best-effort */
    }
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.call<TelegramFile>("getFile", { file_id: fileId });
  }

  async downloadFile(filePath: string): Promise<{ data: Buffer; mimeType: string }> {
    const fileUrl = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    };

    return { data: buffer, mimeType: mimeMap[ext] ?? "image/jpeg" };
  }

  async sendPhoto(
    chatId: string,
    photo: string,
    caption?: string,
  ): Promise<void> {
    const isUrl = photo.startsWith("http://") || photo.startsWith("https://");

    if (isUrl) {
      const body: Record<string, unknown> = { chat_id: chatId, photo };
      if (caption) body.caption = caption;
      await this.call("sendPhoto", body);
    } else {
      const { readFileSync } = await import("node:fs");
      const { basename } = await import("node:path");
      const fileData = readFileSync(photo);
      const fileName = basename(photo);
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", new Blob([fileData]), fileName);
      if (caption) formData.append("caption", caption);

      const res = await fetch(`${this.apiBase}/sendPhoto`, {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function sleep_ms(ms: number): Promise<void> {
  return sleep(ms);
}
