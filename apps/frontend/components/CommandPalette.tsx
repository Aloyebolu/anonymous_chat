"use client";
import { STRINGS } from "@/lib/constants";

export interface CommandPaletteProps {
  readonly onCommand: (command: string) => void;
}

export const CommandPalette = ({ onCommand }: CommandPaletteProps) => (
  <div className="palette">
    {STRINGS.commands.map((cmd) => (
      <button key={cmd} onClick={() => onCommand(cmd)}>{cmd}</button>
    ))}
  </div>
);