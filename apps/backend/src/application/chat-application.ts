import {
  AI_CHANNEL,
  conversationId as brandConversationId,
  isVipProfile,
  type CommunicationIdentity,
  type Conversation,
  type Gender,
  type GenderPreference,
  type ProfileSettingsField,
  type UserId,
  type UserProfile
} from "../domain/types.js";
import type {
  ChannelRegistry,
  InboundEvent,
  MediaPayload,
  OutboundMessage,
  PaymentReceipt
} from "../ports/channels.js";
import type { ConversationRepository, PointsRepository, UserRepository } from "../ports/repositories.js";
import type { AiService } from "../ports/ai.js";
import type { ModerationService } from "../ports/moderation.js";
import type { MessageLogRepository, ReportRepository } from "../ports/reports.js";
import type { ModerationEventRepository } from "../ports/moderation-events.js";
import { escapeHtml } from "@anonymous-chat/shared/rich-text";
import { AI_PERSONA, MSG } from "./messages.js";
import { MatchmakingService } from "./matchmaking.js";
import type { VipPlanRegistry } from "./vip-plans.js";

const MAX_MESSAGE_LENGTH = 4000;
const RATE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 10;
const AI_EXTERNAL_ID_ALIAS = AI_CHANNEL;

const recipient = (identity: CommunicationIdentity) => ({
  channel: identity.channel,
  externalId: identity.externalId
});

const genderActions = [
  { id: "gender:male", label: "Male" },
  { id: "gender:female", label: "Female" },
  { id: "gender:nonbinary", label: "Other" }
] as const;

const preferenceActions = [
  { id: "preference:male", label: "Male" },
  { id: "preference:female", label: "Female" },
  { id: "preference:any", label: "Any" }
] as const;

type ConversationGate =
  | {
      readonly ok: true;
      readonly conversation: Conversation;
      readonly partner: { readonly userId: UserId; readonly identity: CommunicationIdentity };
    }
  | { readonly ok: false; readonly reason: string };

type MessageReference = {
  readonly conversationId: Conversation["id"];
  readonly fromUserId: UserId;
  readonly toUserId: UserId;
  readonly sourceIdentity: CommunicationIdentity;
  readonly forwardedIdentity: CommunicationIdentity;
  readonly sourceMessageId: string;
  readonly forwardedMessageId?: string;
};

export class ChatApplication {
  constructor(
    private readonly users: UserRepository,
    private readonly conversations: ConversationRepository,
    private readonly channels: ChannelRegistry,
    private readonly matching: MatchmakingService,
    private readonly moderation: ModerationService,
    private readonly ai: AiService,
    private readonly reports: ReportRepository,
    private readonly log: MessageLogRepository,
    private readonly points?: PointsRepository,
    private readonly moderationEvents?: ModerationEventRepository,
    private readonly miniAppUrl?: string,
    private readonly moderatorConsoleUrl?: string,
    private readonly vipPlans?: VipPlanRegistry
  ) {}

  private readonly recentMessages = new Map<UserId, { at: number; text: string }[]>();
  private readonly settingsMessageIds = new Map<string, string>();
  private readonly messageReferences = new Map<string, MessageReference>();

  // ─── Inbound dispatch ───────────────────────────────────────────────────

