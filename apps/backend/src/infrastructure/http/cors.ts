import type { ServerResponse } from "node:http";

export const applyCors = (res: ServerResponse): void => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
};

export const handlePreflight = (res: ServerResponse): void => {
  applyCors(res);
  res.statusCode = 204;
  res.end();
};
