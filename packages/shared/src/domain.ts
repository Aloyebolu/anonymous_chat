export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };
export type UserId = Brand<string, "UserId">;
export type ConversationId = Brand<string, "ConversationId">;

export const userId = (value: string): UserId => value as UserId;
export const conversationId = (value: string): ConversationId => value as ConversationId;

export type ChannelType = string;

export interface CommunicationIdentity {
  readonly userId: UserId;
  readonly channel: ChannelType;
  readonly externalId: string;
}

export type Gender = "male" | "female" | "nonbinary";
export type GenderPreference = Gender | "any";

export interface UserProfile {
  readonly userId: UserId;
  readonly gender: Gender;
  readonly country: string;
  readonly preferredGender: GenderPreference;
  readonly preferredCountry?: string;
  readonly priorityTier?: number;
  readonly keeper?: boolean;
  readonly shadowBanned?: boolean;
  readonly displayName?: string;
  readonly showName?: boolean;
  readonly age?: number;
  readonly language?: string;
  readonly vipUntil?: string;
  readonly moderator?: boolean;
  readonly moderatorAvailable?: boolean;
  readonly moderatorChannels?: readonly string[];
  readonly moderatorAccessHash?: string;
  readonly moderatorLinkCodeHash?: string;
  readonly moderatorLinkCodeExpiresAt?: string;
}

export const isVipProfile = (profile: UserProfile | undefined, now = Date.now()): boolean =>
  Boolean(profile?.vipUntil && Date.parse(profile.vipUntil) > now);

export interface Eligibility {
  readonly userId: UserId;
  readonly status: "eligible" | "ineligible" | "pending";
  readonly method: "self-declared-18-plus" | "future-verified";
  readonly verifiedAt: Date;
}

export type ProfileSettingsField = "displayName" | "age" | "country" | "preferredCountry" | "language";
export type OnboardingStep = "awaiting-gender" | "awaiting-country" | "awaiting-preference" | "editing-profile";

export interface ProfileDraft {
  readonly userId: UserId;
  readonly step: OnboardingStep;
  readonly settingsField?: ProfileSettingsField;
  readonly gender?: Gender;
  readonly country?: string;
}

export interface Participant {
  readonly userId: UserId;
  readonly identity: CommunicationIdentity;
}

export interface Conversation {
  readonly id: ConversationId;
  readonly participants: readonly [Participant, Participant];
  readonly status: "active" | "ended";
  readonly createdAt: Date;
  readonly kind?: "human" | "ai" | "operator";
}

export interface Report {
  readonly id: string;
  readonly conversationId: ConversationId;
  readonly reporterId: UserId;
  readonly reportedId: UserId;
  readonly reason: string;
  readonly createdAt: Date;
}

export interface ModerationEvent {
  readonly id: string;
  readonly userId: UserId;
  readonly reason: string;
  readonly createdAt: Date;
  readonly messageLength: number;
  readonly score: number;
}

export interface MessageLogEntry {
  readonly id: string;
  readonly conversationId: ConversationId;
  readonly fromUserId: UserId;
  readonly toUserId: UserId;
  readonly text: string;
  readonly timestamp: Date;
  readonly direction: "inbound" | "outbound";
}
