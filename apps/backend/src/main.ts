import { ChatApplication } from "./application/chat-application.js";
import { MATCHMAKING_CONFIG, MatchmakingService } from "./application/matchmaking.js";
import { PointsVipPlanAdapter, VipPlanRegistry } from "./application/vip-plans.js";
import { ChannelRegistry } from "./ports/channels.js";
import { AdminServer } from "./infrastructure/admin/admin-server.js";
import { HttpAiService } from "./infrastructure/ai/http-ai-service.js";
import { StubAiService } from "./infrastructure/ai/stub-ai-service.js";
import { RegexModerationService } from "./infrastructure/moderation/regex-moderation.js";
import { BaileysSocketBridgeImpl } from "./infrastructure/channels/whatsapp/baileys-socket-bridge.js";
import { WhatsAppChannelDriver } from "./infrastructure/channels/whatsapp/whatsapp-channel-driver.js";
import { mapBaileysInbound } from "./infrastructure/channels/whatsapp/baileys-mapper.js";
import { WhatsAppCloudApiDriver } from "./infrastructure/channels/whatsapp/whatsapp-cloud-api-driver.js";
import { WebChannelDriver } from "./infrastructure/channels/web/web-channel-driver.js";
import { Pool } from "pg";
import { PostgresDatabase } from "./infrastructure/persistence/postgres-database.js";
import { applyMigrations } from "./infrastructure/persistence/migrations.js";
import { InMemoryMessageLogRepository } from "./infrastructure/persistence/in-memory-message-log.js";
import {
  PostgresConversationRepository,
  PostgresMatchQueueRepository,
  PostgresReportRepository,
  PostgresPointsRepository,
  PostgresModerationEventRepository,
  PostgresUserRepository
} from "./infrastructure/persistence/postgres-repositories.js";
import { TelegramChannelDriver } from "./infrastructure/channels/telegram/telegram-channel-driver.js";
import { mapTelegramInbound } from "./infrastructure/channels/telegram/telegram-mapper.js";
import { TelegramBotBridgeImpl } from "./infrastructure/channels/telegram/telegram-bot-bridge.js";
import { MiniAppServer } from "./infrastructure/http/mini-app-server.js";
import { API_PATHS } from "@anonymous-chat/shared/api";
import dotenv from "dotenv"
dotenv.config({ path: './src/.env' })

const IS_DEVELOPMENT = process.env.APP_MODE !== "production" && process.env.NODE_ENV !== "production";
const DATA_DIR = process.env.DATA_DIR ?? (IS_DEVELOPMENT ? ".data/development" : ".data");
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? `${DATA_DIR}/whatsapp-auth`;
const DATABASE_URL = process.env.DATABASE_URL;
const HTTP_PORT = Number(process.env.PORT ?? process.env.WEB_PORT ?? 3000);
const HTTP_HOST = process.env.HTTP_HOST ?? (IS_DEVELOPMENT ? "127.0.0.1" : "0.0.0.0");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SWEEP_INTERVAL_MS = 5_000;
const AI_URL = process.env.AI_URL || (IS_DEVELOPMENT ? undefined : "http://localhost:4000/api/chat2");

const WHATSAPP_ENABLED = IS_DEVELOPMENT
  ? process.env.ENABLE_WHATSAPP === "1"
  : process.env.ENABLE_WHATSAPP === "1" && process.env.DISABLE_WHATSAPP !== "1";
