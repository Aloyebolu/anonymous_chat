"use client";
import { useState, type FormEvent } from "react";
import { STRINGS } from "@/lib/constants";

export interface WebMediaUpload {
  readonly kind: "image" | "video" | "audio" | "voice" | "document";
  readonly mimeType: string;
  readonly filename: string;
  readonly base64: string;
}

export interface ComposerProps {
  readonly onSend: (text: string) => void;
  readonly onSendMedia: (media: WebMediaUpload) => Promise<void>;
}

export const Composer = ({ onSend, onSendMedia }: ComposerProps) => {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    onSend(value);
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setError("");
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("Choose a file smaller than 5 MB.");
      return;
    }
    const mimeType = file.type || "application/octet-stream";
    const kind: WebMediaUpload["kind"] = mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("video/")
        ? "video"
        : mimeType.startsWith("audio/")
          ? "audio"
          : "document";
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read the selected file."));
        reader.onload = () => typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("Could not read the selected file."));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      await onSendMedia({ kind, mimeType, filename: file.name, base64 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form
      className="composer flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-shadow focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-indigo-500 dark:focus-within:ring-indigo-500/20"
      onSubmit={submit}
    >
      <label className="web-attach-button">
        {uploading ? "Sending…" : "Attach"}
        <input
          type="file"
          className="web-attach-input"
          accept="image/*,video/*,audio/*,.pdf,.txt"
          disabled={uploading}
          onChange={(event) => {
            void upload(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
          aria-label="Attach a photo, video, audio file, or document"
        />
      </label>
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
      {error && <span className="web-attach-error" role="alert">{error}</span>}
    </form>
  );
};