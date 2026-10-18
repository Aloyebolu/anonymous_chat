import { CHAT_COMMANDS } from "@anonymous-chat/shared/constants";
import { escapeHtml } from "@anonymous-chat/shared/rich-text";

export const MSG = {
  helpNew: "<b>Welcome!</b> Send <code>/start</code> to begin the 18+ setup. Once your profile is ready, use <code>/find</code> to meet someone, <code>/app</code> for settings and rewards, or <code>/help</code> for guidance.",
  helpReady: "<b>You're all set.</b> Send <code>/find</code> to meet someone, <code>/vip</code> for matching options, <code>/app</code> for settings and activities, or <code>/points</code> to check your balance.",
  helpWaiting: "<b>You're in the matching queue.</b> Send <code>/next</code> to search again, <code>/end</code> to stop, or <code>/points</code> to check your balance.",
  helpChat: "<b>You're chatting now.</b> Send <code>/next</code> to meet someone else, <code>/end</code> to stop chatting, <code>/report</code> to report a problem, or <code>/block</code> to end and block.",
  help: `<b>Available commands</b>\n${CHAT_COMMANDS.map((command) => `<code>${command}</code>`).join(" · ")}`,
  welcomeBack: "<b>Welcome back!</b> Your profile is ready. Send <code>/find</code> to meet someone, or <code>/help</code> to see what you can do.",
  pointsBalance: (balance: number) => `<b>Your balance:</b> ${balance} point${balance === 1 ? "" : "s"}.\nEarn points by chatting respectfully. <i>Daily chat earning is capped.</i>`,
  vipOffer: (balance: number, cost: number) => `<b>VIP matching</b>\nGet strict preference matching and see your partner's gender.\n<i>${cost} points · 30 days</i>\nYour balance: <b>${balance} points</b>.`,
  vipActive: (until: string) => `<b>VIP is active</b> until ${escapeHtml(until)}.\nYou can see your partner's gender and use strict preference matching.`,
  vipPurchased: "<b>VIP activated!</b> Your preferences now use strict matching for 30 days.",
  vipInsufficient: "You need more points for VIP. Check <code>/points</code> and visit the Mini App for daily activities.",
  miniAppUnavailable: "<b>The Mini App isn't available yet.</b> Please try again later.",
  vipProfileRequired: "Complete your profile before buying VIP. Send <code>/start</code> to continue setup.",
  miniAppPrompt: "<b>Your settings &amp; rewards</b>\nUpdate your profile, collect daily points, and manage your wallet.",
  miniAppButton: "Open Mini App",
  vipBuyLabel: (points: number) => `Buy VIP · ${points} points`,
  matchConnected: (gender: string, displayName?: string) =>
    `${randomEmoji()} <b>Chat connected!</b>${displayName ? `\nName: ${escapeHtml(displayName)}` : ""}\nGender: <i>${escapeHtml(gender)}</i>\nSay hello to start the conversation.\n\n<code>/next</code> — ❤️ Next  ·  <code>/end</code> — Stop chat\n\n<i>💡 Tip: ${escapeHtml(randomTip())}</i>`,
  matchFound: "<b>You've been matched!</b>",
  matchWaiting:
    "<b>Looking for a compatible match…</b>\nWe'll let you know as soon as someone is available. If the wait gets long, we'll widen the search for you.",
  matchWithAi:
    "<b>No one is available just yet.</b> We've connected you with our assistant for this session. Send <code>/next</code> any time to try again.",
  moderatorAssignment: "🛡️ <b>New support chat assigned</b>\nYou're connected now—please say hello and help the user get started.",
  moderatorLinked: "<b>Channel linked.</b> This chat is now connected to your moderator account.",
  moderatorLinkInvalid: "<b>That link code couldn't be used.</b> It may be invalid, expired, or the account may not be linkable. Create a fresh code from the moderator page.",
  moderatorUseConsole: "<b>Moderator account.</b> Join support chats from the moderator page; you don't need the regular matchmaking queue.",
  noConversation: "You're not in a conversation. Send <code>/find</code> to match, or <code>/help</code> for commands.",
  onboardingRequired: "<b>Let's get you set up first.</b>",
  profileRequired: "<b>Let's finish your profile first.</b>",
  adultGate: "<b>This is an adults-only anonymous chat.</b> You must be 18+ to continue.",
  askGender: "<b>What is your gender?</b>",
  askCountry: "<b>Which country are you in?</b>",
  askPreference: "<b>Who would you like to match with?</b>",
  profileComplete: "<b>Profile complete!</b> Send <code>/find</code> whenever you're ready.",
  left: "<b>You left the conversation.</b>",
  leftQueue: "<b>You left the matching queue.</b> Send <code>/find</code> whenever you'd like to search again.",
  reported: "<b>Report received.</b> The conversation has ended.",
  blocked: "<b>User blocked.</b> The conversation has ended.",
  otherEnded: "<i>The conversation has ended.</i>",
  otherMovedOn: "<i>The other participant moved on.</i>",
  notInConversationEnd: "You're not in a conversation. Send <code>/find</code> to match, or <code>/help</code> for commands.",
  contactBlocked:
    "<b>Let's keep things anonymous.</b> For everyone's safety, sharing phone numbers, emails, links, or social handles isn't allowed.",
  slowDown: "<i>Please slow down and avoid repeating the same message.</i> Try again in a moment.",
  unableToMatch: "We couldn't find a match right now. Please try again in a moment.",
  mediaUnsupportedByPartner: "Your partner can't receive media yet. <b>Send text instead.</b>",
  mediaUnsupportedHere: "<i>This channel doesn't support media yet.</i>",
  paymentReceived: "<b>Payment received.</b> Thank you!"
} as const;

export const AI_PERSONA = {
  systemPrompt: `You are a friendly humane stranger on an anonymous 18+ chat app.
You just matched with someone and are chatting with them now.
Keep replies short — 1 to 3 sentences, casual, curious.
Ask a follow-up question when it fits, the way a real person would.
Never claim to be human if asked directly — say you are an assistant on the app.
Never randomly tell them you are ai except you are explictly asked.
You can allow flirty conversations between you both as all participant are 18+.`
} as const;


export const tips = [
  "Start with a friendly hello and an easygoing question.",
  "Protect your anonymity by keeping personal details private.",
  "Be respectful and mindful of other people's boundaries.",
  "Never share passwords, verification codes, or financial information.",
  "You can leave a chat or find someone new at any time with /next.",
  "Use /report or /block if someone makes you uncomfortable.",
  "Share only what you're comfortable sharing.",
  "A little kindness can make an anonymous conversation welcoming."
] as const;

const chatEmojis = ["👋", "💬", "✨", "🌟", "😊", "🦋"] as const;

export function randomTip(): (typeof tips)[number] {
  return tips[Math.floor(Math.random() * tips.length)] ?? tips[0];
}

export function randomEmoji(): (typeof chatEmojis)[number] {
  return chatEmojis[Math.floor(Math.random() * chatEmojis.length)] ?? chatEmojis[0];
}
// ...existing code...