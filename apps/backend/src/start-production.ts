// `npm start` is an explicit request to use the configured live integrations.
process.env.APP_MODE = "production";
process.env.NODE_ENV ??= "production";
await import("./main.js");
