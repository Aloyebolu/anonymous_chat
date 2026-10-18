import { describe, expect, it } from "vitest";
import type { UserId } from "../src/domain/types.js";
import { PostgresPointsRepository } from "../src/infrastructure/persistence/postgres-repositories.js";

type QueryCall = { sql: string; values?: readonly unknown[] };

function makeRepository(respond: (sql: string, values?: readonly unknown[]) => Record<string, unknown>[] = () => []) {
  const calls: QueryCall[] = [];
  const query = async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    const rows = respond(sql, values);
    return { rows, rowCount: rows.length };
  };
  const client = { query };
  const db = {
    query,
    transaction: async <T>(work: (transactionClient: typeof client) => Promise<T>) => work(client)
  };
  return { repository: new PostgresPointsRepository(db as never), calls };
}

const userId = "user-1" as UserId;

describe("PostgresPointsRepository balance projection", () => {
  it("reads the per-user projection without aggregating point events", async () => {
    const { repository, calls } = makeRepository((sql) =>
      sql.includes("FROM point_balances") ? [{ balance: "17" }] : []
    );

    await expect(repository.balance(userId)).resolves.toBe(17);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("FROM point_balances WHERE user_id = $1");
    expect(calls[0]?.sql).not.toContain("point_events");
  });

  it("increments the projection by the granted award after recording the event", async () => {
    const { repository, calls } = makeRepository((sql) => {
      if (sql.includes("SELECT points FROM point_events")) return [];
      if (sql.includes("SELECT COALESCE(SUM(points)")) return [{ total: "18" }];
      return [];
    });

    await expect(repository.awardActivity(userId, "award-1", 5, new Date("2026-10-18T12:00:00Z"))).resolves.toBe(2);
    const eventInsert = calls.findIndex(({ sql }) => sql.includes("INSERT INTO point_events"));
    const projectionWrite = calls.findIndex(({ sql }) => sql.includes("INSERT INTO point_balances"));
    expect(eventInsert).toBeGreaterThan(-1);
    expect(projectionWrite).toBeGreaterThan(eventInsert);
    expect(calls[projectionWrite]?.values).toEqual([userId, 2]);
  });

  it("checks and decrements the projection during a spend", async () => {
    const { repository, calls } = makeRepository((sql) => {
      if (sql.includes("FROM point_balances")) return [{ balance: "8" }];
      return [];
    });

    await expect(repository.spend(userId, "spend-1", 3)).resolves.toBe("spent");
    const balanceRead = calls.find(({ sql }) => sql.includes("FROM point_balances"));
    const projectionWrite = calls.find(({ sql }) => sql.includes("INSERT INTO point_balances"));
    expect(balanceRead?.sql).not.toContain("SUM");
    expect(projectionWrite?.values).toEqual([userId, -3]);
  });

  it("does not change the projection when a spend is insufficient", async () => {
    const { repository, calls } = makeRepository((sql) =>
      sql.includes("FROM point_balances") ? [{ balance: "2" }] : []
    );

    await expect(repository.spend(userId, "spend-2", 3)).resolves.toBe("insufficient");
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO point_events"))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO point_balances"))).toBe(false);
  });

  it("does not change the projection for a duplicate award", async () => {
    const { repository, calls } = makeRepository((sql) =>
      sql.includes("SELECT points FROM point_events") ? [{ points: 1 }] : []
    );

    await expect(repository.award(userId, "award-duplicate")).resolves.toBe(0);
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO point_balances"))).toBe(false);
  });
});
