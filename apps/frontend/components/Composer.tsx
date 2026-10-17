"use client";
import { useState, type FormEvent } from "react";
import { STRINGS } from "@/lib/constants";

export interface ComposerProps {
  readonly onSend: (text: string) => void;
}

export const Composer = ({ onSend }: ComposerProps) => {
  const [text, setText] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    onSend(value);
  };

  return (
    <form
      className="composer flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-shadow focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-indigo-500 dark:focus-within:ring-indigo-500/20"
      onSubmit={submit}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={STRINGS.composerPlaceholder}
        autoComplete="off"
        aria-label={STRINGS.composerPlaceholder}
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-offset-slate-900"
      >
        {STRINGS.sendButton}
      </button>
    </form>
  );
};