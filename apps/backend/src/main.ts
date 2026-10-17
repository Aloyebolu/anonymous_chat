import { ChatApplication } from "./application/chat-application.js";
import { MATCHMAKING_CONFIG, MatchmakingService } from "./application/matchmaking.js";
import { ChannelRegistry } from "./ports/channels.js";
import { AdminServer } from "./infrastructure/admin/admin-server.js";
import { HttpAiService } from "./infrastructure/ai/http-ai-service.js";
import { StubAiService } from "./infrastructure/ai/stub-ai-service.js";
import { RegexModerationService } from "./infrastructure/moderation/regex-moderation.js";
import { BaileysSocketBridgeImpl } from "./infrastructure/channels/whatsapp/baileys-socket-bridge.js";
import { WhatsAppChannelDriver } from "./infrastructure/channels/whatsapp/whatsapp-channel-driver.js";
import { mapBaileysInbound } from "./infrastructure/channels/whatsapp/baileys-mapper.js";
import { WebChannelDriver } from "./infrastructure/channels/web/web-channel-driver.js";
import { JsonDatabase } from "./infrastructure/persistence/json-database.js";
import { InMemoryMessageLogRepository } from "./infrastructure/persistence/in-memory-message-log.js";
import {
  JsonConversationRepository,
  JsonMatchQueueRepository,
  JsonReportRepository,
  JsonPointsRepository,
  JsonModerationEventRepository,
  JsonUserRepository
} from "./infrastructure/persistence/json-repositories.js";
import { TelegramChannelDriver } from "./infrastructure/channels/telegram/telegram-channel-driver.js";
import { mapTelegramInbound } from "./infrastructure/channels/telegram/telegram-mapper.js";
import { TelegramBotBridgeImpl } from "./infrastructure/channels/telegram/telegram-bot-bridge.js";
import { MiniAppServer } from "./infrastructure/http/mini-app-server.js";
import dotenv from "dotenv"
dotenv.config({ path: './src/.env' })

const IS_DEVELOPMENT = process.env.APP_MODE !== "production" && process.env.NODE_ENV !== "production";
const DATA_DIR = process.env.DATA_DIR ?? (IS_DEVELOPMENT ? ".data/development" : ".data");
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? `${DATA_DIR}/whatsapp-auth`;
const DB_PATH = process.env.DB_PATH ?? `${DATA_DIR}/db.json`;
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const ADMIN_PORT = Number(process.env.ADMIN_PORT ?? 3001);
const MINI_APP_API_PORT = Number(process.env.MINI_APP_API_PORT ?? 3003);
const HTTP_HOST = process.env.HTTP_HOST ?? (IS_DEVELOPMENT ? "127.0.0.1" : "0.0.0.0");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SWEEP_INTERVAL_MS = 5_000;
const AI_URL = process.env.AI_URL || (IS_DEVELOPMENT ? undefined : "http://localhost:4000/api/chat2");

const WHATSAPP_ENABLED = IS_DEVELOPMENT
  ? process.env.ENABLE_WHATSAPP === "1"
  : process.env.DISABLE_WHATSAPP !== "1";
