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
import { withRetryContext } from "../client/_retry-context.js";

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * 파괴적 도구의 confirm 게이트 설정.
 *
 * 지정 시 `defineTool` 래퍼가:
 *  1. `confirm` 파라미터를 inputSchema에 주입(이미 선언돼 있으면 그대로 둔다).
 *  2. 핸들러 실행 전 `params.confirm`이 falsy면 경고 응답을 반환(핸들러 미실행).
 *  3. 통과 시 `confirm`을 제거한 params를 핸들러에 전달.
 *  4. annotations에 `destructiveHint: true`를 자동 부여.
 *
 * 경고 문구는 두 방식 중 하나로 만든다:
 *  - 구조형(`noun`/`describe`/`action`): 표준 템플릿으로 통일된 문구를 생성한다.
 *    `⚠️ This will permanently {action} {noun} [{ids}]. To execute, call this tool again with confirm=true.`
 *  - 커스텀(`message`): 표준 템플릿으로 표현할 수 없는 경고(다중 식별자·복원/분리 등
 *    비-delete 동작·추가 안전 경고)는 전체 문구를 직접 만든다. 지정 시 구조형보다 우선.
 */
export interface DestructiveOpts {
  /** 경고 문구의 리소스 명사. 예: "Server", "ServerImage". (구조형) */
  noun?: string;
  /** 경고 문구의 `[ ]`에 표시할 식별자를 params에서 뽑는 함수. (구조형) */
  describe?: (params: any) => string;
  /** 표준 템플릿의 동사. 기본값 "delete". 예: "terminate", "remove". (구조형) */
  action?: string;
  /** 전체 경고 문구를 직접 만드는 함수. 지정 시 구조형 필드를 무시하고 이 문구를 사용. */
  message?: (params: any) => string;
}

export interface DefineToolOpts {
  /** 휴리스틱 결과를 덮어쓸 명시적 annotations. */
  annotations?: ToolAnnotations;
  /** toolText prune 옵션 전달. */
  prune?: boolean;
  /** 지정 시: confirm 파라미터 자동 주입 + 게이트 + destructiveHint. */
  destructive?: DestructiveOpts;
}

/** 주입용 표준 confirm 스키마 — 도구가 confirm을 직접 선언하지 않은 경우에만 사용. */
const CONFIRM_SCHEMA = z
  .boolean()
  .optional()
  .default(false)
  .describe("Must be true to actually execute the destructive operation");

/** confirm 게이트 경고 문구를 만든다. message(커스텀) 우선, 없으면 구조형 표준 템플릿. */
function buildConfirmMessage(opts: DestructiveOpts, params: any): string {
  if (opts.message) return opts.message(params);
  const action = opts.action ?? "delete";
  const ids = opts.describe ? opts.describe(params) : "";
  return `⚠️ This will permanently ${action} ${opts.noun} [${ids}]. To execute, call this tool again with confirm=true.`;
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
  // destructive 도구는 destructiveHint를 강제(명시 opts.annotations가 있으면 그것이 우선).
  const annotations = {
    ...deriveAnnotations(name),
    ...(opts?.destructive ? { destructiveHint: true } : {}),
    ...opts?.annotations,
  };
  // confirm 파라미터 주입 — 이미 선언돼 있으면 그대로 둔다(스냅샷 schemaKeys 불변).
  const inputSchema: ZodRawShape =
    opts?.destructive && !("confirm" in schema) ? { ...schema, confirm: CONFIRM_SCHEMA } : schema;
  // 읽기 전용 도구는 client 호출을 503/504/네트워크 재시도 컨텍스트로 감싼다(DESIGN_post-1.4.0 §4).
  const readOnly = annotations.readOnlyHint === true;
  const wrapped = async (params: any) => {
    try {
      if (opts?.destructive && !params?.confirm) {
        // 게이트 미통과 — 경고 문구만 반환하고 핸들러는 실행하지 않는다.
        return { content: [{ type: "text" as const, text: buildConfirmMessage(opts.destructive, params) }] };
      }
      // 통과 시 confirm을 제거한 params를 핸들러에 전달(핸들러가 API로 confirm을 흘리지 않도록).
      let handlerParams = params;
      if (opts?.destructive && params && typeof params === "object" && "confirm" in params) {
        const { confirm, ...rest } = params;
        handlerParams = rest;
      }
      const result = readOnly
        ? await withRetryContext({ retryOn5xx: true }, () => handler(handlerParams))
        : await handler(handlerParams);
      return isToolResult(result)
        ? result
        : toolText(result, opts?.prune !== undefined ? { prune: opts.prune } : undefined);
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: error.message }], isError: true };
    }
  };
  // registerTool 제네릭(OutputArgs 기본값 없음 + zod 호환 셰이프)과 ZodRawShape 간
  // 추론 충돌을 피하기 위해 호출만 단언 — 호출부 타입 안전성은 defineTool 시그니처가 보장.
  (server.registerTool as any)(name, { description, inputSchema, annotations }, wrapped);
}
