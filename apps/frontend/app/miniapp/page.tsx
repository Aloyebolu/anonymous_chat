"use client";

import { useCallback, useEffect, useState } from "react";

type Gender = "male" | "female" | "nonbinary";
type GenderPreference = Gender | "any";
interface MiniProfile {
  gender: Gender;
  country: string;
  preferredGender: GenderPreference;
  preferredCountry?: string;
  displayName?: string;
  showName?: boolean;
  age?: number;
  language?: string;
  vipUntil?: string;
}
interface TelegramMiniApp {
  initData: string;
  initDataUnsafe?: { user?: { first_name?: string } };
  ready(): void;
  expand(): void;
}
declare global { interface Window { Telegram?: { WebApp: TelegramMiniApp } } }

const API = process.env.NEXT_PUBLIC_MINI_APP_API ?? process.env.NEXT_PUBLIC_WEB_API ?? "http://localhost:3000";
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

export default function MiniAppPage() {
  const [initData, setInitData] = useState("");
  const [firstName, setFirstName] = useState("");
  const [profile, setProfile] = useState<MiniProfile | null>(null);
  const [points, setPoints] = useState(0);
  const [vipCost, setVipCost] = useState(100);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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
      const data = await request("/api/miniapp/me");
      setProfile(data.profile as MiniProfile);
      setPoints(Number(data.points ?? 0));
      setVipCost(Number(data.vipCostPoints ?? 100));
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

  const updateField = <K extends keyof MiniProfile>(key: K, value: MiniProfile[K]) => {
    setProfile((current) => current ? { ...current, [key]: value } : current);
  };

  const saveProfile = async () => {
    if (!profile) return;
    setBusy(true);
    setNotice(""); setError("");
    try {
      const data = await request("/api/miniapp/profile", "PATCH", {
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
      const data = await request("/api/miniapp/daily-check-in", "POST", {});
      setPoints(Number(data.points ?? points));
      setNotice(Number(data.earned) > 0 ? COPY.checkInDone : COPY.checkInAgain);
    } catch (reason) { setError(reason instanceof Error ? reason.message : COPY.error); }
    finally { setBusy(false); }
  };

  const buyVip = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request("/api/miniapp/vip", "POST", { idempotencyKey: crypto.randomUUID() });
      setProfile(data.profile as MiniProfile);
      setPoints(Number(data.points ?? points));
      setNotice(COPY.active);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : COPY.error;
      setError(message.includes("Not enough points") ? COPY.insufficient : message);
    } finally { setBusy(false); }
  };

  if (!initData) return <main className="mini-page"><section className="mini-card mini-empty">{COPY.signedOut}</section></main>;
  if (loading) return <main className="mini-page"><section className="mini-card mini-empty">{COPY.busy}</section></main>;
  if (!profile) return <main className="mini-page"><section className="mini-card mini-empty">{error || COPY.error}</section></main>;

  return (
    <main className="mini-page">
      <div className="mini-orb mini-orb-one" /><div className="mini-orb mini-orb-two" />
      <header className="mini-heading">
        <div className="mini-mark">🐧</div>
        <div><p className="mini-eyebrow">ANONYMOUS CHAT · YOUR SPACE</p><h1>{COPY.title}, {firstName}</h1><p>{COPY.subtitle}</p></div>
      </header>

      <section className="mini-wallet mini-card">
        <div><p className="mini-eyebrow">{COPY.points}</p><strong>{points}</strong><span> pts</span><p className="mini-cap">{COPY.cap}</p></div>
        <button className="mini-button mini-button-light" disabled={busy} onClick={() => void checkIn()}>
          <span className="mini-button-icon">✦</span><span><b>{COPY.daily}</b><small>{COPY.dailyReward}</small></span>
        </button>
      </section>

      {error && <p className="mini-alert mini-alert-error">{error}</p>}
      {notice && <p className="mini-alert mini-alert-success">{notice}</p>}

      <section className="mini-card mini-settings">
        <div className="mini-section-heading"><span className="mini-section-icon">✿</span><div><h2>{COPY.settings}</h2><p>{COPY.privacy}</p></div></div>
        <div className="mini-form-grid">
          <label>{COPY.name}<input value={profile.displayName ?? ""} maxLength={28} placeholder={firstName} onChange={(event) => updateField("displayName", event.target.value)} /></label>
          <label>{COPY.age}<input type="number" min={18} max={99} value={profile.age ?? ""} placeholder="18+" onChange={(event) => updateField("age", event.target.value ? Number(event.target.value) : undefined)} /></label>
          <label>{COPY.gender}<select value={profile.gender} disabled={!profile.vipUntil || Date.parse(profile.vipUntil) <= Date.now()} onChange={(event) => updateField("gender", event.target.value as Gender)}>{Object.entries(genderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{COPY.country}<input value={profile.country} maxLength={56} onChange={(event) => updateField("country", event.target.value)} /></label>
          <label>{COPY.language}<select value={profile.language ?? "en"} onChange={(event) => updateField("language", event.target.value)}>{languages.map((language) => <option key={language} value={language}>{language.toUpperCase()}</option>)}</select></label>
          <label>{COPY.preferredGender}<select value={profile.preferredGender} onChange={(event) => updateField("preferredGender", event.target.value as GenderPreference)}><option value="any">Anyone</option>{Object.entries(genderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="mini-full-row">{COPY.preferredCountry}<input value={profile.preferredCountry ?? ""} maxLength={56} placeholder="Any country" onChange={(event) => updateField("preferredCountry", event.target.value)} /></label>
        </div>
        <label className="mini-toggle"><input type="checkbox" checked={profile.showName ?? false} onChange={(event) => updateField("showName", event.target.checked)} /><span><b>{COPY.showName}</b><small>{COPY.privacy}</small></span></label>
        <button className="mini-button mini-button-primary" disabled={busy} onClick={() => void saveProfile()}>{busy ? "Saving…" : COPY.save}</button>
        {(!profile.vipUntil || Date.parse(profile.vipUntil) <= Date.now()) && <p className="mini-gender-note">{COPY.genderVip}</p>}
        <p className="mini-reward-note">{COPY.earn}</p>
      </section>

      <section className="mini-vip mini-card">
        <div className="mini-vip-top"><span className="mini-vip-star">✦</span><span className="mini-vip-badge">VIP</span></div>
        <h2>{profile.vipUntil && Date.parse(profile.vipUntil) > Date.now() ? COPY.active : COPY.vip}</h2>
        <p>{COPY.vipBody}</p>
        {profile.vipUntil && Date.parse(profile.vipUntil) > Date.now()
          ? <span className="mini-vip-date">Active until {new Date(profile.vipUntil).toLocaleDateString()}</span>
          : <button className="mini-button mini-button-vip" disabled={busy || points < vipCost} onClick={() => void buyVip()}>{COPY.buyVip(vipCost)}</button>}
        <small>Other secure payment options can be added alongside points.</small>
      </section>
      <footer className="mini-footer">Your name is private by default · You must be 18 or older</footer>
    </main>
  );
}
