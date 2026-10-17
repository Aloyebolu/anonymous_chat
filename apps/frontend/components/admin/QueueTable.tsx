"use client";
import { STRINGS } from "@/lib/constants";
import type { AdminUser } from "@/lib/types";

export interface QueueTableProps {
  readonly users: readonly AdminUser[];
  readonly onOperatorMatch: (userId: string) => void;
}

export const QueueTable = ({ users, onOperatorMatch }: QueueTableProps) => {
  const waiting = users.filter((u) => u.waitingMs !== null);
  if (waiting.length === 0) return <p className="muted">{STRINGS.noWaiting}</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>{STRINGS.tableUser}</th>
          <th>{STRINGS.tableChannel}</th>
          <th>{STRINGS.tableWaited}</th>
          <th>{STRINGS.tablePrefs}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {waiting.map((u) => (
          <tr key={u.userId}>
            <td><code>{u.externalId}</code></td>
            <td>{u.channel}</td>
            <td>{Math.round((u.waitingMs ?? 0) / 1000)}s</td>
            <td>{u.profile ? `${u.profile.gender} · ${u.profile.country} → ${u.profile.preferredGender}` : <span className="muted">—</span>}</td>
            <td><button onClick={() => onOperatorMatch(u.userId)}>{STRINGS.operatorMatch}</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};