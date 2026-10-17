export type ChannelType = string;

export interface OutboundMessageText { readonly kind: "text"; readonly text: string }
export interface OutboundMessageInteraction {
  readonly kind: "interaction";
  readonly text: string;
  readonly actions: readonly { readonly id: string; readonly label: string }[];
}
export type OutboundMessage = OutboundMessageText | OutboundMessageInteraction;

export interface AdminUser {
  readonly userId: string;
  readonly channel: ChannelType;
  readonly externalId: string;
  readonly eligibility: string;
  readonly profile: { gender: string; country: string; preferredGender: string; preferredCountry?: string; priorityTier?: number; shadowBanned?: boolean; moderator?: boolean; moderatorAvailable?: boolean } | null;
  readonly waitingMs: number | null;
  readonly conversationId: string | null;
}

export interface AdminConversation {
  readonly id: string;
  readonly status: "active" | "ended";
  readonly kind: "human" | "ai" | "operator";
  readonly createdAt: string;
  readonly participants: readonly { userId: string; channel: ChannelType; externalId: string }[];
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

export interface MessageLogEntry {
  readonly id: string;
  readonly conversationId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly text: string;
  readonly timestamp: string;
  readonly direction: "inbound" | "outbound";
}
