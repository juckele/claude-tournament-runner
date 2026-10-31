// Types and helpers shared by the route modules.
import { loadAccess, Principal } from "./lib/auth";
import { ApiError, Env } from "./lib/core";

export type H = { Bindings: Env; Variables: { p: Principal } };

/** Shorthand used by route modules. */
export const access = (c: any) => loadAccess(c.env, c.get("p"), c.req.param("t"));

export async function body(c: any): Promise<any> {
  const ct = c.req.header("content-type") ?? "";
  if (!ct.includes("json")) {
    const text = await c.req.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError(400, "invalid_request", "body must be JSON");
    }
  }
  return c.req.json().catch(() => {
    throw new ApiError(400, "invalid_request", "body must be JSON");
  });
}

export const flag = (c: any, name: string) => ["1", "true", "yes"].includes(String(c.req.query(name) ?? "").toLowerCase());
