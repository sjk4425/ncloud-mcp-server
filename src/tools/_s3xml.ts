/**
 * S3 호환 API(Object Storage / Ncloud Storage) XML 본문 생성·파싱 공용 헬퍼.
 *
 * 외부 XML 라이브러리를 들이지 않고(의존성 최소화 컨벤션) 정규식으로 처리한다.
 * 응답 파싱은 **블록을 먼저 잘라내고 필드를 개별로 뽑는** 방식만 쓴다 — 하나의 정규식으로
 * 요소 순서를 고정하면 실제 응답 순서와 어긋나는 순간 전 항목이 조용히 누락된다
 * (v1.11.0 라이브 테스트에서 `ncs_list_objects` 가 항상 빈 배열을 반환한 원인).
 */

export const S3_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";

/** 텍스트 노드/속성값용 이스케이프. 오브젝트 키에 `&`·`<` 가 들어오면 그대로 넣었을 때 MalformedXML 이 난다. */
export function xmlEscape(value: string | number | boolean): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 응답 XML 텍스트의 엔티티를 되돌린다(`&quot;abc&quot;` → `"abc"`). */
export function xmlUnescape(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** `<Name>value</Name>`. value 가 undefined/null 이면 빈 문자열(요소 생략). */
export function tag(name: string, value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return "";
  return `<${name}>${xmlEscape(value)}</${name}>`;
}

/** 이미 직렬화된 자식 XML 을 감싼다. children 이 비어 있으면 요소 자체를 생략한다. */
export function wrap(name: string, children: string, opts?: { keepEmpty?: boolean }): string {
  if (!children && !opts?.keepEmpty) return "";
  return `<${name}>${children}</${name}>`;
}

/** 루트 요소(S3 네임스페이스 포함) + XML 선언. */
export function xmlDocument(rootName: string, children: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><${rootName} xmlns="${S3_XMLNS}">${children}</${rootName}>`;
}

/** 첫 번째 `<Name>…</Name>` 의 텍스트(엔티티 복원). 없으면 undefined. */
export function text(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? xmlUnescape(m[1]) : undefined;
}

/** 첫 번째 `<Name>…</Name>` 의 내부 XML(원문 그대로). 없으면 undefined. */
export function block(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : undefined;
}

/** 모든 `<Name>…</Name>` 의 내부 XML 배열. */
export function blocks(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** 모든 `<Name>…</Name>` 의 텍스트 배열. */
export function texts(xml: string, name: string): string[] {
  return blocks(xml, name).map(xmlUnescape);
}

export function intText(xml: string, name: string): number | undefined {
  const t = text(xml, name);
  if (t === undefined || t === "") return undefined;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function boolText(xml: string, name: string): boolean | undefined {
  const t = text(xml, name);
  if (t === undefined) return undefined;
  return t.trim().toLowerCase() === "true";
}
