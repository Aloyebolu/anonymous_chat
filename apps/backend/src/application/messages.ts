export const MSG = {
  helpNew: "Welcome! Send /start to begin the 18+ setup. Once your profile is ready, use /find to meet someone, /app for settings and rewards, and /help for guidance.",
  helpReady: "Commands: /find to meet someone, /vip for matching options, /app to open settings and activities, /points to check your balance, /help for this guide.",
  helpWaiting: "You are in the matching queue. Send /next to leave the queue and search again, /end to stop, or /points to check your balance.",
  helpChat: "You are chatting now. Send /next to meet someone else, /end to end the chat, /report to report a problem, or /block to end and block.",
  help: "Commands: /start, /find, /next, /end, /report, /block, /vip, /app, /points, /help",
  welcomeBack: "Welcome back. Your profile is ready — send /find to meet someone, or /help to see what you can do.",
  pointsBalance: (balance: number) => `You have ${balance} point${balance === 1 ? "" : "s"}. Earn points by chatting respectfully; daily chat earning is capped.`,
  vipOffer: (balance: number, cost: number) => `VIP unlocks strict preference matching and lets you see your partner's gender. It costs ${cost} points for 30 days. Your balance: ${balance} points.`,
  vipActive: (until: string) => `VIP is active until ${until}. You can see a partner's gender and use strict preference matching.`,
  vipPurchased: "VIP activated for 30 days. Your preferences now use strict matching.",
  vipInsufficient: "You need more points for VIP. Check /points and visit the Mini App for daily activities.",
  miniAppUnavailable: "The Mini App is not configured yet. Please try again later.",
  vipProfileRequired: "Complete your profile before buying VIP. Send /start to continue setup.",
  miniAppPrompt: "Open your settings, daily rewards, and points wallet.",
  miniAppButton: "Open Mini App",
  vipBuyLabel: (points: number) => `Buy VIP · ${points} points`,
  matchConnected: (gender: string, displayName?: string) => `🐧 Chat Connected!${displayName ? `\nName: ${displayName}` : ""}\nGender: ${gender}\nSay hello to start the conversation...\n/next — ❤️ Next | /end — Stop chat\n💡 Tip: Get match priority and choose gender with /vip!`,
  matchFound: "You have been matched.",
  matchWaiting:
    "Looking for a compatible match… We'll notify you here as soon as someone is available. If the wait gets long we'll widen the search for you.",
  matchWithAi:
    "We couldn't find another person right now, so we've connected you with our assistant for this session. Send /next at any time to try again.",
  noConversation: "You're not in a conversation. Send /find to match, or /help for commands.",
  onboardingRequired: "Let's get you set up first.",
  profileRequired: "Let's finish your profile first.",
  adultGate: "This is an adults-only anonymous chat. You must be 18+ to continue.",
  askGender: "What is your gender?",
  askCountry: "Which country are you in?",
  askPreference: "Who would you like to match with?",
  profileComplete: "Profile complete. Send /find when you're ready.",
  left: "You left the conversation.",
  leftQueue: "You left the matching queue.",
  reported: "Report received. The conversation has ended.",
  blocked: "User blocked. The conversation has ended.",
  otherEnded: "The conversation has ended.",
  otherMovedOn: "The other participant moved on.",
  notInConversationEnd: "You are not in a conversation. Send /find to match, or /help for commands.",
  contactBlocked:
    "For everyone's safety, sharing phone numbers, emails, links, or social handles isn't allowed. Please keep the chat anonymous.",
  slowDown: "Please slow down and avoid repeating the same message. Try again in a moment.",
  unableToMatch: "Unable to match right now.",
  mediaUnsupportedByPartner: "Your partner can't receive media yet. Send text instead.",
  mediaUnsupportedHere: "This channel doesn't support media yet.",
  paymentReceived: "Payment received. Thank you!"
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
