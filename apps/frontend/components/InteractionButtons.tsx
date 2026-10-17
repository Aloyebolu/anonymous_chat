"use client";

export interface InteractionButtonsProps {
  readonly actions: readonly { readonly id: string; readonly label: string }[];
  readonly onPick: (action: { id: string; label: string }) => void;
}

export const InteractionButtons = ({ actions, onPick }: InteractionButtonsProps) => (
  <div className="actions">
    {actions.map((action) => (
      <button key={action.id} onClick={() => onPick(action)}>{action.label}</button>
    ))}
  </div>
);