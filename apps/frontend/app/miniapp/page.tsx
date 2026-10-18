"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PATHS, LOCAL_API_ORIGIN } from "@anonymous-chat/shared/api";
import { VIP_CONFIG } from "@anonymous-chat/shared/constants";
import type { Gender, GenderPreference } from "@anonymous-chat/shared/domain";
import type { MiniAppProfile as MiniProfile } from "@anonymous-chat/shared/contracts";

interface TelegramMiniApp {
  initData: string;
  initDataUnsafe?: { user?: { first_name?: string } };
  colorScheme?: "light" | "dark";
  ready(): void;
  expand(): void;
}
declare global { interface Window { Telegram?: { WebApp: TelegramMiniApp } } }

const API = process.env.NEXT_PUBLIC_MINI_APP_API ?? process.env.NEXT_PUBLIC_WEB_API ?? LOCAL_API_ORIGIN;

const COPY = {
  title: "Your little corner",
  subtitle: "Make your chats feel more like you.",
  points: "POINTS",
  daily: "Daily check-in",
  dailyReward: "+3 points · come back every day",
  settings: "Your profile",
  save: "Save my settings",
  saved: "Settings saved",
  name: "Name",
  age: "Age",
  gender: "Gender",
  country: "Country",
  language: "Language",
  preferredGender: "Match with",
  preferredCountry: "Country preference",
  showName: "Show my name to a match",
  privacy: "Your name stays hidden unless you turn this on.",
  vip: "A little more choice",
  buyVip: (cost: number) => `Unlock VIP · ${cost} points`,
  vipBody: "See your match’s gender, use strict preferences, and change your gender setting.",
  active: "VIP is yours",
  busy: "Loading your profile…",
  error: "We couldn’t load your account. Open this page from the Telegram bot with /app.",
  signedOut: "Open this app inside Telegram so we can safely load your account.",
  genderVip: "Changing your gender setting is a VIP feature.",
  earn: "A complete profile earns a one-time +5 point bonus.",
  checkInDone: "You’re checked in! Your points are ready.",
  checkInAgain: "You already checked in today, or reached today’s points limit.",
  insufficient: "You need more points for VIP. Check in daily and keep chatting to earn more.",
  cap: "Earn up to 20 points each day"
} as const;

const languages = ["en", "fr", "es", "pt", "ar", "ha", "yo", "ig"] as const;
const genderLabels: Record<Gender, string> = { female: "Woman", male: "Man", nonbinary: "Non-binary" };

type TabKey = "home" | "profile" | "vip";
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "home", label: "Home", icon: "✦" },
  { key: "profile", label: "Profile", icon: "✿" },
  { key: "vip", label: "VIP", icon: "♛" }
];

/* ---------- theme ---------- */
function useSystemTheme() {
  const [mode, setMode] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const tg = window.Telegram?.WebApp?.colorScheme;
    if (tg) { setMode(tg); return; }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setMode(mql.matches ? "dark" : "light");
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);
  return mode;
}

/* ---------- primitives ---------- */
function Spinner() { return <span className="m-spinner" aria-hidden />; }

function Button({ variant = "primary", busy, children, onClick, disabled }: {
  variant?: "primary" | "light" | "vip" | "ghost";
  busy?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={`m-btn m-btn-${variant}`} disabled={disabled || busy} onClick={onClick} type="button">
      {busy && <Spinner />}
      <span>{children}</span>
    </button>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`m-field${full ? " m-field-full" : ""}`}>
      <span className="m-field-label">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, title, subtitle }: {
  checked: boolean; onChange: (v: boolean) => void; title: string; subtitle: string;
}) {
  return (
    <label className="m-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="m-toggle-track"><span className="m-toggle-thumb" /></span>
      <span className="m-toggle-text"><b>{title}</b><small>{subtitle}</small></span>
    </label>
  );
}

function Alert({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  return <div className={`m-alert m-alert-${kind}`}>{children}</div>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`m-card ${className}`}>{children}</div>;
}

