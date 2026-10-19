"use client";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
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
  readonly context?: { readonly kind: "reply" | "edit"; readonly messageId: string; readonly preview: string };
  readonly onCancelContext: () => void;
}

const MAX_BYTES = 5 * 1024 * 1024;

function kindFromMime(mimeType: string): WebMediaUpload["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function readAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read the selected file."));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

const AttachIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
  </svg>
);

export const Composer = ({ onSend, onSendMedia, context, onCancelContext }: ComposerProps) => {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const previousContextKind = useRef<"reply" | "edit" | undefined>(undefined);

  useEffect(() => {
    if (context?.kind === "edit") setText(context.preview);
    else if (previousContextKind.current === "edit") setText("");
    previousContextKind.current = context?.kind;
  }, [context?.kind, context?.messageId, context?.preview]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || uploading) return;
    setText("");
    onSend(value);
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    if (file.size === 0 || file.size > MAX_BYTES) {
      setError("Choose a file smaller than 5 MB.");
      return;
    }
    const mimeType = file.type || "application/octet-stream";
    setUploading(true);
    try {
      const base64 = await readAsBase64(file);
      await onSendMedia({ kind: kindFromMime(mimeType), mimeType, filename: file.name, base64 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form className="cp-root" onSubmit={submit} aria-label="Message composer">
      <style>{CSS_TEXT}</style>

      {context && (
        <div className="cp-context">
          <div>
            <strong>{context.kind === "edit" ? "Editing message" : "Replying to message"}</strong>
            <span>{context.preview}</span>
          </div>
          <button type="button" onClick={() => { if (context.kind === "edit") setText(""); onCancelContext(); }} aria-label="Cancel reply or edit">×</button>
        </div>
      )}
      <div className={`cp-bar${error ? " cp-bar-error" : ""}`}>
        <button
          type="button"
          className="cp-attach"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || context?.kind === "edit"}
          aria-label="Attach a photo, video, audio file, or document"
          title="Attach"
        >
          {uploading ? <span className="cp-spinner" aria-hidden /> : <AttachIcon />}
        </button>
        <input
          ref={fileRef}
          type="file"
          className="cp-file"
          accept="image/*,video/*,audio/*,.pdf,.txt"
          disabled={uploading || context?.kind === "edit"}
          onChange={(event) => void upload(event)}
          tabIndex={-1}
        />

        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={STRINGS.composerPlaceholder}
          autoComplete="off"
          aria-label={STRINGS.composerPlaceholder}
          className="cp-input"
        />

        <button
          type="submit"
          disabled={!text.trim() || uploading}
          className="cp-send"
          aria-label={STRINGS.sendButton}
          title={STRINGS.sendButton}
        >
          <SendIcon />
        </button>
      </div>

      {error && <p className="cp-error" role="alert">{error}</p>}
    </form>
  );
};

const CSS_TEXT = `
.cp-root { display:flex; flex-direction:column; gap:6px; width:100%; }
.cp-root * { box-sizing:border-box; }
.cp-context {
  display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:8px 12px; border-left:3px solid #6366f1; border-radius:10px;
  background:rgba(99,102,241,.08); color:#334155; font-size:12px;
}
.cp-context > div { display:flex; flex-direction:column; min-width:0; gap:2px; }
.cp-context span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.75; }
.cp-context button { border:0; background:transparent; color:inherit; font-size:20px; cursor:pointer; }
@media (prefers-color-scheme: dark) { .cp-context { background:rgba(129,140,248,.12); color:#cbd5e1; } }

.cp-bar {
  display:flex; align-items:center; gap:6px;
  padding:6px; border-radius:22px;
  background:rgba(255,255,255,.9);
  border:1px solid rgba(15,23,42,.1);
  box-shadow:0 2px 12px -4px rgba(15,23,42,.12);
  transition:border-color .2s, box-shadow .2s, background .2s;
}
.cp-bar:focus-within {
  border-color:#6366f1;
  box-shadow:0 0 0 4px rgba(99,102,241,.16), 0 2px 12px -4px rgba(15,23,42,.12);
}
.cp-bar-error { border-color:#f43f5e; box-shadow:0 0 0 4px rgba(244,63,94,.14); }

@media (prefers-color-scheme: dark) {
  .cp-bar { background:rgba(15,23,42,.85); border-color:rgba(148,163,184,.16); box-shadow:0 2px 12px -4px rgba(0,0,0,.5); }
  .cp-bar:focus-within { border-color:#818cf8; box-shadow:0 0 0 4px rgba(129,140,248,.2); }
  .cp-bar-error { border-color:#fb7185; box-shadow:0 0 0 4px rgba(251,113,133,.18); }
}

.cp-attach, .cp-send {
  flex:none; display:grid; place-items:center;
  width:38px; height:38px; border-radius:50%;
  border:0; cursor:pointer; font-family:inherit;
  transition:background .18s, color .18s, transform .15s, opacity .18s;
}
.cp-attach:active, .cp-send:active { transform:scale(.92); }
.cp-attach:disabled, .cp-send:disabled { cursor:not-allowed; opacity:.45; transform:none; }

.cp-attach { background:rgba(99,102,241,.1); color:#4f46e5; }
.cp-attach:hover:not(:disabled) { background:rgba(99,102,241,.18); }
@media (prefers-color-scheme: dark) {
  .cp-attach { background:rgba(129,140,248,.14); color:#a5b4fc; }
  .cp-attach:hover:not(:disabled) { background:rgba(129,140,248,.24); }
}

.cp-send { background:linear-gradient(135deg,#6366f1,#4f46e5); color:#fff; box-shadow:0 4px 12px -4px rgba(79,70,229,.55); }
.cp-send:hover:not(:disabled) { box-shadow:0 6px 16px -4px rgba(79,70,229,.75); }
.cp-send:disabled { background:rgba(148,163,184,.25); color:rgba(148,163,184,.7); box-shadow:none; }
@media (prefers-color-scheme: dark) {
  .cp-send:disabled { background:rgba(148,163,184,.15); color:rgba(148,163,184,.5); }
}

.cp-file { display:none; }

.cp-input {
  flex:1; min-width:0; height:38px;
  padding:0 8px; border:0; background:transparent; outline:none;
  font-size:15px; font-family:inherit;
  color:#0f172a;
}
.cp-input::placeholder { color:#94a3b8; }
@media (prefers-color-scheme: dark) {
  .cp-input { color:#f1f5f9; }
  .cp-input::placeholder { color:#64748b; }
}

.cp-spinner {
  width:16px; height:16px; border-radius:50%;
  border:2px solid rgba(79,70,229,.25); border-top-color:#4f46e5;
  animation:cp-spin .7s linear infinite;
}
@media (prefers-color-scheme: dark) {
  .cp-spinner { border-color:rgba(165,180,252,.25); border-top-color:#a5b4fc; }
}
@keyframes cp-spin { to { transform:rotate(360deg); } }

.cp-error {
  margin:0; padding:0 6px;
  font-size:12px; color:#e11d48;
  animation:cp-rise .25s ease both;
}
@media (prefers-color-scheme: dark) { .cp-error { color:#fb7185; } }
@keyframes cp-rise { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:none; } }
`;