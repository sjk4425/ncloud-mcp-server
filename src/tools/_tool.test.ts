import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { defineTool, deriveAnnotations } from "./_tool.js";

// defineTool 의 `destructive` 옵션 동작 검증 (DESIGN_post-1.4.0 §1, v1.5.0).
// 가짜 server.registerTool 로 등록 결과(config)와 wrapped 핸들러를 포착한다.
interface Captured {
  name: string;
  inputSchema: Record<string, any>;
  annotations: Record<string, any>;
  handler: (params: any) => Promise<any>;
}

function capture(define: (server: any) => void): Captured {
  let cap: Captured | undefined;
  const server = {
    registerTool: (name: string, config: any, handler: any) => {
      cap = { name, inputSchema: config.inputSchema, annotations: config.annotations, handler };
    },
  };
  define(server);
  if (!cap) throw new Error("도구가 등록되지 않았다");
  return cap;
}

function textOf(result: any): string {
  return result.content[0].text;
}

describe("defineTool: destructive 옵션 (confirm 게이트)", () => {
  it("confirm 미선언 시 confirm 파라미터를 스키마에 주입한다", () => {
    const t = capture((server) =>
      defineTool(server, "ncloud_delete_thing", "d", { id: z.string() }, async (p) => p, {
        destructive: { noun: "Thing", describe: (p) => p.id },
      })
    );
    expect(Object.keys(t.inputSchema).sort()).toEqual(["confirm", "id"]);
  });

  it("confirm이 이미 선언돼 있으면 그대로 둔다 (중복 주입 없음)", () => {
    const declared = z.boolean().optional().default(false);
    const t = capture((server) =>
      defineTool(server, "ncloud_delete_thing", "d", { id: z.string(), confirm: declared }, async (p) => p, {
        destructive: { noun: "Thing", describe: (p) => p.id },
      })
    );
    expect(t.inputSchema.confirm).toBe(declared);
  });

  it("destructive 옵션은 destructiveHint: true를 강제한다", () => {
    const t = capture((server) =>
      // 이름 휴리스틱상 비파괴(create)여도 destructive 옵션이 있으면 힌트가 부여돼야 한다
      defineTool(server, "ncloud_create_thing", "d", { id: z.string() }, async (p) => p, {
        destructive: { noun: "Thing", describe: (p) => p.id },
      })
    );
    expect(t.annotations.destructiveHint).toBe(true);
  });

  it("명시 annotations가 destructive 강제값보다 우선한다", () => {
    const t = capture((server) =>
      defineTool(server, "ncloud_delete_thing", "d", { id: z.string() }, async (p) => p, {
        destructive: { noun: "Thing", describe: (p) => p.id },
        annotations: { destructiveHint: false },
      })
    );
    expect(t.annotations.destructiveHint).toBe(false);
  });

  it("confirm falsy면 표준 템플릿 경고를 반환하고 핸들러는 실행하지 않는다 (구조형)", async () => {
    let called = false;
    const t = capture((server) =>
      defineTool(server, "ncloud_terminate_server", "d", { ids: z.array(z.string()) }, async (p) => {
        called = true;
        return { ok: true };
      }, { destructive: { action: "terminate", noun: "Server", describe: (p) => p.ids.join(", ") } })
    );
    const r = await t.handler({ ids: ["1", "2"] });
    expect(called).toBe(false);
    expect(textOf(r)).toBe(
      "⚠️ This will permanently terminate Server [1, 2]. To execute, call this tool again with confirm=true."
    );
  });

  it("confirm=true면 핸들러를 실행하고 confirm을 제거한 params를 전달한다", async () => {
    let received: any;
    const t = capture((server) =>
      defineTool(server, "ncloud_delete_thing", "d", { id: z.string() }, async (p) => {
        received = p;
        return { ok: true };
      }, { destructive: { noun: "Thing", describe: (p) => p.id } })
    );
    const r = await t.handler({ id: "abc", confirm: true });
    expect(received).toEqual({ id: "abc" }); // confirm 제거됨
    expect(JSON.parse(textOf(r))).toEqual({ ok: true });
  });

  it("커스텀 message는 구조형 필드보다 우선한다", async () => {
    const t = capture((server) =>
      defineTool(server, "ncloud_delete_thing", "d", { a: z.string(), b: z.string() }, async (p) => p, {
        destructive: { noun: "ignored", describe: () => "ignored", message: (p) => `CUSTOM ${p.a}/${p.b}` },
      })
    );
    const r = await t.handler({ a: "x", b: "y" });
    expect(textOf(r)).toBe("CUSTOM x/y");
  });

  it("action 기본값은 delete다", async () => {
    const t = capture((server) =>
      defineTool(server, "ncloud_delete_thing", "d", { id: z.string() }, async (p) => p, {
        destructive: { noun: "Thing", describe: (p) => p.id },
      })
    );
    const r = await t.handler({ id: "z" });
    expect(textOf(r)).toBe(
      "⚠️ This will permanently delete Thing [z]. To execute, call this tool again with confirm=true."
    );
  });

  it("비-destructive 도구는 게이트 없이 핸들러를 그대로 실행한다", async () => {
    const t = capture((server) =>
      defineTool(server, "ncloud_list_things", "d", {}, async () => ({ items: [] }))
    );
    const r = await t.handler({});
    expect(JSON.parse(textOf(r))).toEqual({ items: [] });
  });
});