  async receive(event: InboundEvent): Promise<void> {
    let identity = await this.users.findOrCreate({
      channel: event.channel,
      externalId: event.identity.externalId
    });

    if (event.kind === "message" && event.content.kind === "text") {
      const link = event.content.text.trim().match(/^\/modlink\s+([a-f0-9]{12})$/i);
      if (link) {
        const linkedUserId = await this.users.claimModeratorIdentity?.(identity, link[1]);
        await this.send(identity, { kind: "text", text: linkedUserId ? MSG.moderatorLinked : MSG.moderatorLinkInvalid });
        return;
      }
    }

    if ((await this.users.profileFor(identity.userId))?.shadowBanned) return;

    if (event.kind === "command") return this.handleCommand(identity, event.command);
    if (event.kind === "action") return this.handleAction(identity, event.actionId);
    if (event.kind === "reaction") return this.handleReaction(identity, event.targetMessageId, event.emoji);
    if (event.kind === "edit") return this.handleNativeEdit(identity, event.targetMessageId, event.text);
    if (event.kind === "payment") return this.handlePayment(identity, event.receipt);

    // event.kind === "message"
    if (event.content.kind === "media") return this.handleMedia(identity, event.content.media, event.content.caption, event.externalMessageId, event.content.replyToMessageId);
    return this.handleMessage(identity, event.content.text, event.externalMessageId, event.content.replyToMessageId);
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  async editWebMessage(username: string, messageId: string, text: string): Promise<void> {
    const identity = await this.users.identityForChannelExternalId("web", username);
    if (!identity) throw new Error("Web account was not found.");
    const reference = this.messageReferences.get(this.messageReferenceKey(identity, messageId));
    if (!reference || reference.fromUserId !== identity.userId || reference.toUserId === identity.userId ||
      !reference.forwardedMessageId) {
      throw new Error("Only your own messages in the active conversation can be edited.");
    }
    const conversation = await this.conversations.byId(reference.conversationId);
    if (!conversation || conversation.status !== "active" ||
      !conversation.participants.some((participant) => participant.userId === identity.userId)) {
      throw new Error("The message is no longer in an active conversation.");
    }
    const recipient = conversation.participants.find((participant) => participant.userId === reference.toUserId);
    if (!recipient || recipient.identity.channel !== reference.forwardedIdentity.channel ||
      recipient.identity.externalId !== reference.forwardedIdentity.externalId) {
      throw new Error("The message recipient no longer matches the active conversation.");
    }
    const driver = this.channels.driverFor(recipient.identity.channel);
    if (!driver.capabilities.messageEditing || !driver.editMessage) {
      throw new Error(`Message editing is not supported by ${recipient.identity.channel}.`);
    }
    await driver.editMessage(recipient.identity, reference.forwardedMessageId, { kind: "text", text: escapeHtml(text), format: "html" });
    const entries = this.log.entriesFor(reference.conversationId);
    const entry = entries.find((candidate) => candidate.externalMessageId === messageId);
    if (entry) this.log.update({ ...entry, text });
  }

  async reactWebMessage(username: string, messageId: string, emoji: string): Promise<void> {
    const identity = await this.users.identityForChannelExternalId("web", username);
    if (!identity) throw new Error("Web account was not found.");
    const reference = this.findMessageReference(messageId, identity);
    if (!reference || reference.fromUserId === identity.userId) {
      throw new Error("You can only react to a message from your active conversation partner.");
    }
    await this.applyReaction(reference, identity.userId, emoji);
  }

  async setProfile(
    identity: CommunicationIdentity,
    profile: Omit<UserProfile, "userId">
  ): Promise<void> {
    const existing = await this.users.profileFor(identity.userId);
    await this.users.saveProfile({ ...existing, ...profile, userId: identity.userId });
  }

  async runMatchmakingSweep(): Promise<void> {
    const conversations = await this.matching.sweep();
    await this.notifyMatches(conversations);
  }

  async sendStaffMessage(staffId: UserId, conversationIdValue: string, rawText: string): Promise<boolean> {
    const conversation = await this.conversations.byId(brandConversationId(conversationIdValue));
    if (!conversation || conversation.status !== "active" || conversation.kind !== "operator" ||
      !conversation.participants.some((participant) => participant.userId === staffId)) return false;
    const profile = await this.users.profileFor(staffId);
    if (!profile?.moderator && !profile?.operator) return false;

    const text = rawText.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) return false;
    const check = this.moderation.inspect(text);
    if (check.blocked) {
      await this.recordModeration(staffId, `staff-message:${check.reason ?? "restricted-content"}`, text.length, 100);
      return false;
    }

    const participant = conversation.participants.find((entry) => entry.userId !== staffId);
    if (!participant) return false;
    this.log.watch(conversation.id);
    this.log.append({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      fromUserId: staffId,
      toUserId: participant.userId,
      text,
      timestamp: new Date(),
      direction: "outbound"
    });
    await this.send(participant.identity, { kind: "text", text: escapeHtml(text) });
    return true;
  }

  async endStaffSession(staffId: UserId, conversationIdValue: string): Promise<boolean> {
    const conversation = await this.conversations.byId(brandConversationId(conversationIdValue));
    if (!conversation || conversation.status !== "active" || conversation.kind !== "operator" ||
      !conversation.participants.some((participant) => participant.userId === staffId)) return false;
    const profile = await this.users.profileFor(staffId);
    if (!profile?.moderator && !profile?.operator) return false;
    const participant = conversation.participants.find((entry) => entry.userId !== staffId);
    if (!participant) return false;

    await this.conversations.save({ ...conversation, status: "ended" });
    await this.send(participant.identity, { kind: "text", text: MSG.otherEnded });
    return true;
  }

  // ─── Matchmaking notifications ──────────────────────────────────────────

  private async notifyMatches(conversations: readonly Conversation[]): Promise<void> {
    for (const conversation of conversations) {
      if (conversation.kind === "operator") this.log.watch(conversation.id);
      const aiParticipant = conversation.participants.find(
        (p) => p.identity.channel === AI_CHANNEL
      );
      await Promise.all(
        conversation.participants.map(async (participant) => {
          try {
            if (participant.identity.channel === AI_CHANNEL) return;
            if (aiParticipant) return await this.send(participant.identity, { kind: "text", text: MSG.matchWithAi });
            const other = conversation.participants.find((candidate) => candidate.userId !== participant.userId);
            const participantProfile = await this.users.profileFor(participant.userId);
            if (conversation.kind === "operator" && participantProfile?.operator) return;
            if (conversation.kind === "operator" && participantProfile?.moderator) {
              const otherProfile = other ? await this.users.profileFor(other.userId) : undefined;
              const name = otherProfile?.displayName?.trim() || "Anonymous user";
              const gender = otherProfile?.gender ?? "Not provided";
              const age = otherProfile?.age === undefined ? "Not provided" : String(otherProfile.age);
              const text = MSG.moderatorAssignment(
                other?.identity.channel ?? "unknown",
                name,
                gender,
                age,
                this.safeModeratorConsoleUrl()
              );
              await this.send(participant.identity, { kind: "text", text });
              return await this.send(participant.identity, { kind: "text", text: MSG.moderatorWelcome });
            }
            const [viewerProfile, otherProfile] = await Promise.all([
              this.users.profileFor(participant.userId),
              other ? this.users.profileFor(other.userId) : Promise.resolve(undefined)
            ]);
            const visibleGender = isVipProfile(viewerProfile) && otherProfile ? otherProfile.gender : "VIP only";
            const visibleName = otherProfile?.showName ? otherProfile.displayName : undefined;
            const text = MSG.matchConnected(visibleGender, visibleName);
            await this.send(participant.identity, { kind: "text", text });
          } catch (error) {
            console.error("[matchmaking] Conversation created but participant notification failed.", {
              conversationId: conversation.id,
              participantId: participant.userId,
              channel: participant.identity.channel,
              error
            });
          }
        })
      );
    }
  }

