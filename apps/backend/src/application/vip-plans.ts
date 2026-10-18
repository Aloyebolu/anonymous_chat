import type { VipPlan } from "@anonymous-chat/shared/contracts";
import type { UserId } from "../domain/types.js";
import type { PointsRepository, UserRepository } from "../ports/repositories.js";

export type VipPurchaseResult = "purchased" | "duplicate" | "insufficient" | "unavailable";

export interface VipPlanAdapter {
  readonly method: string;
  plans(): readonly VipPlan[];
  purchase(userId: UserId, planId: string, eventId: string): Promise<VipPurchaseResult>;
}

const POINTS_PLANS: readonly VipPlan[] = [
  {
    id: "vip-week",
    name: "One week",
    description: "VIP matching for 7 days",
    method: "points",
    currency: "points",
    amount: 30,
    durationDays: 7
  },
  {
    id: "vip-month",
    name: "One month",
    description: "VIP matching for 30 days",
    method: "points",
    currency: "points",
    amount: 100,
    durationDays: 30
  },
  {
    id: "vip-quarter",
    name: "Three months",
    description: "VIP matching for 90 days",
    method: "points",
    currency: "points",
    amount: 270,
    durationDays: 90
  }
];

export class PointsVipPlanAdapter implements VipPlanAdapter {
  readonly method = "points";

  constructor(
    private readonly points: PointsRepository,
    private readonly users: UserRepository
  ) {}

  plans(): readonly VipPlan[] {
    return POINTS_PLANS;
  }

  async purchase(userId: UserId, planId: string, eventId: string): Promise<VipPurchaseResult> {
    const plan = POINTS_PLANS.find((candidate) => candidate.id === planId);
    const profile = await this.users.profileFor(userId);
    if (!plan || !profile) return "unavailable";

    const spent = await this.points.spend(userId, eventId, plan.amount);
    if (spent === "insufficient") return "insufficient";
    if (spent === "duplicate") return "duplicate";

    const base = Math.max(Date.now(), profile.vipUntil ? Date.parse(profile.vipUntil) : 0);
    const vipUntil = new Date(base + plan.durationDays * 86_400_000).toISOString();
    await this.users.saveProfile({ ...profile, vipUntil });
    return "purchased";
  }
}

export class VipPlanRegistry {
  private readonly adapters = new Map<string, VipPlanAdapter>();

  register(adapter: VipPlanAdapter): void {
    if (this.adapters.has(adapter.method)) throw new Error(`VIP payment method already registered: ${adapter.method}`);
    this.adapters.set(adapter.method, adapter);
  }

  plans(): readonly VipPlan[] {
    return [...this.adapters.values()].flatMap((adapter) => adapter.plans());
  }

  async purchase(userId: UserId, method: string, planId: string, eventId: string): Promise<VipPurchaseResult> {
    return this.adapters.get(method)?.purchase(userId, planId, eventId) ?? "unavailable";
  }
}
