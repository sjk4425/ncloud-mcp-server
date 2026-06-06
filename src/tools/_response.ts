/**
 * 공통 MCP 도구 응답 헬퍼.
 *
 * 모든 도구는 `{ content: [{ type: "text", text: ... }] }` 형태로 응답한다(CLAUDE.md 컨벤션).
 * 기존에는 각 도구가 `JSON.stringify(result, null, 2)`를 직접 호출해 들여쓰기가 포함된
 * 큰 응답을 만들었다. `toolText()`로 통일해 들여쓰기를 제거하고(토큰 30~40% 절감),
 * 선택적으로 빈 값을 prune 한다.
 *
 * 설계: DESIGN_modularization-and-response.md §3
 */

/**
 * 응답 객체에서 "정보 없음"에 해당하는 빈 값을 재귀적으로 제거한다.
 * 제거 대상: `null`, `undefined`, 빈 문자열 `""`, 빈 배열 `[]`, 빈 객체 `{}`.
 * 보존: 숫자 `0`, 불리언 `false` (의미 있는 값).
 *
 * ⚠️ 일부 NCP API는 의미 있는 `""`(빈 문자열)을 반환할 수 있으므로 기본 OFF(옵트인).
 */
export function prune(v: any): any {
  if (Array.isArray(v)) {
    const arr = v.map(prune).filter((x) => !isEmpty(x));
    return arr;
  }
  if (v !== null && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      const pruned = prune(val);
      if (!isEmpty(pruned)) out[k] = pruned;
    }
    return out;
  }
  return v;
}

function isEmpty(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

export interface ToolTextOptions {
  /** 빈 값 제거. 미지정 시 `NCLOUD_RESPONSE_PRUNE === "1"` 전역 설정을 따른다. */
  prune?: boolean;
}

/**
 * 도구 결과를 표준 MCP 텍스트 응답으로 직렬화한다.
 * 들여쓰기 없이(`JSON.stringify(data)`) 직렬화해 토큰을 절감한다.
 */
export function toolText(result: any, opts?: ToolTextOptions) {
  const doPrune = opts?.prune ?? (process.env.NCLOUD_RESPONSE_PRUNE === "1");
  const data = doPrune ? prune(result) : result;
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export interface PageMeta {
  pageNo: number;
  pageSize: number;
  /** 이 페이지에서 실제 반환된 항목 수(가드로 줄었을 수 있음). */
  returnedRows: number;
  /** 페이징 대상 전체 대비 더 받을 항목이 남았는지. */
  hasMore: boolean;
  /** 다음 페이지 번호. 가드로 잘렸으면(=페이지 건너뛰기 손실 위험) null. */
  nextPageNo: number | null;
  /** 하드 크기 가드가 이 페이지에서 항목을 잘랐으면 true. */
  truncated?: boolean;
  /**
   * 가드 발동 시, 이 값 이하의 `pageSize`로 재조회하면 (결정적 정렬 위에서) 전수를
   * 누락 없이 순회할 수 있다는 회복 힌트. 가드 미발동 시 미포함.
   */
  suggestedPageSize?: number;
}

export interface PageResult {
  items: any[];
  meta: PageMeta;
}

/**
 * 가공 완료된 항목 배열을 페이지로 자르고, 직렬화 크기 하드 가드를 적용한다.
 *
 * - 페이지네이션(`pageNo`/`pageSize`)이 주 메커니즘 — 안정 정렬된 배열을 결정적으로 슬라이스.
 * - 하드 가드는 backstop — 슬라이스 직렬화 길이가 `maxBytes` 초과 시 **항목 단위로**
 *   뒤에서부터 제거(글자 수 컷 금지 → JSON 깨짐/부분 항목 방지). 최소 1개는 남긴다.
 * - 가드가 발동하면 페이지 건너뛰기로 항목이 조용히 사라지는 걸 막기 위해 `nextPageNo`를
 *   주지 않는다(사용자는 `pageSize`를 줄이거나 쿼리를 좁혀 재조회).
 *
 * 호출자는 도메인 메타(`totalRows`/`matchedRows` 등)와 안내 문구를 결과에 합쳐 반환한다.
 */
export function paginateWithGuard(
  items: any[],
  opts: { pageNo?: number; pageSize: number; maxBytes: number }
): PageResult {
  const pageNo = Math.max(1, Math.floor(opts.pageNo ?? 1));
  const pageSize = Math.max(1, Math.floor(opts.pageSize));
  const start = (pageNo - 1) * pageSize;
  let slice = items.slice(start, start + pageSize);

  let truncated = false;
  while (slice.length > 1 && JSON.stringify(slice).length > opts.maxBytes) {
    slice = slice.slice(0, -1);
    truncated = true;
  }
  // 단일 항목 자체가 임계 초과면 더 줄일 수 없음 — 그래도 truncated로 표기(요약 필요 신호).
  if (slice.length >= 1 && JSON.stringify(slice).length > opts.maxBytes) {
    truncated = true;
  }

  const consumed = start + slice.length;
  const hasMore = consumed < items.length;
  const nextPageNo = truncated ? null : hasMore ? pageNo + 1 : null;
  return {
    items: slice,
    meta: {
      pageNo,
      pageSize,
      returnedRows: slice.length,
      hasMore,
      nextPageNo,
      // 가드로 잘렸으면 현재 pageSize로는 다음 페이지가 안전하지 않으므로(=항목 건너뛰기
      // 손실), 이번에 들어간 건수를 회복용 pageSize로 제안한다.
      ...(truncated ? { truncated: true, suggestedPageSize: Math.max(1, slice.length) } : {}),
    },
  };
}
