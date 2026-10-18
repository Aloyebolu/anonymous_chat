import { Telegraf } from "telegraf";
import type { TelegramBotBridge } from "./telegram-channel-driver.js";
import { MediaPayload } from "../../../ports/channels.js";

export interface TelegramBridgeOptions {
    readonly token: string;
}

export class TelegramBotBridgeImpl implements TelegramBotBridge {
    private bot?: Telegraf;
    private messageHandler?: (raw: unknown) => void;
    private closing = false;

    /** Populated after launch; used by the driver's buildDeepLink. */
    username?: string;

    constructor(private readonly options: TelegramBridgeOptions) { }

    onMessage(handler: (raw: unknown) => void): void {
        this.messageHandler = handler;
    }

    async connect(): Promise<void> {
        this.closing = false;
        const bot = this.createBot();
        this.bot = bot;
        // Keep startup non-blocking and own every rejection from Telegraf polling.
        void this.launchWithRetry(bot);
        void bot.telegram.getMe().then((me) => { this.username = me.username; })
            .catch((err: unknown) => console.warn("[telegram] Bot identity unavailable; deep links will use the configured fallback.", err));
    }

    private createBot(): Telegraf {
        const bot = new Telegraf(this.options.token);
        bot.on("message", (ctx) => {
            if (!this.closing) this.messageHandler?.(ctx.update);
        });
        bot.on("callback_query", (ctx) => {
            if (this.closing) return;
            this.messageHandler?.(ctx.update);
            void ctx.answerCbQuery().catch((err: unknown) => console.warn("[telegram] Callback acknowledgement failed.", err));
        });
        bot.catch((err) => console.error("[telegram] Update handler failed.", err));
        void bot.telegram.setMyCommands([
            { command: "start", description: "Start or resume your profile" },
            { command: "find", description: "Find a chat" },
            { command: "next", description: "Move to another chat" },
            { command: "end", description: "End your current chat" },
            { command: "settings", description: "Update your profile" },
            { command: "vip", description: "Explore VIP matching" },
            { command: "app", description: "Open settings and daily rewards" },
            { command: "settings", description: "Update your chat profile" },
            { command: "points", description: "Check your points" },
            { command: "report", description: "Report a problem" },
            { command: "help", description: "Show help" }
        ]).catch((err: unknown) => console.warn("[telegram] Could not register command menu.", err));
        return bot;
    }

    private async launchWithRetry(initialBot: Telegraf): Promise<void> {
        let bot = initialBot;
        let attempt = 0;
        while (!this.closing) {
            try {
                await bot.launch();
                return;
            } catch (err) {
                if (this.closing) return;
                attempt += 1;
                const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
                console.error(`[telegram] Polling failed; retrying in ${Math.round(delayMs / 1000)}s.`, err);
                try { bot.stop("Polling retry"); } catch { /* may not have started */ }
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, delayMs);
                    timer.unref();
                });
                if (this.closing) return;
                bot = this.createBot();
                this.bot = bot;
            }
        }
    }

    async sendText(chatId: string, text: string, format?: "html"): Promise<void> {
        if (!this.bot) throw new Error("Telegram bot is not connected.");
        await this.bot.telegram.sendMessage(chatId, text, format === "html" ? { parse_mode: "HTML" } : undefined);
    }

    async sendTyping(chatId: string): Promise<void> {
        if (!this.bot) return;
        try {
            await this.bot.telegram.sendChatAction(chatId, "typing");
        } catch (err) {
            // Best-effort; don't break the caller.
            console.warn("[telegram] sendTyping failed.", err);
        }
    }

    async sendMedia(chatId: string, media: MediaPayload, caption?: string): Promise<void> {
        if (!this.bot) throw new Error("Telegram bot is not connected.");

        // Telegram accepts file_id, URL, or a stream as the "source" argument.
        // file_id first — that's the fast path (no re-upload, no expiry).
        const source = media.channelRef ?? media.url ?? media.bytes;
        if (!source) throw new Error("MediaPayload has no channelRef, url, or bytes.");

        const opts = caption ? { caption } : undefined;

        switch (media.kind) {
            case "image":
                return void (await this.bot.telegram.sendPhoto(chatId, source as never, opts));
            case "video":
                return void (await this.bot.telegram.sendVideo(chatId, source as never, opts));
            case "voice":
                return void (await this.bot.telegram.sendVoice(chatId, source as never, opts));
            case "audio":
                return void (await this.bot.telegram.sendAudio(chatId, source as never, opts));
            case "document":
                return void (await this.bot.telegram.sendDocument(chatId, source as never, opts));
            case "sticker":
                return void (await this.bot.telegram.sendSticker(chatId, source as never));
            case "location":
                // Location has a different shape — see note below.
                throw new Error("Location is not a MediaPayload; handle separately.");
        }
    }

    async resolveMediaUrl(fileId: string): Promise<string | undefined> {
        if (!this.bot) return undefined;
        try {
            const link = await this.bot.telegram.getFileLink(fileId);
            return link.href;
        } catch (err) {
            console.warn("[telegram] resolveMediaUrl failed.", err);
            return undefined;
        }
    }
    async sendButtons(
        chatId: string,
        text: string,
        actions: readonly { id: string; label: string; url?: string }[],
        format?: "html"
    ): Promise<void> {
        if (!this.bot) throw new Error("Telegram bot is not connected.");
        await this.bot.telegram.sendMessage(chatId, text, {
            reply_markup: {
                inline_keyboard: [actions.map((action) => action.url
                    ? ({ text: action.label, web_app: { url: action.url } })
                    : ({ text: action.label, callback_data: action.id }))]
            },
            ...(format === "html" ? { parse_mode: "HTML" as const } : {})
        });
    }

    async close(): Promise<void> {
        this.closing = true;
        if (this.bot) {
            try { this.bot.stop("Bridge closed"); } catch { /* already stopped */ }
            this.bot = undefined;
        }
    }
}