const TELEGRAM_ENABLED = IS_DEVELOPMENT
  ? process.env.ENABLE_TELEGRAM === "1"
  : process.env.DISABLE_TELEGRAM !== "1";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function main(): Promise<void> {
  if (IS_DEVELOPMENT) {
    console.log("Development mode: local web simulator only; production data and chat accounts are untouched.");
    if (process.env.ENABLE_TELEGRAM === "1") console.warn("Development mode: connecting to the real Telegram bot because ENABLE_TELEGRAM=1.");
    if (process.env.ENABLE_WHATSAPP === "1") console.warn("Development mode: connecting to the real WhatsApp account because ENABLE_WHATSAPP=1.");
  }
  // ---- Persistence ---------------------------------------------------------
  const db = new JsonDatabase(DB_PATH);
  const users = new JsonUserRepository(db);
  const conversations = new JsonConversationRepository(db);
  const queue = new JsonMatchQueueRepository(db);
  const reports = new JsonReportRepository(db);
  const points = new JsonPointsRepository(db);
  const moderationEvents = new JsonModerationEventRepository(db);
  const log = new InMemoryMessageLogRepository();

  // ---- Services ------------------------------------------------------------
  const ai = AI_URL
    ? new HttpAiService({ endpoint: AI_URL })
    : new StubAiService();
  const moderation = new RegexModerationService();

  // ---- Channels ------------------------------------------------------------
  const registry = new ChannelRegistry();

  const web = new WebChannelDriver({ port: WEB_PORT, host: HTTP_HOST });
  registry.register(web);

  // ---- Application ---------------------------------------------------------
  const matching = new MatchmakingService(users, queue, conversations, MATCHMAKING_CONFIG);
  const app = new ChatApplication(
    users, conversations, registry, matching, moderation, ai, reports, log, points, moderationEvents,
    process.env.TELEGRAM_MINI_APP_URL
  );

  // The single receive callback every driver funnels into.
  const receive = (event: Parameters<ChatApplication["receive"]>[0]) => app.receive(event);

  // ---- Start non-chat infrastructure first --------------------------------
  await web.start(receive);

  const admin = new AdminServer(
    { users, queue, conversations, reports, log, matching, moderationEvents },
    { port: ADMIN_PORT, host: HTTP_HOST, matchmaking: MATCHMAKING_CONFIG, authToken: ADMIN_TOKEN }
  );
  await admin.start();

  let miniApp: MiniAppServer | undefined;
  if (TELEGRAM_TOKEN && (!IS_DEVELOPMENT || TELEGRAM_ENABLED)) {
    miniApp = new MiniAppServer(users, points, { port: MINI_APP_API_PORT, host: HTTP_HOST, botToken: TELEGRAM_TOKEN });
    await miniApp.start();
  }

  // ---- Telegram ------------------------------------------------------------
  let telegram: TelegramChannelDriver | undefined;
  if (TELEGRAM_ENABLED) {
    const token = TELEGRAM_TOKEN ;
    if (!token) {
      console.error("TELEGRAM_BOT_TOKEN is not set. Disabling Telegram.");
    } else {
      const tgBridge = new TelegramBotBridgeImpl({ token });
      telegram = new TelegramChannelDriver(tgBridge, mapTelegramInbound);
      await telegram.start(receive);
      registry.register(telegram);
      console.log("Telegram driver started.");
    }
  }

  // ---- WhatsApp ------------------------------------------------------------
  let whatsapp: WhatsAppChannelDriver | undefined;
  if (WHATSAPP_ENABLED) {
    const bridge = new BaileysSocketBridgeImpl({ authDir: AUTH_DIR });
    whatsapp = new WhatsAppChannelDriver(bridge, mapBaileysInbound);
    await whatsapp.start(receive);
    registry.register(whatsapp);
    console.log(`WhatsApp driver started. Auth state in ${AUTH_DIR}.`);
  } else {
    console.log(IS_DEVELOPMENT
      ? "WhatsApp disabled in development (set ENABLE_WHATSAPP=1 to connect intentionally)."
      : "WhatsApp disabled (DISABLE_WHATSAPP=1).");
  }

  console.log(`State stored in ${DB_PATH}.`);
  console.log(
    `AI fallback: ${MATCHMAKING_CONFIG.aiFallback.enabled ? "enabled" : "disabled"} (source: ${AI_URL ?? "stub"}).`
  );

  // ---- Matchmaking sweep ---------------------------------------------------
  await app.runMatchmakingSweep();
  const sweepTimer = setInterval(() => {
    void app.runMatchmakingSweep().catch((error) => console.error("[sweep] Failed.", error));
  }, SWEEP_INTERVAL_MS);

  // ---- Shutdown ------------------------------------------------------------
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Shutting down…");
    clearInterval(sweepTimer);

    await Promise.allSettled([
      whatsapp?.stop(),
      telegram?.stop(),
      miniApp?.stop(),
      web.stop(),
      admin.stop()
    ]);

    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
