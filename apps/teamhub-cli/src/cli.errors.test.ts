import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { writeCliConfig } from "./test-support/cli-config.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function run(args: readonly string[], response?: () => Response) {
  const cwd = await mkdtemp(path.join(tmpdir(), "teamhub-cli-errors-"));
  roots.push(cwd);
  const fetcher = vi.fn<typeof fetch>(async () => {
    if (!response) throw new TypeError("offline");
    return response();
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    cwd,
    env: writeCliConfig(path.join(cwd, "config"), {
      scope: { kind: "room", id: "room_fixture" },
    }),
    fetch: fetcher,
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join(""), fetcher };
}

describe("command errors name what to fix", () => {
  it("lists every missing Tracking Item field before any request", async () => {
    const result = await run([
      "tracking-items",
      "add",
      "--item",
      '{"kind":"meeting","content":"x"}',
    ]);
    expect(result.code).toBe(2);
    expect(result.fetcher).not.toHaveBeenCalled();
    expect(result.stderr).toBe(
      [
        "teamhub: invalid_input: The --item JSON does not match tracking-items add.",
        "Command: teamhub tracking-items add",
        "Issue: due_at: missing: required; use null if there is none.",
        "Issue: due_text: missing: required; use null if there is none.",
        "Issue: source_ref: missing: required.",
        "Issue: source_date: missing: required.",
        "Issue: source_timezone: missing: required.",
        "Issue: idempotency_key: missing: required.",
        "",
      ].join("\n"),
    );
  });

  it("gives JSON output the same issues", async () => {
    const result = await run([
      "tracking-items",
      "add",
      "--item",
      '{"kind":"event","content":"x","due_at":null,"due_text":null,"source_ref":"r","source_date":"2026-11-22","source_timezone":"UTC","idempotency_key":"k"}',
      "--json",
    ]);
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "invalid_input",
        message: "The --item JSON does not match tracking-items add.",
        command: "tracking-items add",
        details: {
          issues: [
            {
              path: "kind",
              code: "invalid_value",
              message: 'must be one of todo, question, meeting; got "event".',
            },
          ],
        },
      },
    });
  });

  it("shows a local message even when it names an address", async () => {
    const result = await run([
      "room",
      "handoff",
      "--inbox",
      "room_abc",
      "--content",
      "hi",
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "teamhub: usage: --inbox accepts only a room: address.",
    );
  });

  it("never sends a lone - as a body", async () => {
    const result = await run([
      "message",
      "send",
      "--attach",
      "report.pdf",
      "--content",
      "-",
    ]);
    expect(result.code).toBe(2);
    expect(result.fetcher).not.toHaveBeenCalled();
    expect(result.stderr).toContain(
      'Issue: --content: invalid_value: "-" would be sent as literal text; to read stdin use --file -.',
    );
  });

  it("names a local file the command could not reach", async () => {
    const result = await run([
      "docs",
      "get",
      "document_abc",
      "-o",
      "/nonexistent-teamhub-cli/dir/out.md",
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "Issue: file: unreadable: /nonexistent-teamhub-cli/dir: not found.",
    );
    expect(result.stderr).not.toContain("ENOENT");
  });

  it("replaces TeamHub's prose with the code's template but keeps its issues", async () => {
    const result = await run(
      ["agent", "get", "--agent-id", "actor_one"],
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "not_found",
              message: "agent actor_one missing in room:room_secret",
              request_id: "request_one",
              issues: [
                {
                  path: "actor_id",
                  code: "unknown_agent",
                  message: "No such Agent.",
                },
              ],
            },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    );
    expect(result.code).toBe(5);
    expect(result.stderr).toContain(
      "teamhub: not_found: The requested resource is unavailable.",
    );
    expect(result.stderr).toContain(
      "Issue: actor_id: unknown_agent: No such Agent.",
    );
    expect(result.stderr).not.toContain("room_secret");
  });
});
