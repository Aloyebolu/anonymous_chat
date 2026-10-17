import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isVipProfile, VIP_CONFIG, userId, type UserProfile } from "../../domain/types.js";
import type { PointsRepository, UserRepository } from "../../ports/repositories.js";
import { applyCors, handlePreflight } from "./cors.js";

const DAILY_CHECK_IN_POINTS = 3;
const PROFILE_COMPLETE_POINTS = 5;
const MAX_INIT_DATA_AGE_SECONDS = 60 * 60;

interface TelegramUser {
  readonly id: number;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface MiniAppServerOptions {
  readonly botToken: string;
}

export class MiniAppServer {
  constructor(
    private readonly users: UserRepository,
    private readonly points: PointsRepository,
    private readonly options: MiniAppServerOptions
  ) {}

  validateConfiguration(): void {
    if (!this.options.botToken) throw new Error("TELEGRAM_BOT_TOKEN is required for the Mini App API.");
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.handle(req, res);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") return handlePreflight(res);
    applyCors(res);
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      const initData = parseAuthorization(req.headers.authorization);
      const telegramUser = initData ? verifyTelegramInitData(initData, this.options.botToken) : undefined;
      if (!telegramUser) return json(res, 401, { error: "Invalid or expired Telegram session." });
      const identity = await this.users.findOrCreate({ channel: "telegram", externalId: String(telegramUser.id) });
      const profile = await this.users.profileFor(identity.userId);

      if (req.method === "GET" && url.pathname === "/api/miniapp/me") {
        if (!profile) return json(res, 409, { error: "Complete onboarding in the bot before using the Mini App." });
        return json(res, 200, { profile, points: await this.points.balance(identity.userId), vip: isVipProfile(profile), vipCostPoints: VIP_CONFIG.pointsCost, vipDays: VIP_CONFIG.durationDays, vipPaymentMethods: ["points"] });
      }

      if (!profile) return json(res, 409, { error: "Complete onboarding in the bot before using the Mini App." });

      if (req.method === "POST" && url.pathname === "/api/miniapp/daily-check-in") {
        const today = new Date().toISOString().slice(0, 10);
        const earned = await this.points.awardActivity(identity.userId, `daily-check-in:${identity.userId}:${today}`, DAILY_CHECK_IN_POINTS);
        return json(res, 200, { earned, points: await this.points.balance(identity.userId) });
      }

      if (req.method === "PATCH" && url.pathname === "/api/miniapp/profile") {
        const body = await readJson(req);
        if (!body) return json(res, 400, { error: "Invalid JSON body." });
        const next = validateProfileUpdate(body, profile, isVipProfile(profile));
        if (!next) return json(res, 400, { error: "Some profile fields are invalid. Age must be 18 or older." });
        await this.users.saveProfile({ ...profile, ...next });
        const isComplete = Boolean(next.displayName && next.age && next.language && next.country);
        const earned = isComplete ? await this.points.awardActivity(identity.userId, `profile-complete:${identity.userId}`, PROFILE_COMPLETE_POINTS) : 0;
        return json(res, 200, { profile: await this.users.profileFor(identity.userId), earned, points: await this.points.balance(identity.userId) });
      }

      if (req.method === "POST" && url.pathname === "/api/miniapp/vip") {
        const body = await readJson(req);
        const key = typeof body?.idempotencyKey === "string" && /^[a-zA-Z0-9-]{8,100}$/.test(body.idempotencyKey)
          ? body.idempotencyKey : undefined;
        if (!key) return json(res, 400, { error: "A valid purchase key is required." });
        const result = await this.points.spend(identity.userId, `miniapp-vip:${identity.userId}:${key}`, VIP_CONFIG.pointsCost);
        if (result === "insufficient") return json(res, 402, { error: "Not enough points.", points: await this.points.balance(identity.userId) });
        if (result === "spent") {
          const base = Math.max(Date.now(), profile.vipUntil ? Date.parse(profile.vipUntil) : 0);
          await this.users.saveProfile({ ...profile, vipUntil: new Date(base + VIP_CONFIG.durationDays * 86_400_000).toISOString() });
        }
        const refreshed = await this.users.profileFor(identity.userId);
        return json(res, 200, { purchased: result === "spent", profile: refreshed, points: await this.points.balance(identity.userId) });
      }

      return json(res, 404, { error: "Not found." });
    } catch (error) {
      console.error("[mini-app] Request failed.", error);
      return json(res, 500, { error: "Request failed." });
    }
  }
}

const parseAuthorization = (authorization: string | undefined): string | undefined => {
  if (!authorization?.startsWith("tma ")) return undefined;
  return authorization.slice(4);
};

const verifyTelegramInitData = (initData: string, botToken: string): TelegramUser | undefined => {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash) || !Number.isFinite(authDate) || authDate > now + 60 || now - authDate > MAX_INIT_DATA_AGE_SECONDS) return undefined;
  params.delete("hash");
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const actual = Buffer.from(receivedHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    const parsed = JSON.parse(params.get("user") ?? "null") as TelegramUser | null;
    return parsed && Number.isSafeInteger(parsed.id) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

type MutableProfileUpdate = { -readonly [Key in keyof UserProfile]?: UserProfile[Key] };

const validateProfileUpdate = (
  body: Record<string, unknown>,
  existing: UserProfile,
  vip: boolean
): MutableProfileUpdate | undefined => {
  const update: MutableProfileUpdate = {};
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || body.displayName.trim().length > 28) return undefined;
    update.displayName = body.displayName.trim() || undefined;
  }
  if (body.showName !== undefined) {
    if (typeof body.showName !== "boolean") return undefined;
    update.showName = body.showName;
  }
  if (body.age !== undefined) {
    if (!Number.isInteger(body.age) || Number(body.age) < 18 || Number(body.age) > 99) return undefined;
    update.age = Number(body.age);
  }
  if (body.language !== undefined) {
    if (typeof body.language !== "string" || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(body.language)) return undefined;
    update.language = body.language;
  }
  if (body.country !== undefined) {
    if (typeof body.country !== "string" || body.country.trim().length < 2 || body.country.trim().length > 56) return undefined;
    update.country = body.country.trim();
  }
  if (body.preferredGender !== undefined) {
    if (!["male", "female", "nonbinary", "any"].includes(String(body.preferredGender))) return undefined;
    update.preferredGender = body.preferredGender as typeof existing.preferredGender;
  }
  if (body.preferredCountry !== undefined) {
    if (typeof body.preferredCountry !== "string" || body.preferredCountry.trim().length > 56) return undefined;
    update.preferredCountry = body.preferredCountry.trim() || undefined;
  }
  if (body.gender !== undefined) {
    if (!vip) return undefined;
    if (!["male", "female", "nonbinary"].includes(String(body.gender))) return undefined;
    update.gender = body.gender as typeof existing.gender;
  }
  return update;
};

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown> | undefined> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 16_384) return undefined;
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { return undefined; }
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.end(JSON.stringify(body));
};
