import { describe, expect, it } from "vitest";
import { WebChannelDriver } from "../src/infrastructure/channels/web/web-channel-driver.js";
import type { InboundEvent } from "../src/ports/channels.js";

const baseUrl = (driver: WebChannelDriver) => `http://127.0.0.1:${driver.port}`;

describe("web channel driver", () => {
  it("maps POST /api/send text into a message event", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    try {
      const res = await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "alice", text: "hello" })
      });
      expect(res.status).toBe(204);
      expect(received).toHaveLength(1);
      expect(received[0].kind).toBe("message");
      if (received[0].kind === "message") {
        expect(received[0].identity.externalId).toBe("alice");
        expect(received[0].content.text).toBe("hello");
      }
    } finally {
      await driver.stop();
    }
  });

  it("maps /commands into command events", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    try {
      await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "alice", text: "/find" })
      });
      expect(received[0].kind).toBe("command");
      if (received[0].kind === "command") expect(received[0].command).toBe("find");
    } finally {
      await driver.stop();
    }
  });

  it("maps actionId into an action event", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    const received: InboundEvent[] = [];
    await driver.start(async (event) => { received.push(event); });
    try {
      await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "alice", actionId: "confirm-adult" })
      });
      expect(received[0].kind).toBe("action");
      if (received[0].kind === "action") expect(received[0].actionId).toBe("confirm-adult");
    } finally {
      await driver.stop();
    }
  });

  it("rejects requests without user or payload", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    await driver.start(async () => {});
    try {
      const res = await fetch(`${baseUrl(driver)}/api/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "alice" })
      });
      expect(res.status).toBe(400);
    } finally {
      await driver.stop();
    }
  });

  it("routes non-web endpoints to the shared server handler", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    await driver.start(async () => {}, (_req, res) => {
      res.statusCode = 200;
      res.end("admin route");
    });
    try {
      const res = await fetch(`${baseUrl(driver)}/api/state`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("admin route");
    } finally {
      await driver.stop();
    }
  });

  it("does not throw when sending outbound to a user with no connected clients", async () => {
    const driver = new WebChannelDriver({ port: 0 });
    await driver.start(async () => {});
    try {
      await driver.sendMessage({ channel: "web", externalId: "nobody" }, { kind: "text", text: "hi" });
    } finally {
      await driver.stop();
    }
  });
});