  // ─── Commands ───────────────────────────────────────────────────────────

  private async handleCommand(identity: CommunicationIdentity, command: string): Promise<void> {
    if (["next", "leave", "end", "report", "block"].includes(command) &&
      await this.rejectAmbiguousStaffAction(identity)) return;
    if (command === "start") return this.startOnboarding(identity);
    if (command === "confirm-adult") return this.handleAction(identity, "confirm-adult");
    if (command === "find") return this.find(identity);
    if (command === "next") return this.next(identity);
    if (command === "leave" || command === "end") return this.leave(identity);
    if (command === "vip") return this.showVip(identity);
    if (command === "app") return this.openMiniApp(identity);
    if (command === "settings") return this.showSettings(identity);
    if (command === "report") return this.report(identity);
    if (command === "block") return this.endWithReason(identity, MSG.blocked);
    if (command === "points") {
      const balance = await this.points?.balance(identity.userId) ?? 0;
      return this.send(identity, { kind: "text", text: MSG.pointsBalance(balance) });
    }
    if (command === "help") return this.help(identity);
    return this.send(identity, { kind: "text", text: MSG.help });
  }

  private async help(identity: CommunicationIdentity): Promise<void> {
    const eligibility = await this.users.eligibilityFor(identity.userId);
    const profile = await this.users.profileFor(identity.userId);
    let text: string;
    if (eligibility?.status !== "eligible" || !profile) text = MSG.helpNew;
    else if (await this.conversations.activeFor(identity.userId)) text = MSG.helpChat;
    else if (await this.matching.isWaiting(identity.userId)) text = MSG.helpWaiting;
    else text = MSG.helpReady;
    await this.send(identity, { kind: "text", text });
  }

  private async showVip(identity: CommunicationIdentity): Promise<void> {
    const profile = await this.users.profileFor(identity.userId);
    if (!profile) return this.send(identity, { kind: "text", text: MSG.vipProfileRequired });
    if (isVipProfile(profile)) return this.send(identity, { kind: "text", text: MSG.vipActive(profile.vipUntil!.slice(0, 10)) });
    const plans = this.vipPlans?.plans().filter((plan) => plan.method === "points") ?? [];
    if (plans.length === 0) return this.send(identity, { kind: "text", text: MSG.miniAppUnavailable });
    const balance = await this.points?.balance(identity.userId) ?? 0;
    return this.send(identity, {
      kind: "interaction",
      text: MSG.vipOffer(balance),
      actions: plans.map((plan) => ({
        id: `vip:buy:${plan.method}:${plan.id}`,
        label: MSG.vipBuyLabel(plan.name, plan.amount, plan.durationDays)
      }))
    });
  }

  private async showSettings(identity: CommunicationIdentity): Promise<void> {
    const profile = await this.users.profileFor(identity.userId);
    if (!profile) {
      await this.send(identity, { kind: "text", text: MSG.profileRequired });
      return this.resumeOnboarding(identity);
    }
    await this.users.clearDraft(identity.userId);
    const actions = [
      { id: "settings:displayName", label: `Name · ${profile.displayName || "not set"}` },
      { id: "settings:age", label: `Age · ${profile.age ?? "not set"}` },
      { id: "settings:gender", label: `Gender · ${profile.gender}` },
      { id: "settings:country", label: `Country · ${profile.country}` },
      { id: "settings:preferredGender", label: `Match with · ${profile.preferredGender}` },
      { id: "settings:preferredCountry", label: `Preferred country · ${profile.preferredCountry || "any"}` },
      { id: "settings:language", label: `Language · ${profile.language || "en"}` },
      { id: "settings:showName", label: profile.showName ? "Hide name from matches" : "Show name to matches" },
      { id: "settings:done", label: "Done" }
    ];
    await this.sendSettingsInteraction(identity, { kind: "interaction", text: MSG.settingsPrompt, actions });
  }

  private async handleSettingsAction(identity: CommunicationIdentity, actionId: string): Promise<void> {
    await this.deleteSettingsMessage(identity);
    const [, field, value] = actionId.split(":");
    if (field === "done") {
      await this.users.clearDraft(identity.userId);
      return this.send(identity, { kind: "text", text: MSG.settingsSaved });
    }

    const profile = await this.users.profileFor(identity.userId);
    if (!profile) return this.send(identity, { kind: "text", text: MSG.profileRequired });

    const textFields: Partial<Record<ProfileSettingsField, string>> = {
      displayName: MSG.settingsAskDisplayName,
      age: MSG.settingsAskAge,
      country: MSG.settingsAskCountry,
      preferredCountry: MSG.settingsAskPreferredCountry,
      language: MSG.settingsAskLanguage
    };
    if (field && field in textFields) {
      await this.users.saveDraft({ userId: identity.userId, step: "editing-profile", settingsField: field as ProfileSettingsField });
      return this.send(identity, { kind: "text", text: textFields[field as ProfileSettingsField]! });
    }

    if (field === "gender" && !value) {
      if (!isVipProfile(profile)) return this.send(identity, { kind: "text", text: MSG.settingsGenderVip });
      return this.sendSettingsInteraction(identity, {
        kind: "interaction",
        text: "<b>Choose your gender</b>",
        actions: [
          { id: "settings:gender:male", label: "Male" },
          { id: "settings:gender:female", label: "Female" },
          { id: "settings:gender:nonbinary", label: "Non-binary" },
          { id: "settings:done", label: "Cancel" }
        ]
      });
    }

    if (field === "preferredGender" && !value) {
      return this.sendSettingsInteraction(identity, {
        kind: "interaction",
        text: "<b>Who would you like to match with?</b>",
        actions: [
          { id: "settings:preferredGender:male", label: "Male" },
          { id: "settings:preferredGender:female", label: "Female" },
          { id: "settings:preferredGender:nonbinary", label: "Non-binary" },
          { id: "settings:preferredGender:any", label: "Any" }
        ]
      });
    }

    if (field === "showName") {
      await this.users.saveProfile({ ...profile, showName: !profile.showName });
      return this.showSettings(identity);
    }

    if ((field === "gender" || field === "preferredGender") &&
      ["male", "female", "nonbinary", "any"].includes(value ?? "")) {
      if (field === "gender") {
        if (!isVipProfile(profile)) return this.send(identity, { kind: "text", text: MSG.settingsGenderVip });
        await this.users.saveProfile({ ...profile, gender: value as Gender });
      } else {
        await this.users.saveProfile({ ...profile, preferredGender: value as GenderPreference });
      }
      await this.send(identity, { kind: "text", text: MSG.settingsSaved });
      return this.showSettings(identity);
    }

    return this.showSettings(identity);
  }

