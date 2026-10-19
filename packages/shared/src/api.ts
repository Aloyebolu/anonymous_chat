export const API_PREFIX = "/api";
export const LOCAL_API_ORIGIN = "http://localhost:3000";

export const API_PATHS = {
  send: `${API_PREFIX}/send`,
  stream: `${API_PREFIX}/stream`,
  whatsappWebhook: `${API_PREFIX}/webhooks/whatsapp`,
  web: {
    register: `${API_PREFIX}/web/register`,
    login: `${API_PREFIX}/web/login`,
    editMessage: `${API_PREFIX}/web/message/edit`,
    reactMessage: `${API_PREFIX}/web/message/react`
  },
  admin: {
    state: `${API_PREFIX}/state`,
    reports: `${API_PREFIX}/reports`,
    moderationEvents: `${API_PREFIX}/moderation-events`,
    shadowBanUser: `${API_PREFIX}/user/shadow-ban`,
    grantModerator: `${API_PREFIX}/moderators/grant`,
    reportedUsers: `${API_PREFIX}/reported-users`,
    operatorLogin: `${API_PREFIX}/operator/login`,
    operatorMatch: `${API_PREFIX}/operator/match`,
    watch: `${API_PREFIX}/watch`,
    live: `${API_PREFIX}/admin/live`
  },
  moderator: {
    me: `${API_PREFIX}/moderator/me`,
    settings: `${API_PREFIX}/moderator/settings`,
    linkCode: `${API_PREFIX}/moderator/link-code`,
    shadowBan: `${API_PREFIX}/moderator/shadow-ban`,
    participantProfile: `${API_PREFIX}/moderator/participant-profile`,
    notice: `${API_PREFIX}/moderator/notice`,
    message: `${API_PREFIX}/moderator/message`,
    sessionCommand: `${API_PREFIX}/moderator/session-command`
  },
  operator: {
    me: `${API_PREFIX}/operator/me`,
    settings: `${API_PREFIX}/operator/settings`,
    message: `${API_PREFIX}/operator/message`,
    sessionCommand: `${API_PREFIX}/operator/session-command`
  },
  miniApp: {
    prefix: `${API_PREFIX}/miniapp`,
    me: `${API_PREFIX}/miniapp/me`,
    dailyCheckIn: `${API_PREFIX}/miniapp/daily-check-in`,
    profile: `${API_PREFIX}/miniapp/profile`,
    vipPlans: `${API_PREFIX}/miniapp/vip-plans`,
    vip: `${API_PREFIX}/miniapp/vip`
  }
} as const;
