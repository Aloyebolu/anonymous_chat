"use client";
import { STRINGS } from "@/lib/constants";
import type { AdminReport } from "@/lib/types";

export const ReportsTable = ({ reports }: { readonly reports: readonly AdminReport[] }) => {
  if (reports.length === 0) return <p className="muted">{STRINGS.noReports}</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>{STRINGS.tableConversation}</th>
          <th>{STRINGS.tableReporter}</th>
          <th>{STRINGS.tableReported}</th>
          <th>{STRINGS.tableReason}</th>
          <th>{STRINGS.tableWhen}</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((r) => (
          <tr key={r.id}>
            <td><code>{r.conversationId.slice(0, 8)}</code></td>
            <td><code>{r.reporterId.slice(0, 8)}</code></td>
            <td><code>{r.reportedId.slice(0, 8)}</code></td>
            <td>{r.reason}</td>
            <td>{new Date(r.createdAt).toLocaleTimeString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};