const WHATSAPP_PROVIDER = process.env.WHATSAPP_PROVIDER ?? "baileys";
const TELEGRAM_ENABLED = IS_DEVELOPMENT
  ? process.env.ENABLE_TELEGRAM === "1"
  : process.env.DISABLE_TELEGRAM !== "1";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function main(): Promise<void> {
  if (!DATABASE_URL && !(process.env.DB_USER)) {
    throw new Error("DATABASE_URL must be set to a PostgreSQL connection string.");
  }
  if (IS_DEVELOPMENT) {
    console.log("Development mode: local web simulator only; production data and chat accounts are untouched.");
    if (process.env.ENABLE_TELEGRAM === "1") console.warn("Development mode: connecting to the real Telegram bot because ENABLE_TELEGRAM=1.");
    if (process.env.ENABLE_WHATSAPP === "1") console.warn("Development mode: connecting to the real WhatsApp account because ENABLE_WHATSAPP=1.");
  }
  // ---- Persistence ---------------------------------------------------------
  const pool = process.env.DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 6543,
    database: process.env.DB_NAME,
    ssl: {
      rejectUnauthorized: false // Required for Supabase pooler connections
    }
  });
  pool.on("error", (error) => console.error("[database] Unexpected PostgreSQL pool error.", error));
  await applyMigrations(pool);
  const db = new PostgresDatabase(pool);
  const users = new PostgresUserRepository(db);
  const conversations = new PostgresConversationRepository(db);
  const queue = new PostgresMatchQueueRepository(db);
  const reports = new PostgresReportRepository(db);
  const points = new PostgresPointsRepository(db);
  const vipPlans = new VipPlanRegistry();
  vipPlans.register(new PointsVipPlanAdapter(points, users));
  const moderationEvents = new PostgresModerationEventRepository(db);
  const log = new InMemoryMessageLogRepository();

  // ---- Services ------------------------------------------------------------
  const ai = AI_URL
    ? new HttpAiService({ endpoint: AI_URL })
    : new StubAiService();
  const moderation = new RegexModerationService();

  // ---- Channels ------------------------------------------------------------
  const registry = new ChannelRegistry();

  const web = new WebChannelDriver({ port: HTTP_PORT, host: HTTP_HOST }, users);
  registry.register(web);
  if (WHATSAPP_PROVIDER !== "baileys" && WHATSAPP_PROVIDER !== "cloud-api") {
    throw new Error("WHATSAPP_PROVIDER must be either 'baileys' or 'cloud-api'.");
  }
  const cloudApi = WHATSAPP_ENABLED && WHATSAPP_PROVIDER === "cloud-api"
    ? new WhatsAppCloudApiDriver({
        accessToken: process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ?? "",
        appSecret: process.env.META_APP_SECRET ?? "",
        verifyToken: process.env.WHATSAPP_CLOUD_VERIFY_TOKEN ?? "",
        phoneNumberId: process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID ?? "",
        apiVersion: process.env.WHATSAPP_CLOUD_API_VERSION ?? ""
      }, fetch, users)
    : undefined;

  // ---- Application ---------------------------------------------------------
  const matching = new MatchmakingService(users, queue, conversations, MATCHMAKING_CONFIG);
  const moderatorConsoleUrl = process.env.MODERATOR_CONSOLE_URL ??
    (process.env.TELEGRAM_MINI_APP_URL ? `${new URL(process.env.TELEGRAM_MINI_APP_URL).origin}/moderator` : undefined);
  const app = new ChatApplication(
    users, conversations, registry, matching, moderation, ai, reports, log, points, moderationEvents,
    process.env.TELEGRAM_MINI_APP_URL, moderatorConsoleUrl, vipPlans
  );

  const admin = new AdminServer(
    {
      users,
      queue,
      conversations,
      reports,
      log,
      matching,
      moderationEvents,
      sendStaffMessage: (staffId, conversationId, text) => app.sendStaffMessage(staffId, conversationId, text),
      endStaffSession: (staffId, conversationId) => app.endStaffSession(staffId, conversationId)
    },
    { matchmaking: MATCHMAKING_CONFIG, authToken: ADMIN_TOKEN }
  );
  admin.validateConfiguration();

  // The single receive callback every driver funnels into.
  const receive = async (event: Parameters<ChatApplication["receive"]>[0]) => {
    await app.receive(event);
    await admin.publishLiveUpdates().catch((error) => console.error("[admin] Live update publish failed.", error));
  };
  if (cloudApi) await cloudApi.start(receive);

  let miniApp: MiniAppServer | undefined;
  if (TELEGRAM_TOKEN && (!IS_DEVELOPMENT || TELEGRAM_ENABLED)) {
    miniApp = new MiniAppServer(users, points, { botToken: TELEGRAM_TOKEN }, vipPlans);
    miniApp.validateConfiguration();
  }

  // ---- Start non-chat infrastructure first --------------------------------
  await web.start(receive, (req, res) => {
    void (async () => {
      if (cloudApi && await cloudApi.handleHttpRequest(req, res)) return;
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname.startsWith(API_PATHS.miniApp.prefix) && miniApp) {
        await miniApp.handleRequest(req, res);
        return;
      }
      await admin.handleRequest(req, res);
    })().catch((error) => {
      console.error("[http] Request handler failed.", error);
      if (!res.headersSent) res.statusCode = 500;
      if (!res.writableEnded) res.end("Internal server error.");
    });
  });
  admin.attachWebSocket(web.httpServer);

  // ---- Telegram ------------------------------------------------------------
  let telegram: TelegramChannelDriver | undefined;
  if (TELEGRAM_ENABLED) {
    const token = TELEGRAM_TOKEN;
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
    if (cloudApi) {
      registry.register(cloudApi);
      console.log("WhatsApp Cloud API driver started.");
    } else {
      const bridge = new BaileysSocketBridgeImpl({ authDir: AUTH_DIR });
      whatsapp = new WhatsAppChannelDriver(bridge, mapBaileysInbound);
      await whatsapp.start(receive);
      registry.register(whatsapp);
      console.warn("[whatsapp] Baileys is an unofficial integration. Use a dedicated number; bans and disconnections cannot be ruled out.");
      console.log(`WhatsApp Baileys driver started. Auth state in ${AUTH_DIR}.`);
    }
  } else {
    console.log(IS_DEVELOPMENT
      ? "WhatsApp disabled in development (set ENABLE_WHATSAPP=1 to connect intentionally)."
      : "WhatsApp disabled (set ENABLE_WHATSAPP=1 to connect intentionally).");
  }

  console.log("State stored in PostgreSQL.");
  console.log(
    `AI fallback: ${MATCHMAKING_CONFIG.aiFallback.enabled ? "enabled" : "disabled"} (source: ${AI_URL ?? "stub"}).`
  );

  // ---- Matchmaking sweep ---------------------------------------------------
  await app.runMatchmakingSweep();
  await admin.publishLiveUpdates();
  const sweepTimer = setInterval(() => {
    void app.runMatchmakingSweep()
      .then(() => admin.publishLiveUpdates())
      .catch((error) => console.error("[sweep] Failed.", error));
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
      cloudApi?.stop(),
      telegram?.stop(),
      admin.close(),
      web.stop(),
      db.close(),
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
