const TELEGRAM_MAX_LENGTH = 4096;

/** Telegram user metadata returned by the Bot API. */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/** Basic chat metadata from Telegram. */
export interface TelegramChat {
  id: number;
  type: string;
}

/** Telegram photo metadata for a specific size. */
export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/** Telegram message payload used by the bridge. */
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

/** Telegram update payload for long polling. */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** Telegram file metadata resolved from getFile. */
export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

/** Thin wrapper around the Telegram Bot API. */
export class TelegramApi {
  private readonly apiBase: string;
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  /** Call a Telegram API method and return its result payload. */
  async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Telegram API HTTP error: ${res.status} ${res.statusText} for ${method}`);
    }
    const data = (await res.json()) as { ok?: boolean; result?: T; description?: string };
    if (!data || typeof data !== "object" || !data.ok) {
      throw new Error(`Telegram API error: ${data?.description ?? "unknown error"}`);
    }
    return data.result as T;
  }

  /** Fetch the bot user metadata. */
  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe");
  }

  /** Long-poll for updates from Telegram. */
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
    if (!res.ok) {
      return { ok: false, result: [], description: `HTTP ${res.status} ${res.statusText}` };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      result?: TelegramUpdate[];
      description?: string;
    };
    return {
      ok: data?.ok === true,
      result: Array.isArray(data?.result) ? data.result : [],
      description: data?.description,
    };
  }

  /** Send a message, chunking it when it exceeds Telegram length limits. */
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

  /** Send a typing indicator (best-effort). */
  async sendTypingAction(chatId: string): Promise<void> {
    try {
      await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
    } catch {
      /* best-effort */
    }
  }

  /** Resolve a Telegram file by ID. */
  async getFile(fileId: string): Promise<TelegramFile> {
    return this.call<TelegramFile>("getFile", { file_id: fileId });
  }

  /** Download a file from Telegram and infer its MIME type. */
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

  /** Send a photo by URL or local file path. */
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
      if (!res.ok) {
        throw new Error(`Telegram API HTTP error: ${res.status} ${res.statusText} for sendPhoto`);
      }
      const data = (await res.json()) as { ok?: boolean; description?: string };
      if (!data?.ok) throw new Error(`Telegram API error: ${data?.description ?? "unknown error"}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sleep for the provided duration in milliseconds. */
export function sleepMs(ms: number): Promise<void> {
  return sleep(ms);
}