  private async updateSettingFromText(identity: CommunicationIdentity, raw: string): Promise<void> {
    const draft = await this.users.draftFor(identity.userId);
    const field = draft?.step === "editing-profile" ? draft.settingsField : undefined;
    const profile = await this.users.profileFor(identity.userId);
    if (!field || !profile) {
      await this.users.clearDraft(identity.userId);
      return;
    }
    const value = raw.trim();
    let update: Partial<UserProfile>;
    switch (field) {
      case "displayName":
        if (value !== "-" && value.length > 28) return void await this.send(identity, { kind: "text", text: MSG.settingsInvalid });
        update = { displayName: value === "-" ? undefined : value || undefined };
        break;
      case "age": {
        const age = Number(value);
        if (!/^\d{2}$/.test(value) || !Number.isInteger(age) || age < 18 || age > 99) {
          return void await this.send(identity, { kind: "text", text: MSG.settingsInvalid });
        }
        update = { age };
        break;
      }
      case "country":
        if (value.length < 2 || value.length > 56) return void await this.send(identity, { kind: "text", text: MSG.settingsInvalid });
        update = { country: value };
        break;
      case "preferredCountry":
        if (value !== "-" && value.length > 56) return void await this.send(identity, { kind: "text", text: MSG.settingsInvalid });
        update = { preferredCountry: value === "-" ? undefined : value || undefined };
        break;
      case "language":
        if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)) return void await this.send(identity, { kind: "text", text: MSG.settingsInvalid });
        update = { language: value };
        break;
    }
    await this.users.saveProfile({ ...profile, ...update });
    await this.users.clearDraft(identity.userId);
    await this.send(identity, { kind: "text", text: MSG.settingsSaved });
    await this.showSettings(identity);
  }

  private safeModeratorConsoleUrl(): string | undefined {
    if (!this.moderatorConsoleUrl) return undefined;
    try {
      const url = new URL(this.moderatorConsoleUrl);
      return url.protocol === "https:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  private async buyVip(identity: CommunicationIdentity, method: string, planId: string): Promise<void> {
    if (!this.vipPlans) return this.send(identity, { kind: "text", text: MSG.vipProfileRequired });
    const purchaseId = `vip:${method}:${identity.channel}:${identity.externalId}:${crypto.randomUUID()}`;
    const result = await this.vipPlans.purchase(identity.userId, method, planId, purchaseId);
    if (result === "insufficient") return this.send(identity, { kind: "text", text: MSG.vipInsufficient });
    if (result === "unavailable") return this.send(identity, { kind: "text", text: MSG.miniAppUnavailable });
    if (result === "duplicate") return this.send(identity, { kind: "text", text: MSG.vipActive("current") });
    return this.send(identity, { kind: "text", text: MSG.vipPurchased });
  }

  private async openMiniApp(identity: CommunicationIdentity): Promise<void> {
    if (identity.channel !== "telegram" || !this.miniAppUrl || !this.miniAppUrl.startsWith("https://")) {
      return this.send(identity, { kind: "text", text: MSG.miniAppUnavailable });
    }
    return this.send(identity, {
      kind: "interaction",
      text: MSG.miniAppPrompt,
      actions: [{ id: "open-mini-app", label: MSG.miniAppButton, url: this.miniAppUrl }]
    });
  }

  private async handleAction(identity: CommunicationIdentity, actionId: string): Promise<void> {
    if (actionId.startsWith("vip:buy:")) {
      const [, , method, planId] = actionId.split(":");
      if (method && planId) return this.buyVip(identity, method, planId);
    }
    if (actionId.startsWith("settings:")) return this.handleSettingsAction(identity, actionId);
    if (actionId === "confirm-adult") {
      await this.users.saveEligibility({
        userId: identity.userId,
        status: "eligible",
        method: "self-declared-18-plus",
        verifiedAt: new Date()
      });
      await this.users.saveDraft({ userId: identity.userId, step: "awaiting-gender" });
      return this.send(identity, { kind: "interaction", text: MSG.askGender, actions: genderActions });
    }

    if (actionId.startsWith("gender:")) {
      const gender = actionId.slice("gender:".length) as Gender;
      await this.users.saveDraft({ userId: identity.userId, step: "awaiting-country", gender });
      return this.send(identity, { kind: "text", text: MSG.askCountry });
    }

    if (actionId.startsWith("preference:")) {
      const preferredGender = actionId.slice("preference:".length) as GenderPreference;
      const draft = await this.users.draftFor(identity.userId);
      if (!draft?.gender || !draft.country) return this.resumeOnboarding(identity);
      await this.users.saveProfile({
        userId: identity.userId,
        gender: draft.gender,
        country: draft.country,
        preferredGender
      });
      await this.users.clearDraft(identity.userId);
      return this.send(identity, { kind: "text", text: MSG.profileComplete });
    }

    return this.send(identity, { kind: "text", text: MSG.help });
  }

  // ─── Inbound text ───────────────────────────────────────────────────────

  private async handleMessage(identity: CommunicationIdentity, raw: string, externalMessageId: string, replyToMessageId?: string): Promise<void> {
    const text = raw.length > MAX_MESSAGE_LENGTH ? raw.slice(0, MAX_MESSAGE_LENGTH) : raw;

    // Onboarding draft flow runs before the conversation gate.
    const draft = await this.users.draftFor(identity.userId);
    if (draft?.step === "editing-profile") return this.updateSettingFromText(identity, raw);
    if (draft?.step === "awaiting-country") {
      await this.users.saveDraft({ ...draft, step: "awaiting-preference", country: text.trim() });
      return this.send(identity, {
        kind: "interaction",
        text: MSG.askPreference,
        actions: preferenceActions
      });
    }

    if (await this.rejectAmbiguousStaffAction(identity)) return;

    const gate = await this.resolveConversationFor(identity);
    if (!gate.ok) {
      if (gate.reason) await this.send(identity, { kind: "text", text: gate.reason });
      return;
    }

    const { conversation, partner } = gate;
    const forwardedReplyMessageId = partner.identity.channel === AI_CHANNEL
      ? undefined
      : this.forwardedReplyTarget(identity, replyToMessageId, conversation.id);

    const moderation = this.moderation.inspect(text);
    if (moderation.blocked) {
      await this.recordModeration(identity.userId, `contact:${moderation.reason ?? "restricted-content"}`, text.length, 100);
      await this.send(identity, { kind: "text", text: MSG.contactBlocked });
      return;
    }

    const abuse = this.inspectSpam(identity.userId, text);
    if (abuse) {
      await this.recordModeration(identity.userId, abuse.reason, text.length, abuse.score);
      await this.send(identity, { kind: "text", text: MSG.slowDown });
      return;
    }

    const inboundEntry = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      fromUserId: identity.userId,
      toUserId: partner.userId,
      text,
      timestamp: new Date(),
      direction: "inbound",
      externalMessageId,
      replyToMessageId
    } as const;
    this.log.append(inboundEntry);

    if (partner.identity.channel !== AI_CHANNEL && externalMessageId && this.points) {
      await this.points.award(identity.userId, `${identity.channel}:${identity.externalId}:${externalMessageId}`);
    }

    if (partner.identity.channel === AI_CHANNEL) {
      const history = this.log
        .entriesFor(conversation.id)
        .filter((entry) => entry.id !== inboundEntry.id)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .map((entry) => ({
          role: entry.fromUserId === identity.userId ? ("user" as const) : ("assistant" as const),
          text: entry.text
        }));

      let reply: string;
      try {
        reply = await this.ai.generateReply({
          conversationId: conversation.id,
          userId: identity.userId,
          text,
          persona: AI_PERSONA,
          history
        });
      } catch (error) {
        console.log(error);
        reply = MSG.unableToMatch;
      }

      this.log.append({
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        fromUserId: partner.userId,
        toUserId: identity.userId,
        text: reply,
        timestamp: new Date(),
        direction: "outbound"
      });
      return this.send(identity, { kind: "text", text: escapeHtml(reply) });
    }

    const forwardedMessageId = await this.sendTracked(partner.identity, {
      kind: "text",
      text: escapeHtml(text),
      replyToMessageId: forwardedReplyMessageId,
      sourceMessageId: externalMessageId
    });
    this.rememberMessageReference(identity, externalMessageId, {
      conversationId: conversation.id,
      fromUserId: identity.userId,
      toUserId: partner.userId,
      sourceIdentity: identity,
      forwardedIdentity: partner.identity,
      sourceMessageId: externalMessageId,
      forwardedMessageId
    });
    this.updateLoggedMessage(externalMessageId, { forwardedMessageId });
  }

  private async handleReaction(identity: CommunicationIdentity, messageId: string, emoji: string): Promise<void> {
    const reference = this.findMessageReference(messageId, identity);
    if (!reference || reference.fromUserId === identity.userId) return;
    await this.applyReaction(reference, identity.userId, emoji);
  }

  private async handleNativeEdit(identity: CommunicationIdentity, messageId: string, rawText: string): Promise<void> {
    const reference = this.messageReferences.get(this.messageReferenceKey(identity, messageId));
    if (!reference || reference.fromUserId !== identity.userId || !reference.forwardedMessageId) return;
    const conversation = await this.conversations.byId(reference.conversationId);
    if (!conversation || conversation.status !== "active" ||
      !conversation.participants.some((participant) => participant.userId === identity.userId)) return;
    const recipient = conversation.participants.find((participant) => participant.userId === reference.toUserId);
    if (!recipient || recipient.identity.channel !== reference.forwardedIdentity.channel ||
      recipient.identity.externalId !== reference.forwardedIdentity.externalId) return;
    const driver = this.channels.driverFor(reference.forwardedIdentity.channel);
    if (!driver.capabilities.messageEditing || !driver.editMessage) return;

    const text = rawText.slice(0, MAX_MESSAGE_LENGTH);
    await driver.editMessage(reference.forwardedIdentity, reference.forwardedMessageId, {
      kind: "text",
      text: escapeHtml(text),
      format: "html"
    });
    const entry = this.log.entriesFor(reference.conversationId)
      .find((candidate) => candidate.externalMessageId === messageId);
    if (entry) this.log.update({ ...entry, text });
  }

  private async applyReaction(
    reference: MessageReference,
    recipientUserId: UserId,
    emoji: string
  ): Promise<void> {
    const conversation = await this.conversations.byId(reference.conversationId);
    if (!conversation || conversation.status !== "active" ||
      !conversation.participants.some((participant) => participant.userId === recipientUserId)) {
      throw new Error("The conversation is no longer active.");
    }
    const sourceDriver = this.channels.driverFor(reference.sourceIdentity.channel);
    if (!sourceDriver.capabilities.messageReactions || !sourceDriver.reactMessage) {
      throw new Error(`Reactions are not supported by ${reference.sourceIdentity.channel}.`);
    }
    await sourceDriver.reactMessage(reference.sourceIdentity, reference.sourceMessageId, emoji);
  }

  private messageReferenceKey(identity: CommunicationIdentity, messageId: string): string {
    return `${identity.channel}:${identity.externalId}:${messageId}`;
  }

  private rememberMessageReference(
    identity: CommunicationIdentity,
    messageId: string,
    reference: {
      readonly conversationId: Conversation["id"];
      readonly fromUserId: UserId;
      readonly toUserId: UserId;
      readonly sourceIdentity: CommunicationIdentity;
      readonly forwardedIdentity: CommunicationIdentity;
      readonly sourceMessageId: string;
      readonly forwardedMessageId?: string;
    }
  ): void {
    this.messageReferences.set(this.messageReferenceKey(identity, messageId), reference);
    if (this.messageReferences.size > 10_000) {
      const oldest = this.messageReferences.keys().next().value;
      if (oldest) this.messageReferences.delete(oldest);
    }
  }

  private findMessageReference(messageId: string, recipientIdentity: CommunicationIdentity) {
    return [...this.messageReferences.values()].find((reference) =>
      reference.toUserId === recipientIdentity.userId &&
      reference.forwardedMessageId === messageId &&
      reference.forwardedIdentity.channel === recipientIdentity.channel &&
      reference.forwardedIdentity.externalId === recipientIdentity.externalId
    );
  }

  private forwardedReplyTarget(
    identity: CommunicationIdentity,
    replyToMessageId: string | undefined,
    conversationId: Conversation["id"]
  ): string | undefined {
    if (!replyToMessageId) return undefined;
    const reference = this.findMessageReference(replyToMessageId, identity);
    if (!reference || reference.toUserId !== identity.userId || reference.conversationId !== conversationId) {
      throw new Error("The reply target is no longer available in this conversation.");
    }
    return reference.sourceMessageId;
  }

  private updateLoggedMessage(messageId: string, update: { readonly forwardedMessageId?: string }): void {
    for (const conversationId of this.log.watchedConversations()) {
      const entry = this.log.entriesFor(conversationId).find((candidate) => candidate.externalMessageId === messageId);
      if (entry) this.log.update({ ...entry, ...update });
    }
  }

  private inspectSpam(userId: UserId, text: string): { reason: string; score: number } | undefined {
    const now = Date.now();
    const recent = (this.recentMessages.get(userId) ?? []).filter((entry) => now - entry.at < RATE_WINDOW_MS);
    const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
    const repeats = recent.filter((entry) => entry.text === normalized).length;
    recent.push({ at: now, text: normalized });
    this.recentMessages.set(userId, recent);
    if (recent.length > MAX_MESSAGES_PER_WINDOW) return { reason: "rate-limit", score: 100 };
    if (repeats >= 2) return { reason: "repeated-message", score: 70 };
    const links = (text.match(/https?:\/\/|www\./gi) ?? []).length;
    if (text.length > 1200) return { reason: "message-length", score: 45 };
    if (links >= 2 || links / Math.max(text.length, 1) > 0.02) return { reason: "link-density", score: 60 };
    return undefined;
  }

  private async recordModeration(userId: UserId, reason: string, messageLength: number, score: number): Promise<void> {
    await this.moderationEvents?.save({ id: crypto.randomUUID(), userId, reason, messageLength, score, createdAt: new Date() });
  }

  // ─── Inbound media ──────────────────────────────────────────────────────

