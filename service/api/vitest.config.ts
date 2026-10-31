import { spawnSync } from "node:child_process";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const ENGINE_CLI = path.resolve(import.meta.dirname, "../engine/cli.py");

/** The ENGINE service binding, backed by the real Python engine (pairlab) via its CLI. */
async function engine(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.text() : "{}";
  const r = spawnSync("python3", [ENGINE_CLI, url.pathname], { input: body, encoding: "utf8" });
  if (r.status !== 0) return new Response(JSON.stringify({ detail: r.stderr }), { status: 500 });
  const out = JSON.parse(r.stdout);
  return new Response(JSON.stringify(out.body), { status: out.status, headers: { "content-type": "application/json" } });
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            DEV_MODE: "1",
            LINK_SECRET: "test-link-secret",
            CHANNEL_TOKEN: "chn_test",
            INBOUND_EMAIL_SECRET: "inbound-secret",
          },
          serviceBindings: { ENGINE: engine },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"], testTimeout: 30000 },
  };
});
