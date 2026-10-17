"use client";
import { STRINGS } from "@/lib/constants";
import type { AdminUser } from "@/lib/types";

export const UserTable = ({ users, onShadowBan, onModerator }: { readonly users: readonly AdminUser[]; readonly onShadowBan: (userId: string, banned: boolean) => void; readonly onModerator: (userId: string, granted: boolean) => void }) => (
  <table>
    <thead>
      <tr>
        <th>{STRINGS.tableUser}</th>
        <th>{STRINGS.tableChannel}</th>
        <th>{STRINGS.tableEligibility}</th>
        <th>{STRINGS.tableProfile}</th>
        <th>{STRINGS.tableStatus}</th>
        <th>{STRINGS.reportedUsers}</th>
        <th>Moderator</th>
      </tr>
    </thead>
    <tbody>
      {users.map((u) => {
        const status = u.waitingMs !== null ? STRINGS.statusWaiting
          : u.conversationId ? STRINGS.statusInChat
          : STRINGS.statusIdle;
        const eligClass = u.eligibility === "eligible" ? "eligible" : "none";
        return (
          <tr key={u.userId}>
            <td><code>{u.externalId}</code></td>
            <td>{u.channel}</td>
            <td><span className={`pill ${eligClass}`}>{u.eligibility}</span></td>
            <td>{u.profile ? `${u.profile.gender} · ${u.profile.country} → ${u.profile.preferredGender}` : <span className="muted">—</span>}</td>
            <td><span className={`pill ${status === STRINGS.statusWaiting ? "waiting" : status === STRINGS.statusInChat ? "active" : ""}`}>{status}</span></td>
            <td><button onClick={() => onShadowBan(u.userId, !u.profile?.shadowBanned)}>{u.profile?.shadowBanned ? STRINGS.liftShadowBan : STRINGS.shadowBan}</button></td>
            <td><button onClick={() => onModerator(u.userId, !u.profile?.moderator)}>{u.profile?.moderator ? "Revoke" : "Grant"}{u.profile?.moderator && u.profile.moderatorAvailable ? " · Online" : ""}</button></td>
          </tr>
        );
      })}
    </tbody>
  </table>
);
