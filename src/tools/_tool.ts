/**
 * 공통 MCP 도구 등록 래퍼.
 *
 * ~1,035개 핸들러에 흩어져 있던 try/catch·toolText 보일러플레이트를 한 곳으로 모으고,
 * 도구 이름 휴리스틱 기반 MCP tool annotations(readOnly/destructive/idempotent 힌트)를
 * 자동 부여한다. annotations·prune·향후 로깅/페이지가드의 단일 주입 지점.
 *
 * - 핸들러는 raw 데이터를 반환하는 것이 기본 — 래퍼가 `toolText()`로 직렬화한다.
 * - dry-run 미리보기·confirm 거부·검증 에러처럼 핸들러가 직접 완성 응답(`{ content }`)을
 *   만든 경우는 그대로 통과시킨다(이중 직렬화 방지).
 * - annotations는 MCP 스펙상 **힌트**일 뿐 신뢰 보장이 없다 — 파괴적 도구의 confirm
 *   파라미터 게이트와 description의 `⚠️ Destructive` 경고는 그대로 유지한다(이중 방어).
 *
 * 설계: DESIGN_mid-term-improvements.md §1·§3
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, ZodRawShape } from "zod";
import { toolText } from "./_response.js";

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface DefineToolOpts {
  /** 휴리스틱 결과를 덮어쓸 명시적 annotations. */
  annotations?: ToolAnnotations;
  /** toolText prune 옵션 전달. */
  prune?: boolean;
}

/** 동사 토큰 → annotations 카테고리. 토큰 단위 정확 일치(부분 문자열 아님). */
const VERB_ANNOTATIONS: Record<string, ToolAnnotations> = {};
for (const v of ["get", "list", "describe", "search", "query", "check", "export",
  // head(존재 확인), download(다운로드), verify/test(검사), encrypt/decrypt/sign(무상태 연산)
  "head", "download", "verify", "test", "encrypt", "decrypt", "sign"]) {
  VERB_ANNOTATIONS[v] = { readOnlyHint: true };
}
for (const v of ["delete", "terminate", "remove", "destroy", "revoke", "purge", "disconnect",
  // kill(강제 종료), flush(캐시 데이터 삭제)
  "kill", "flush"]) {
  VERB_ANNOTATIONS[v] = { destructiveHint: true, idempotentHint: true };
}
for (const v of ["create", "add", "register", "request"]) {
  // idempotent 아님 — 재호출 시 중복 생성 가능
  VERB_ANNOTATIONS[v] = { destructiveHint: false };
}
for (const v of ["update", "set", "modify", "change", "associate", "disassociate", "attach", "detach",
  // enable/disable(토글), cancel(취소), apply(구성 적용) — 재호출해도 같은 결과
  "enable", "disable", "cancel", "apply",
  // 데이터 손실이 없는 라이프사이클 조작 — 파괴적으로 보지 않는다
  "start", "stop", "restart", "reboot", "resume", "suspend"]) {
  VERB_ANNOTATIONS[v] = { destructiveHint: false, idempotentHint: true };
}

/**
 * 도구 이름에서 annotations를 도출한다.
 *
 * 서비스 접두사가 붙는 이름(예: `ncloud_apigw_delete_stage`)이 많아 첫 토큰이 아니라
 * **토큰들 중 처음 등장하는 알려진 동사**로 판정한다.
 *
 * 스펙 기본값이 `destructiveHint=true`(write일 때)이므로, 비파괴 write 도구에
 * `destructiveHint: false`를 명시하는 것이 실질적으로 가장 중요하다.
 * 휴리스틱과 실제 동작이 다른 도구는 `defineTool`의 `opts.annotations`로 오버라이드.
 */
export function deriveAnnotations(name: string): ToolAnnotations {
  for (const token of name.replace(/^ncloud_/, "").split("_")) {
    const found = VERB_ANNOTATIONS[token];
    if (found) return found;
  }
  return {};
}

/** 핸들러가 이미 완성된 MCP 응답({ content: [...] })을 반환했는지 판별. */
function isToolResult(v: any): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    Array.isArray(v.content) &&
    v.content.every((c: any) => c && typeof c === "object" && typeof c.type === "string")
  );
}

/**
 * MCP 도구를 등록한다. `server.tool()` 직접 호출 대신 이 함수를 사용한다.
 *
 * @param handler raw 데이터(직렬화 전)를 반환하거나, 직접 만든 완성 응답을 반환한다.
 *                throw 된 에러는 `{ isError: true }` 텍스트 응답으로 변환된다.
 */
export function defineTool<Schema extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  schema: Schema,
  // SDK server.tool과 동일한 zod 추론 타입 — 핸들러 내부 콜백의 컨텍스트 타이핑 유지
  handler: (params: z.objectOutputType<Schema, z.ZodTypeAny>) => Promise<any>,
  opts?: DefineToolOpts
): void {
  const annotations = { ...deriveAnnotations(name), ...opts?.annotations };
  const wrapped = async (params: any) => {
    try {
      const result = await handler(params);
      return isToolResult(result)
        ? result
        : toolText(result, opts?.prune !== undefined ? { prune: opts.prune } : undefined);
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: error.message }], isError: true };
    }
  };
  // registerTool 제네릭(OutputArgs 기본값 없음 + zod 호환 셰이프)과 ZodRawShape 간
  // 추론 충돌을 피하기 위해 호출만 단언 — 호출부 타입 안전성은 defineTool 시그니처가 보장.
  (server.registerTool as any)(name, { description, inputSchema: schema, annotations }, wrapped);
}