// ─── 응답 크기 가드 (DESIGN_post-1.6.0 §3, v1.7.0) ───
// 옵트인(env) — 미설정 시 응답 형태가 완전히 무변경이어야 한다.
describe("defineTool: 응답 크기 가드 (NCLOUD_RESPONSE_MAXBYTES)", () => {
  const savedMax = process.env.NCLOUD_RESPONSE_MAXBYTES;
  afterEach(() => {
    if (savedMax === undefined) delete process.env.NCLOUD_RESPONSE_MAXBYTES;
    else process.env.NCLOUD_RESPONSE_MAXBYTES = savedMax;
  });

  it("미설정 시 응답 형태 무변경(전체 반환)", async () => {
    delete process.env.NCLOUD_RESPONSE_MAXBYTES;
    const items = Array.from({ length: 100 }, (_, i) => ({ i, blob: "a".repeat(40) }));
    const t = capture((server) =>
      defineTool(server, "ncloud_list_things", "d", {}, async () => ({ items }))
    );
    const parsed = JSON.parse(textOf(await t.handler({})));
    expect(parsed.items.length).toBe(100);
    expect(parsed.truncated).toBeUndefined();
  });

  it("설정 시 대형 읽기 응답을 임계 이하로 자르고 회복 힌트 제공", async () => {
    process.env.NCLOUD_RESPONSE_MAXBYTES = "1500";
    const items = Array.from({ length: 100 }, (_, i) => ({ i, blob: "a".repeat(40) }));
    const t = capture((server) =>
      defineTool(server, "ncloud_list_things", "d", {}, async () => ({ items }))
    );
    const r = await t.handler({});
    const parsed = JSON.parse(textOf(r));
    expect(parsed.truncated).toBe(true);
    expect(parsed.suggestedPageSize).toBe(parsed.items.length);
    expect(textOf(r).length).toBeLessThanOrEqual(1500);
  });

  it("쓰기 도구는 가드 미적용(readOnly 경로 아님)", async () => {
    process.env.NCLOUD_RESPONSE_MAXBYTES = "200";
    const items = Array.from({ length: 100 }, (_, i) => ({ i, blob: "a".repeat(40) }));
    const t = capture((server) =>
      defineTool(server, "ncloud_create_thing", "d", {}, async () => ({ items }))
    );
    const parsed = JSON.parse(textOf(await t.handler({})));
    expect(parsed.items.length).toBe(100);
    expect(parsed.truncated).toBeUndefined();
  });
});

describe("deriveAnnotations: 동사 휴리스틱 (회귀 가드)", () => {
  it("kill/flush는 파괴 힌트", () => {
    expect(deriveAnnotations("ncloud_flush_cache_server").destructiveHint).toBe(true);
    expect(deriveAnnotations("ncloud_dataforest_kill_master").destructiveHint).toBe(true);
  });
  it("get/list는 읽기 전용 힌트", () => {
    expect(deriveAnnotations("ncloud_list_servers").readOnlyHint).toBe(true);
    expect(deriveAnnotations("ncloud_edge_get_purge_history").readOnlyHint).toBe(true);
  });
});
