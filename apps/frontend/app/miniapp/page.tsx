"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// CONTINUARE