/* ---------- tab bar ---------- */
function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const index = TABS.findIndex((t) => t.key === active);
  return (
    <nav className="m-tabbar" role="tablist">
      <span className="m-tabbar-pill" style={{ transform: `translateX(calc(${index} * 100%))` }} />
      {TABS.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          className={`m-tab${active === tab.key ? " m-tab-active" : ""}`}
          onClick={() => onChange(tab.key)}
          type="button"
        >
          <span className="m-tab-icon">{tab.icon}</span>
          <span className="m-tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ---------- tabs ---------- */
function HomeTab({ points, busy, checkIn }: { points: number; busy: boolean; checkIn: () => void }) {
  return (
    <div className="m-pane">
      <Card className="m-wallet">
        <div className="m-wallet-top">
          <span className="m-eyebrow">{COPY.points}</span>
          <span className="m-hint">{COPY.cap}</span>
        </div>
        <div className="m-wallet-amount">
          <span className="m-wallet-num">{points}</span>
          <span className="m-wallet-unit">pts</span>
        </div>
        <Button variant="light" busy={busy} onClick={checkIn}>
          <span className="m-daily">
            <b>{COPY.daily}</b>
            <small>{COPY.dailyReward}</small>
          </span>
        </Button>
      </Card>

      <Card className="m-tip">
        <div className="m-tip-icon">🎁</div>
        <div>
          <h3>Complete your profile</h3>
          <p>{COPY.earn}</p>
        </div>
      </Card>
    </div>
  );
}

function ProfileTab({ profile, busy, updateField, saveProfile }: {
  profile: MiniProfile;
  busy: boolean;
  updateField: <K extends keyof MiniProfile>(key: K, value: MiniProfile[K]) => void;
  saveProfile: () => void;
}) {
  const isVip = Boolean(profile.vipUntil && Date.parse(profile.vipUntil) > Date.now());
  return (
    <div className="m-pane">
      <Card>
        <div className="m-section-head">
          <span className="m-section-icon">✿</span>
          <div><h2>{COPY.settings}</h2><p>{COPY.privacy}</p></div>
        </div>

        <div className="m-form-grid">
          <Field label={COPY.name}>
            <input value={profile.displayName ?? ""} maxLength={28}
              onChange={(e) => updateField("displayName", e.target.value)} />
          </Field>
          <Field label={COPY.age}>
            <input type="number" min={18} max={99} value={profile.age ?? ""}
              onChange={(e) => updateField("age", e.target.value ? Number(e.target.value) : undefined)} />
          </Field>
          <Field label={COPY.gender}>
            <select value={profile.gender} disabled={!isVip}
              onChange={(e) => updateField("gender", e.target.value as Gender)}>
              {Object.entries(genderLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label={COPY.country}>
            <input value={profile.country} maxLength={56}
              onChange={(e) => updateField("country", e.target.value)} />
          </Field>
          <Field label={COPY.language}>
            <select value={profile.language ?? "en"}
              onChange={(e) => updateField("language", e.target.value)}>
              {languages.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label={COPY.preferredGender}>
            <select value={profile.preferredGender}
              onChange={(e) => updateField("preferredGender", e.target.value as GenderPreference)}>
              <option value="any">Anyone</option>
              {Object.entries(genderLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label={COPY.preferredCountry} full>
            <input value={profile.preferredCountry ?? ""} maxLength={56} placeholder="Any country"
              onChange={(e) => updateField("preferredCountry", e.target.value)} />
          </Field>
        </div>

        <Toggle
          checked={profile.showName ?? false}
          onChange={(v) => updateField("showName", v)}
          title={COPY.showName}
          subtitle={COPY.privacy}
        />

        <Button variant="primary" busy={busy} onClick={saveProfile}>{COPY.save}</Button>
        {!isVip && <p className="m-note">{COPY.genderVip}</p>}
      </Card>
    </div>
  );
}

function VipTab({ profile, points, vipCost, busy, buyVip }: {
  profile: MiniProfile; points: number; vipCost: number; busy: boolean; buyVip: () => void;
}) {
  const active = Boolean(profile.vipUntil && Date.parse(profile.vipUntil) > Date.now());
  return (
    <div className="m-pane">
      <Card className="m-vip">
        <div className="m-vip-glow" />
        <div className="m-vip-top">
          <span className="m-vip-star">✦</span>
          <span className="m-vip-badge">VIP</span>
        </div>
        <h2>{active ? COPY.active : COPY.vip}</h2>
        <p>{COPY.vipBody}</p>

        {active ? (
          <div className="m-vip-date">✓ Active until {new Date(profile.vipUntil!).toLocaleDateString()}</div>
        ) : (
          <Button variant="vip" busy={busy} disabled={points < vipCost} onClick={buyVip}>
            {COPY.buyVip(vipCost)}
          </Button>
        )}

        <div className="m-perks">
          <div className="m-perk"><span>🎭</span><div><b>See who you match with</b><small>Gender visible in chat</small></div></div>
          <div className="m-perk"><span>🎯</span><div><b>Strict preferences</b><small>Only match exactly what you want</small></div></div>
          <div className="m-perk"><span>🔄</span><div><b>Change your gender</b><small>Update this setting any time</small></div></div>
        </div>

        <small className="m-vip-foot">Other secure payment options can be added alongside points.</small>
      </Card>
    </div>
  );
}

/* ---------- shell ---------- */
function Shell({ theme, children }: { theme: "light" | "dark"; children: React.ReactNode }) {
  const styles = useMemo(() => CSS_TEXT, []);
  return (
    <div className={`m-app m-theme-${theme}`}>
      <style>{styles}</style>
      <div className="m-orb m-orb-1" />
      <div className="m-orb m-orb-2" />
      <div className="m-orb m-orb-3" />
      <main className="m-main">{children}</main>
    </div>
  );
}

/* ---------- page ---------- */
export default function MiniAppPage() {
  const theme = useSystemTheme();
  const [initData, setInitData] = useState("");
  const [firstName, setFirstName] = useState("");
  const [profile, setProfile] = useState<MiniProfile | null>(null);
  const [points, setPoints] = useState(0);
  const [vipCost, setVipCost] = useState<number>(VIP_CONFIG.pointsCost);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("home");
  const [dir, setDir] = useState<1 | -1>(1);

  const request = useCallback(async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `tma ${initData}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
    return data;
  }, [initData]);

  const loadProfile = useCallback(async () => {
    if (!initData) return;
    setLoading(true);
    try {
      const data = await request(API_PATHS.miniApp.me);
      setProfile(data.profile as MiniProfile);
      setPoints(Number(data.points ?? 0));
      setVipCost(Number(data.vipCostPoints ?? VIP_CONFIG.pointsCost));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : COPY.error);
    } finally {
      setLoading(false);
    }
  }, [initData, request]);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (webApp) {
      webApp.ready();
      webApp.expand();
      setInitData(webApp.initData);
      setFirstName(webApp.initDataUnsafe?.user?.first_name ?? "friend");
    }
  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const switchTab = (next: TabKey) => {
    if (next === tab) return;
    const order = TABS.map((t) => t.key);
    setDir(order.indexOf(next) > order.indexOf(tab) ? 1 : -1);
    setTab(next);
    setNotice(""); setError("");
  };

  const updateField = <K extends keyof MiniProfile>(key: K, value: MiniProfile[K]) => {
    setProfile((current) => current ? { ...current, [key]: value } : current);
  };

  const saveProfile = async () => {
    if (!profile) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const data = await request(API_PATHS.miniApp.profile, "PATCH", {
        displayName: profile.displayName ?? "",
        showName: profile.showName ?? false,
        age: profile.age ? Number(profile.age) : undefined,
        language: profile.language ?? "en",
        gender: profile.gender,
        country: profile.country,
        preferredGender: profile.preferredGender,
        preferredCountry: profile.preferredCountry ?? ""
      });
      setProfile(data.profile as MiniProfile);
      setPoints(Number(data.points ?? points));
      setNotice(Number(data.earned) > 0 ? `${COPY.saved} · +${data.earned} points` : COPY.saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : COPY.error);
    } finally { setBusy(false); }
  };

  const checkIn = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request(API_PATHS.miniApp.dailyCheckIn, "POST", {});
      setPoints(Number(data.points ?? points));
      setNotice(Number(data.earned) > 0 ? COPY.checkInDone : COPY.checkInAgain);
    } catch (reason) { setError(reason instanceof Error ? reason.message : COPY.error); }
    finally { setBusy(false); }
  };

  const buyVip = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request(API_PATHS.miniApp.vip, "POST", { idempotencyKey: crypto.randomUUID() });
      setProfile(data.profile as MiniProfile);
      setPoints(Number(data.points ?? points));
      setNotice(COPY.active);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : COPY.error;
      setError(message.includes("Not enough points") ? COPY.insufficient : message);
    } finally { setBusy(false); }
  };

  if (!initData) return <Shell theme={theme}><Card className="m-empty">{COPY.signedOut}</Card></Shell>;
  if (loading) return <Shell theme={theme}><Card className="m-empty"><Spinner /> {COPY.busy}</Card></Shell>;
  if (!profile) return <Shell theme={theme}><Card className="m-empty">{error || COPY.error}</Card></Shell>;

  return (
    <Shell theme={theme}>
      <header className="m-header">
        <div className="m-mark">🐧</div>
        <div className="m-header-text">
          <p className="m-eyebrow">ANONYMOUS CHAT</p>
          <h1>{COPY.title}, {firstName}</h1>
          <p className="m-subtitle">{COPY.subtitle}</p>
        </div>
        <div className="m-balance-chip">
          <span>{points}</span>
          <small>pts</small>
        </div>
      </header>

      {(error || notice) && (
        <div className="m-alerts">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
        </div>
      )}

      <div className="m-viewport">
        <div key={tab} className={`m-content${dir > 0 ? " m-in-right" : " m-in-left"}`}>
          {tab === "home" && <HomeTab points={points} busy={busy} checkIn={() => void checkIn()} />}
          {tab === "profile" && <ProfileTab profile={profile} busy={busy} updateField={updateField} saveProfile={() => void saveProfile()} />}
          {tab === "vip" && <VipTab profile={profile} points={points} vipCost={vipCost} busy={busy} buyVip={() => void buyVip()} />}
        </div>
      </div>

      <TabBar active={tab} onChange={switchTab} />
      <footer className="m-footer">Your name is private by default · You must be 18 or older</footer>
    </Shell>
  );
}

/* ---------- styles ---------- */
const CSS_TEXT = `
.m-app {
  --bg-1:#0b0616; --bg-2:#140a26; --bg-3:#05030d;
  --surface:rgba(255,255,255,.055); --surface-2:rgba(255,255,255,.09);
  --border:rgba(255,255,255,.1); --border-strong:rgba(255,255,255,.18);
  --text:#f4f1ff; --text-dim:rgba(244,241,255,.62); --text-faint:rgba(244,241,255,.4);
  --accent:#a78bfa; --accent-2:#7c3aed; --accent-3:#f472b6;
  --success:#34d399; --danger:#fb7185; --vip-gold:#fbbf24;
  --shadow:0 20px 60px -20px rgba(0,0,0,.6); --radius:22px;
  min-height:100dvh; position:relative; overflow:hidden;
  background:radial-gradient(120% 80% at 50% -10%, var(--bg-2), var(--bg-1) 55%, var(--bg-3));
  color:var(--text); font-size:15px; -webkit-font-smoothing:antialiased;
  font-family:ui-sans-serif,-apple-system,"SF Pro Display","Segoe UI",system-ui,sans-serif;
}
.m-app.m-theme-light {
  --bg-1:#f6f2ff; --bg-2:#ffffff; --bg-3:#ece4ff;
  --surface:rgba(255,255,255,.75); --surface-2:rgba(124,58,237,.08);
  --border:rgba(20,10,40,.09); --border-strong:rgba(20,10,40,.16);
  --text:#1a0f33; --text-dim:rgba(26,15,51,.66); --text-faint:rgba(26,15,51,.42);
  --accent:#7c3aed; --accent-2:#6d28d9; --accent-3:#ec4899;
  --shadow:0 24px 60px -28px rgba(76,29,149,.35);
  background:radial-gradient(120% 80% at 50% -10%, #fff, #f6f2ff 55%, #ece4ff);
}
.m-app *{box-sizing:border-box}
.m-orb{position:fixed;border-radius:50%;filter:blur(70px);opacity:.5;pointer-events:none;z-index:0;animation:m-float 18s ease-in-out infinite}
.m-orb-1{width:320px;height:320px;background:#7c3aed;top:-120px;left:-100px}
.m-orb-2{width:260px;height:260px;background:#ec4899;bottom:10%;right:-110px;animation-delay:-6s;opacity:.35}
.m-orb-3{width:220px;height:220px;background:#22d3ee;top:42%;left:40%;animation-delay:-12s;opacity:.24}
.m-theme-light .m-orb{opacity:.3}
@keyframes m-float{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(20px,-30px,0) scale(1.08)}}
.m-main{position:relative;z-index:1;max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:14px;
  padding:max(18px,env(safe-area-inset-top)) 16px calc(100px + env(safe-area-inset-bottom))}
.m-header{display:flex;align-items:center;gap:14px;padding:16px 6px 8px;animation:m-rise .5s cubic-bezier(.2,.9,.2,1) both}
.m-mark{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;font-size:28px;flex:none;
  background:linear-gradient(145deg,rgba(167,139,250,.35),rgba(236,72,153,.2));
  border:1px solid var(--border-strong);box-shadow:inset 0 1px 0 rgba(255,255,255,.25),var(--shadow)}
.m-header-text{flex:1;min-width:0}
.m-eyebrow{font-size:10px;letter-spacing:.18em;font-weight:700;color:var(--text-faint);margin:0 0 4px}
.m-header h1{margin:0;font-size:19px;font-weight:700;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m-subtitle{margin:2px 0 0;font-size:12px;color:var(--text-dim)}
.m-balance-chip{display:flex;align-items:baseline;gap:3px;padding:8px 12px;border-radius:14px;
  background:var(--surface-2);border:1px solid var(--border);font-variant-numeric:tabular-nums}
.m-balance-chip span{font-weight:700;font-size:16px}
.m-balance-chip small{font-size:10px;color:var(--text-dim)}
.m-alerts{display:flex;flex-direction:column;gap:8px}
.m-alert{padding:12px 14px;border-radius:14px;font-size:13px;animation:m-rise .35s cubic-bezier(.2,.9,.2,1) both;border:1px solid transparent}
.m-alert-error{background:rgba(251,113,133,.12);color:#ffb4c0;border-color:rgba(251,113,133,.25)}
.m-alert-success{background:rgba(52,211,153,.12);color:#86efc7;border-color:rgba(52,211,153,.25)}
.m-theme-light .m-alert-error{color:#b91c1c}
.m-theme-light .m-alert-success{color:#047857}
.m-viewport{min-height:340px}
.m-content{animation:m-in-right .42s cubic-bezier(.2,.9,.2,1) both}
.m-content.m-in-left{animation-name:m-in-left}
@keyframes m-in-right{from{opacity:0;transform:translateX(30px) scale(.98)}to{opacity:1;transform:none}}
@keyframes m-in-left{from{opacity:0;transform:translateX(-30px) scale(.98)}to{opacity:1;transform:none}}
@keyframes m-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.m-pane{display:flex;flex-direction:column;gap:14px}
.m-card{position:relative;border-radius:var(--radius);padding:20px;background:var(--surface);
  border:1px solid var(--border);box-shadow:var(--shadow);
  backdrop-filter:blur(24px) saturate(140%);-webkit-backdrop-filter:blur(24px) saturate(140%)}
.m-empty{display:flex;align-items:center;justify-content:center;gap:10px;min-height:180px;text-align:center;
  color:var(--text-dim);font-size:14px;animation:m-rise .4s both}
.m-btn{width:100%;border:0;border-radius:16px;padding:14px 18px;font-size:14px;font-weight:700;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:10px;transition:transform .15s ease,box-shadow .2s ease,opacity .2s ease;
  font-family:inherit;color:#fff}
.m-btn:active{transform:scale(.97)}
.m-btn:disabled{opacity:.5;cursor:not-allowed}
.m-btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:0 12px 28px -10px rgba(124,58,237,.7)}
.m-btn-light{background:var(--surface-2);color:var(--text);border:1px solid var(--border-strong)}
.m-btn-vip{background:linear-gradient(110deg,#ffe7a1,#f5c8e9);color:#352750;box-shadow:0 10px 24px -8px rgba(251,191,36,.6)}
.m-spinner{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;
  animation:m-spin .7s linear infinite;flex:none}
.m-btn-light .m-spinner{border-color:rgba(0,0,0,.2);border-top-color:var(--text)}
@keyframes m-spin{to{transform:rotate(360deg)}}
.m-wallet-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.m-hint{font-size:10px;color:var(--text-faint)}
.m-wallet-amount{display:flex;align-items:baseline;gap:6px;margin:6px 0 16px}
.m-wallet-num{font-size:52px;font-weight:800;letter-spacing:-.05em;line-height:1;
  background:linear-gradient(135deg,var(--accent),var(--accent-3));-webkit-background-clip:text;background-clip:text;color:transparent}
.m-wallet-unit{font-size:14px;color:var(--text-dim);font-weight:600}
.m-daily{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left}
.m-daily b{font-size:14px}
.m-daily small{font-size:11px;font-weight:500;opacity:.75}
.m-tip{display:flex;gap:14px;align-items:flex-start}
.m-tip-icon{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:22px;flex:none;
  background:linear-gradient(145deg,rgba(167,139,250,.3),rgba(34,211,238,.18));border:1px solid var(--border)}
.m-tip h3{margin:0 0 4px;font-size:14px}
.m-tip p{margin:0;font-size:12px;color:var(--text-dim);line-height:1.5}
.m-section-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:18px}
.m-section-icon{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;flex:none;font-size:18px;
  background:linear-gradient(145deg,rgba(167,139,250,.3),rgba(236,72,153,.16));border:1px solid var(--border)}
.m-section-head h2{margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em}
.m-section-head p{margin:3px 0 0;font-size:12px;color:var(--text-dim)}
.m-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.m-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.m-field-full{grid-column:1 / -1}
.m-field-label{font-size:11px;font-weight:600;color:var(--text-dim);letter-spacing:.02em}
.m-field input,.m-field select{width:100%;height:44px;padding:0 12px;border-radius:13px;font-size:14px;font-family:inherit;
  background:var(--surface-2);border:1px solid var(--border);color:var(--text);outline:none;
  transition:border-color .2s ease,background .2s ease,box-shadow .2s ease}
.m-field input:focus,.m-field select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(167,139,250,.18)}
.m-field input:disabled,.m-field select:disabled{opacity:.5;cursor:not-allowed}
.m-field select{appearance:none;-webkit-appearance:none;
  background-image:linear-gradient(45deg,transparent 50%,var(--text-dim) 50%),linear-gradient(135deg,var(--text-dim) 50%,transparent 50%);
  background-position:calc(100% - 18px) 20px,calc(100% - 13px) 20px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:34px}
.m-field select option{background:var(--bg-1);color:var(--text)}
.m-theme-light .m-field select option{background:#fff;color:#1a0f33}
.m-toggle{display:flex;align-items:center;gap:12px;padding:14px;border-radius:16px;background:var(--surface-2);
  border:1px solid var(--border);cursor:pointer;margin-bottom:14px}
.m-toggle input{position:absolute;opacity:0;pointer-events:none}
.m-toggle-track{width:46px;height:28px;border-radius:99px;background:var(--border-strong);position:relative;flex:none;
  transition:background .25s ease}
.m-toggle-thumb{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;
  transition:transform .3s cubic-bezier(.34,1.56,.64,1);box-shadow:0 2px 6px rgba(0,0,0,.3)}
.m-toggle input:checked + .m-toggle-track{background:linear-gradient(135deg,var(--accent),var(--accent-2))}
.m-toggle input:checked + .m-toggle-track .m-toggle-thumb{transform:translateX(18px)}
.m-toggle-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.m-toggle-text b{font-size:13px}
.m-toggle-text small{font-size:11px;color:var(--text-dim);line-height:1.4}
.m-note{margin:10px 0 0;font-size:11px;color:var(--text-faint);text-align:center}
.m-vip{overflow:hidden;color:#fff;background:linear-gradient(135deg,#1b2750,#3f3677 65%,#614886);border-color:transparent}
.m-vip-glow{position:absolute;width:200px;height:200px;right:-60px;top:-90px;border-radius:50%;
  background:radial-gradient(circle,rgba(188,169,255,.35),transparent 70%);pointer-events:none}
.m-vip-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;position:relative}
.m-vip-star{display:grid;place-items:center;width:40px;height:40px;border-radius:14px;font-size:22px;color:#31244e;
  background:linear-gradient(135deg,#ffe8a8,#d5b1ff)}
.m-vip-badge{border:1px solid rgba(255,255,255,.3);border-radius:20px;padding:5px 10px;color:#ffe7a8;font-size:10px;font-weight:900;letter-spacing:.12em}
.m-vip h2{margin:0 0 8px;font-size:22px;letter-spacing:-.02em;position:relative}
.m-vip > p{margin:0 0 18px;font-size:12px;line-height:1.55;color:#dbd9ee;position:relative;max-width:400px}
.m-vip-date{display:inline-block;border-radius:20px;padding:9px 14px;color:#edfffa;background:rgba(255,255,255,.14);font-size:12px;font-weight:600}
.m-perks{display:flex;flex-direction:column;gap:10px;margin:18px 0 0;position:relative}
.m-perk{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1)}
.m-perk > span{font-size:18px;flex:none}
.m-perk b{display:block;font-size:12px}
.m-perk small{display:block;font-size:10px;color:rgba(255,255,255,.6);margin-top:1px}
.m-vip-foot{display:block;margin-top:14px;font-size:9px;color:rgba(255,255,255,.55);position:relative}
.m-tabbar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom));
  width:calc(100% - 32px);max-width:528px;z-index:10;display:flex;padding:6px;border-radius:22px;
  background:var(--surface);border:1px solid var(--border-strong);
  backdrop-filter:blur(28px) saturate(160%);-webkit-backdrop-filter:blur(28px) saturate(160%);
  box-shadow:0 16px 40px -14px rgba(0,0,0,.55)}
.m-theme-light .m-tabbar{background:rgba(255,255,255,.82);box-shadow:0 16px 40px -18px rgba(76,29,149,.3)}
.m-tabbar-pill{position:absolute;top:6px;left:6px;width:calc((100% - 12px) / 3);height:calc(100% - 12px);border-radius:16px;
  background:linear-gradient(135deg,rgba(167,139,250,.28),rgba(124,58,237,.28));
  border:1px solid var(--border-strong);
  transition:transform .42s cubic-bezier(.34,1.4,.5,1);pointer-events:none}
.m-tab{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 4px;
  background:transparent;border:0;color:var(--text-faint);font-family:inherit;cursor:pointer;
  transition:color .25s ease,transform .2s ease}
.m-tab:active{transform:scale(.94)}
.m-tab-active{color:var(--text)}
.m-tab-icon{font-size:16px;line-height:1;transition:transform .3s cubic-bezier(.34,1.56,.64,1)}
.m-tab-active .m-tab-icon{transform:scale(1.15)}
.m-tab-label{font-size:10px;font-weight:700;letter-spacing:.02em}
.m-footer{max-width:560px;margin:0 auto;color:var(--text-faint);text-align:center;font-size:10px}
@media (max-width:400px){ .m-form-grid{grid-template-columns:1fr} .m-wallet-num{font-size:44px} }
`;