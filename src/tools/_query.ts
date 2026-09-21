/**
 * REST 계열 도구 공용 쿼리 문자열 빌더.
 * 배열 값은 같은 키를 반복한다(`sort=a,asc&sort=b,desc`). undefined는 생략.
 */
export type QueryValue = string | number | boolean | undefined | Array<string | number>;

export function withQuery(path: string, query: Record<string, QueryValue>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, String(item)));
    else qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
