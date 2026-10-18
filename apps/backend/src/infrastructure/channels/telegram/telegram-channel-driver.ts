import type {
    ChannelCapabilities,
    ChannelDriver,
    ChannelRecipient,
    InboundEvent,
    MediaPayload,
    OutboundMessage
} from "../../../ports/channels.js";

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
})[character]!);

// in telegram-channel-driver.ts
export interface TelegramBotBridge {
    connect(): Promise<void>;
    onMessage(handler: (raw: unknown) => void): void;
    sendText(chatId: string, text: string, format?: "html"): Promise<void>;
    sendTyping?(chatId: string): Promise<void>;
    sendButtons?(chatId: string, text: string, actions: readonly { id: string; label: string; url?: string }[], format?: "html"): Promise<void>;
    sendMedia?(chatId: string, media: MediaPayload, caption?: string): Promise<void>;
    resolveMediaUrl?(fileId: string): Promise<string | undefined>;
    close(): Promise<void>;
}
export class TelegramChannelDriver implements ChannelDriver {
    readonly type = "telegram";
    readonly capabilities: ChannelCapabilities = {
        text: true,
        buttons: true,
        menus: true,
        menuLayouts: ["rows", "grid"],
        messageEditing: false,
        messageDeletion: false,
        typingIndicator: true,
        media: ["image", "video", "voice", "audio", "document", "sticker"],
        payments: [],
        deepLinks: true
    };

    private readonly pendingActions = new Map<string, readonly { id: string; label: string }[]>();

    constructor(
        private readonly bot: TelegramBotBridge,
        private readonly mapInbound: (raw: unknown) => InboundEvent | undefined
    ) { }

    async start(receiver: (event: InboundEvent) => Promise<void>): Promise<void> {
        this.bot.onMessage((raw) => {
            const event = this.mapInbound(raw);
            if (!event) return;
            void receiver(this.resolvePendingAction(event));
        });
        await this.bot.connect();
    }

    async stop(): Promise<void> {
        await this.bot.close();
    }

    async sendTyping(recipient: ChannelRecipient): Promise<void> {
        if (!this.bot.sendTyping) return;
        await this.bot.sendTyping(recipient.externalId);
    }

    buildDeepLink(payload: string): string {
        // Filled in at runtime by the bridge, but the shape is stable.
        return `https://t.me/${(this.bot as { username?: string }).username ?? "your_bot"}?start=${encodeURIComponent(payload)}`;
    }

    async sendMessage(recipient: ChannelRecipient, message: OutboundMessage): Promise<void> {
        if (message.kind === "text") {
            return this.bot.sendText(recipient.externalId, message.text, message.format);
        }

        if (message.kind === "interaction") {
            if (this.bot.sendButtons) {
                return this.bot.sendButtons(recipient.externalId, message.text, message.actions, message.format);
            }
            this.pendingActions.set(recipient.externalId, message.actions);
            const options = message.actions.map((action, index) =>
                `${index + 1}. ${message.format === "html" ? escapeHtml(action.label) : action.label}`
            ).join("\n");
            return this.bot.sendText(recipient.externalId, `${message.text}\n\n${options}`, message.format);
        }

        if (message.kind === "media") {
            if (!this.bot.sendMedia) {
                console.warn("[telegram] Bridge does not implement sendMedia.");
                return;
            }
            if (!this.capabilities.media.includes(message.media.kind)) {
                console.warn(`[telegram] Dropping unsupported media kind: ${message.media.kind}`);
                return;
            }
            return this.bot.sendMedia(recipient.externalId, message.media, message.caption);
        }

        if (message.kind === "invoice") {
            console.warn("[telegram] Invoice not implemented yet.");
            return;
        }
    }

    private resolvePendingAction(event: InboundEvent): InboundEvent {
        if (event.kind !== "message") return event;
        if (event.content.kind !== "text") return event;

        const pending = this.pendingActions.get(event.identity.externalId);
        if (!pending || pending.length === 0) return event;
        const text = event.content.text.trim();

        if (/^[1-9]\d*$/.test(text)) {
            const index = Number.parseInt(text, 10);
            if (index >= 1 && index <= pending.length) {
                const action = pending[index - 1];
                this.pendingActions.delete(event.identity.externalId);
                return {
                    kind: "action",
                    channel: event.channel,
                    identity: event.identity,
                    actionId: action.id,
                    timestamp: event.timestamp
                };
            }
        }

        const labelMatch = pending.find((a) => a.label.toLowerCase() === text.toLowerCase());
        if (labelMatch) {
            this.pendingActions.delete(event.identity.externalId);
            return {
                kind: "action",
                channel: event.channel,
                identity: event.identity,
                actionId: labelMatch.id,
                timestamp: event.timestamp
            };
        }

        return event;
    }
    async resolveMedia(media: MediaPayload): Promise<MediaPayload> {
        if (media.url || media.bytes) return media; // already portable
        if (!media.channelRef) return media;         // nothing to resolve
        if (!this.bot.resolveMediaUrl) return media;

        const url = await this.bot.resolveMediaUrl(media.channelRef);
        if (!url) return media;
        return { ...media, url, channelRef: undefined };
    }
}
