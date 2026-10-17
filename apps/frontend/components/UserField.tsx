"use client";
import { STRINGS } from "@/lib/constants";

export interface UserFieldProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
}

export const UserField = ({ value, onChange }: UserFieldProps) => (
  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
    {STRINGS.headerUserLabel}
    <input value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);