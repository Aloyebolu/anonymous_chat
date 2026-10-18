import type { OutboundMessage } from "./channel-contracts.js";
import type { UserProfile } from "./domain.js";

export type WebOutboundMessage = Extract<OutboundMessage, { readonly kind: "text" | "interaction" | "media" }>;
export type WebStreamEvent =
  | (WebOutboundMessage & { readonly messageId: string })
  | { readonly kind: "delete"; readonly messageId: string };
export type MiniAppProfile = Pick<
  UserProfile,
  "gender" | "country" | "preferredGender" | "preferredCountry" | "displayName" |
  "showName" | "age" | "language" | "vipUntil"
>;

export interface VipPlan {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly method: string;
  readonly currency: string;
  readonly amount: number;
  readonly durationDays: number;
}

export interface ModeratorLiveState {
  readonly available: boolean;
  readonly channels: readonly string[];
  readonly connectedChannels: readonly string[];
  readonly activeConversationId: string | null;
  readonly participant?: {
    readonly userId: string;
    readonly channel: string;
    readonly displayName?: string;
    readonly age?: number;
    readonly gender: string;
    readonly country: string;
    readonly preferredGender: string;
    readonly preferredCountry?: string;
  };
}

export interface AdminLiveUpdate {
  readonly type: "admin-update";
  readonly state: AdminState;
  readonly reports: readonly AdminReport[];
  readonly reportedUsers: readonly ReportedUserSummary[];
  readonly moderationEvents: readonly ModerationEventSummary[];
  readonly watchLogs: Readonly<Record<string, readonly MessageLogEntryDto[]>>;
}

export interface AdminUser {
  readonly userId: string;
  readonly channel: string;
  readonly externalId: string;
  readonly eligibility: string;
  readonly profile: {
    readonly gender: string;
    readonly country: string;
    readonly preferredGender: string;
    readonly preferredCountry?: string;
    readonly priorityTier?: number;
    readonly shadowBanned?: boolean;
    readonly moderator?: boolean;
    readonly moderatorAvailable?: boolean;
  } | null;
  readonly waitingMs: number | null;
  readonly conversationId: string | null;
}

export interface AdminConversation {
  readonly id: string;
  readonly status: "active" | "ended";
  readonly kind: "human" | "ai" | "operator";
  readonly createdAt: string;
  readonly participants: readonly { readonly userId: string; readonly channel: string; readonly externalId: string }[];
}

export interface AdminReport {
  readonly id: string;
  readonly conversationId: string;
  readonly reporterId: string;
  readonly reportedId: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface AdminState {
  readonly generatedAt: string;
  readonly matchmaking: unknown;
  readonly aiThresholdMs: number;
  readonly queueSize: number;
  readonly users: readonly AdminUser[];
  readonly watchedConversationIds: readonly string[];
  readonly conversations: readonly AdminConversation[];
}

export interface MessageLogEntryDto {
  readonly id: string;
  readonly conversationId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly text: string;
  readonly timestamp: string;
  readonly direction: "inbound" | "outbound";
}

export interface ReportedUserSummary {
  readonly reportedUserId: string;
  readonly reports: number;
  readonly latestReportAt: string;
}

export interface ModerationEventSummary {
  readonly id: string;
  readonly userId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly messageLength: number;
  readonly score: number;
}
