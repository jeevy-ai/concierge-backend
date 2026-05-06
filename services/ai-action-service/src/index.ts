import { Hono } from "hono";
import { cors } from "hono/cors";

export type Env = {
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ ok: true, service: "ai-action-service", version: "0.1.0" });
});

app.get("/api/actions", (c) => {
  return c.json({ actions: [], message: "Action service ready" });
});

export default app;