private async handleMedia(identity: CommunicationIdentity, media: MediaPayload, caption?: string, externalMessageId?: string, replyToMessageId?: string): Promise<void> {
  const gate = await this.resolveConversationFor(identity);
  if (!gate.ok) {
    if (gate.reason) await this.send(identity, { kind: "text", text: gate.reason });
    return;
  }

  const { conversation, partner } = gate;

  if (partner.identity.channel === AI_CHANNEL) {
    return this.send(identity, { kind: "text", text: MSG.mediaUnsupportedByPartner });
  }

  const forwardedReplyMessageId = this.forwardedReplyTarget(identity, replyToMessageId, conversation.id);

  // Does the receiving channel support this media kind?
  const targetDriver = this.channels.driverFor(partner.identity.channel);
  if (!targetDriver.capabilities.media.includes(media.kind)) {
    return this.send(identity, { kind: "text", text: MSG.mediaUnsupportedByPartner });
  }
  if (media.kind === "sticker" && media.mimeType && media.mimeType !== "image/webp") {
    return this.send(identity, { kind: "text", text: MSG.mediaUnsupportedByPartner });
  }

  // Reuse native references only when the destination adapter supports them;
  // otherwise materialize the source as bytes or a URL, even within one channel.
  let outgoing = media;
  if (
    conversation.kind === "operator" ||
    identity.channel !== partner.identity.channel ||
    (!media.url && !media.bytes && !targetDriver.acceptsNativeMediaRefs)
  ) {
    const sourceDriver = this.channels.driverFor(identity.channel);
    if (sourceDriver.resolveMedia) {
      try {
        outgoing = await sourceDriver.resolveMedia(media);
      } catch (error) {
        console.warn(`[chat] Could not resolve incoming ${media.kind} from ${identity.channel}.`, error);
        return this.send(identity, { kind: "text", text: MSG.mediaUnsupportedByPartner });
      }
    }
    if (!outgoing.url && !outgoing.bytes) {
      // Origin driver couldn't materialize it — don't send a broken payload.
      return this.send(identity, { kind: "text", text: MSG.mediaUnsupportedByPartner });
    }
  }

  if (media.kind === "sticker" && outgoing.bytes && !isWebp(outgoing.bytes)) {
    return this.send(identity, { kind: "text", text: MSG.mediaUnsupportedByPartner });
  }

  this.log.append({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    fromUserId: identity.userId,
    toUserId: partner.userId,
    text: caption || `[${media.kind}]`,
    timestamp: new Date(),
    direction: "inbound",
    media: outgoing,
    caption,
    externalMessageId,
    replyToMessageId
  });

  const forwardedMessageId = await this.sendTracked(partner.identity, {
    kind: "media",
    media: outgoing,
    caption,
    replyToMessageId: forwardedReplyMessageId,
    sourceMessageId: externalMessageId
  });
  if (externalMessageId) {
    this.rememberMessageReference(identity, externalMessageId, {
      conversationId: conversation.id,
      fromUserId: identity.userId,
      toUserId: partner.userId,
      sourceIdentity: identity,
      forwardedIdentity: partner.identity,
      sourceMessageId: externalMessageId,
      forwardedMessageId
    });
    this.updateLoggedMessage(externalMessageId, { forwardedMessageId });
  }
}

  // ─── Inbound payment ────────────────────────────────────────────────────

  private async handlePayment(
    identity: CommunicationIdentity,
    receipt: PaymentReceipt
  ): Promise<void> {
    // TODO: look up the SKU in receipt.payload and grant the entitlement.
    console.log("[payment] received", {
      userId: identity.userId,
      provider: receipt.provider,
      payload: receipt.payload,
      amount: receipt.amount,
      currency: receipt.currency,
      externalChargeId: receipt.externalChargeId
    });
    await this.send(identity, { kind: "text", text: MSG.paymentReceived });
  }

  // ─── Shared conversation gate ───────────────────────────────────────────

  private async resolveConversationFor(identity: CommunicationIdentity): Promise<ConversationGate> {
    const eligibility = await this.users.eligibilityFor(identity.userId);
    if (eligibility?.status !== "eligible") {
      await this.startOnboarding(identity);
      return { ok: false, reason: "" }; // onboarding already sent its own message
    }

    const profile = await this.users.profileFor(identity.userId);
    if (!profile) {
      await this.resumeOnboarding(identity);
      return { ok: false, reason: "" };
    }

    const conversation = await this.conversations.activeFor(identity.userId);
    if (!conversation) return { ok: false, reason: MSG.noConversation };

    const partner = conversation.participants.find((p) => p.userId !== identity.userId);
    if (!partner) return { ok: false, reason: MSG.noConversation };

    return { ok: true, conversation, partner };
  }

  private async rejectAmbiguousStaffAction(identity: CommunicationIdentity): Promise<boolean> {
    const profile = await this.users.profileFor(identity.userId);
    if (!profile?.moderator && !profile?.operator) return false;
    const sessions = (await this.conversations.all()).filter((conversation) =>
      conversation.status === "active" &&
      conversation.kind === "operator" &&
      conversation.participants.some((participant) => participant.userId === identity.userId)
    );
    if (sessions.length < 2) return false;

    let workspaceUrl: string | undefined;
    if (this.moderatorConsoleUrl) {
      const path = profile.operator ? "/operator" : "/moderator/sessions";
      workspaceUrl = new URL(path, this.moderatorConsoleUrl).toString();
    }
    await this.send(identity, {
      kind: "text",
      text: `You have multiple active support sessions. Use the web workspace to reply or manage chats.${workspaceUrl ? `\n${workspaceUrl}` : ""}`
    });
    return true;
  }

  // ─── Onboarding ─────────────────────────────────────────────────────────

  private async startOnboarding(identity: CommunicationIdentity): Promise<void> {
    const eligibility = await this.users.eligibilityFor(identity.userId);
    const profile = await this.users.profileFor(identity.userId);
    if (eligibility?.status === "eligible" && profile) {
      return this.send(identity, { kind: "text", text: MSG.welcomeBack });
    }
    if (eligibility?.status === "eligible") return this.resumeOnboarding(identity);
    await this.send(identity, {
      kind: "interaction",
      text: MSG.adultGate,
      actions: [{ id: "confirm-adult", label: "I am 18+" }]
    });
  }

  private async resumeOnboarding(identity: CommunicationIdentity): Promise<void> {
    const draft = await this.users.draftFor(identity.userId);
    if (draft?.step === "awaiting-country" && draft.gender) {
      return this.send(identity, { kind: "text", text: MSG.askCountry });
    }
    if (draft?.step === "awaiting-preference") {
      return this.send(identity, { kind: "interaction", text: MSG.askPreference, actions: preferenceActions });
    }
    await this.users.saveDraft({ userId: identity.userId, step: "awaiting-gender" });
    return this.send(identity, { kind: "interaction", text: MSG.askGender, actions: genderActions });
  }

  // ─── Matchmaking commands ───────────────────────────────────────────────

  private async find(identity: CommunicationIdentity): Promise<void> {
    const eligibility = await this.users.eligibilityFor(identity.userId);
    if (eligibility?.status !== "eligible") {
      await this.send(identity, { kind: "text", text: MSG.onboardingRequired });
      return this.startOnboarding(identity);
    }

    const profile = await this.users.profileFor(identity.userId);
    if (!profile) {
      await this.send(identity, { kind: "text", text: MSG.profileRequired });
      return this.resumeOnboarding(identity);
    }
    if (profile.moderator) return this.send(identity, { kind: "text", text: MSG.moderatorUseConsole });

    try {
      const conversations = await this.matching.join(identity.userId);
      await this.notifyMatches(conversations);
      const ownMatch = conversations.some((c) =>
        c.participants.some((p) => p.userId === identity.userId)
      );
      if (!ownMatch) await this.send(identity, { kind: "text", text: MSG.matchWaiting });
    } catch (error) {
      const text = error instanceof Error ? escapeHtml(error.message) : MSG.unableToMatch;
      await this.send(identity, { kind: "text", text });
    }
  }

  private async next(identity: CommunicationIdentity): Promise<void> {
    const conversation = await this.conversations.activeFor(identity.userId);
    if (conversation) {
      await this.conversations.save({ ...conversation, status: "ended" });
      const other = conversation.participants.find((p) => p.userId !== identity.userId);
      if (other && other.identity.channel !== AI_CHANNEL) {
        await this.send(other.identity, { kind: "text", text: MSG.otherMovedOn });
      }
    }
    return this.find(identity);
  }

  private async leave(identity: CommunicationIdentity): Promise<void> {
    if (await this.conversations.activeFor(identity.userId)) {
      return this.endWithReason(identity, MSG.left);
    }
    if (await this.matching.isWaiting(identity.userId)) {
      await this.matching.stopWaiting(identity.userId);
      return this.send(identity, { kind: "text", text: MSG.leftQueue });
    }
    return this.send(identity, { kind: "text", text: MSG.notInConversationEnd });
  }

  // ─── Report / leave / block ─────────────────────────────────────────────

  private async report(identity: CommunicationIdentity): Promise<void> {
    const conversation = await this.conversations.activeFor(identity.userId);
    if (!conversation) {
      return this.send(identity, { kind: "text", text: MSG.notInConversationEnd });
    }

    const other = conversation.participants.find((p) => p.userId !== identity.userId);
    if (other) {
      await this.reports.save({
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        reporterId: identity.userId,
        reportedId: other.userId,
        reason: "user-reported",
        createdAt: new Date()
      });
    }

    await this.conversations.save({ ...conversation, status: "ended" });
    if (other && other.identity.channel !== AI_CHANNEL) {
      await this.send(other.identity, { kind: "text", text: MSG.otherEnded });
    }
    return this.send(identity, { kind: "text", text: MSG.reported });
  }

  private async endWithReason(identity: CommunicationIdentity, reason: string): Promise<void> {
    const conversation = await this.conversations.activeFor(identity.userId);
    if (!conversation) {
      return this.send(identity, { kind: "text", text: MSG.notInConversationEnd });
    }

    await this.conversations.save({ ...conversation, status: "ended" });
    const other = conversation.participants.find((p) => p.userId !== identity.userId);
    if (other && other.identity.channel !== AI_CHANNEL) {
      await this.send(other.identity, { kind: "text", text: MSG.otherEnded });
    }
    return this.send(identity, { kind: "text", text: reason });
  }

  // ─── Outbound ───────────────────────────────────────────────────────────

  private async send(identity: CommunicationIdentity, message: OutboundMessage): Promise<void> {
    await this.sendTracked(identity, message);
  }

  private async sendTracked(identity: CommunicationIdentity, message: OutboundMessage): Promise<string | undefined> {
    const richMessage = message.kind === "text" || message.kind === "interaction"
      ? { ...message, format: "html" as const }
      : message;
    return this.channels.driverFor(identity.channel).sendMessage(recipient(identity), richMessage);
  }

  private settingsKey(identity: CommunicationIdentity): string {
    return `${identity.channel}:${identity.externalId}`;
  }

  private async deleteSettingsMessage(identity: CommunicationIdentity): Promise<void> {
    const key = this.settingsKey(identity);
    const messageId = this.settingsMessageIds.get(key);
    this.settingsMessageIds.delete(key);
    const driver = this.channels.driverFor(identity.channel);
    if (messageId && driver.capabilities.messageDeletion && driver.deleteMessage) {
      try {
        await driver.deleteMessage(recipient(identity), messageId);
      } catch (error) {
        console.warn(`[chat] Could not delete prior settings prompt on ${identity.channel}.`, error);
      }
    }
  }

  private async sendSettingsInteraction(
    identity: CommunicationIdentity,
    message: Extract<OutboundMessage, { readonly kind: "interaction" }>
  ): Promise<void> {
    await this.deleteSettingsMessage(identity);
    const messageId = await this.sendTracked(identity, message);
    if (messageId) this.settingsMessageIds.set(this.settingsKey(identity), messageId);
  }
}

void AI_EXTERNAL_ID_ALIAS;

const isWebp = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 12 &&
  String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
  String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
