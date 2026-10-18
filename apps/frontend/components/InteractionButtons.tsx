"use client";

export interface InteractionButtonsProps {
  readonly actions: readonly { readonly id: string; readonly label: string }[];
  readonly onPick: (action: { id: string; label: string }) => void;
}

export const InteractionButtons = ({ actions, onPick }: InteractionButtonsProps) => {
  if (actions.length === 0) return null;

  return (
    <div className="ib-root" role="group" aria-label="Suggested actions">
      <style>{CSS_TEXT}</style>
      {actions.map((action, index) => (
        <button
          key={action.id}
          type="button"
          className="ib-chip"
          style={{ animationDelay: `${index * 45}ms` }}
          onClick={() => onPick(action)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
};

const CSS_TEXT = `
.ib-root {
  display:flex; flex-wrap:wrap; gap:8px; align-items:center;
}
.ib-root * { box-sizing:border-box; }

.ib-chip {
  appearance:none;
  display:inline-flex; align-items:center;
  padding:8px 14px;
  border-radius:999px;
  border:1px solid rgba(99,102,241,.35);
  background:rgba(99,102,241,.08);
  color:#4f46e5;
  font-size:13px; font-weight:600; font-family:inherit; line-height:1;
  cursor:pointer; white-space:nowrap;
  transition:background .18s, border-color .18s, color .18s, transform .15s, box-shadow .18s;
  animation:ib-pop .3s cubic-bezier(.34,1.4,.5,1) both;
}
.ib-chip:hover {
  background:rgba(99,102,241,.16);
  border-color:rgba(99,102,241,.6);
  box-shadow:0 4px 14px -6px rgba(79,70,229,.55);
}
.ib-chip:active { transform:scale(.96); }
.ib-chip:focus-visible {
  outline:none;
  box-shadow:0 0 0 3px rgba(99,102,241,.3);
}

@media (prefers-color-scheme: dark) {
  .ib-chip {
    border-color:rgba(129,140,248,.35);
    background:rgba(129,140,248,.1);
    color:#a5b4fc;
  }
  .ib-chip:hover {
    background:rgba(129,140,248,.2);
    border-color:rgba(129,140,248,.65);
  }
  .ib-chip:focus-visible { box-shadow:0 0 0 3px rgba(129,140,248,.35); }
}

@media (prefers-reduced-motion: reduce) {
  .ib-chip { animation:none; }
}

@keyframes ib-pop {
  from { opacity:0; transform:scale(.85) translateY(4px); }
  to   { opacity:1; transform:none; }
}
`;