import { describe, it, expect, vi, beforeEach } from "vitest";
import { NcloudClient, stripHtml } from "./ncloud-client.js";

/**
 * mcp-test-report-20260915 F-02(실패 응답에 requestId 없음)·F-04(HTML 원문 노출) 회귀 테스트.
 */

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => lower[k.toLowerCase()] ?? (k.toLowerCase() === "retry-after" ? "0" : null),
      forEach: (cb: (v: string, k: string) => void) => Object.entries(lower).forEach(([k, v]) => cb(v, k)),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const GW_HTML_ERROR = {
  error: {
    errorCode: "80031",
    message:
      "<strong>Please try again in a few minutes.</strong><br><br>It is temporarily unavailable.<br>If the error persists, please contact Customer Service.",
    details: "",
  },
};

describe("stripHtml (F-04)", () => {
  it("게이트웨이 HTML 메시지를 평문으로 바꾼다 — <br>은 개행, 태그는 제거", () => {
    const out = stripHtml(GW_HTML_ERROR.error.message);
    expect(out).toBe("Please try again in a few minutes.\n\nIt is temporarily unavailable.\nIf the error persists, please contact Customer Service.");
    expect(out).not.toMatch(/<[a-z]/i);
  });

  it("엔티티를 복원한다", () => {
    expect(stripHtml("<div>a &amp; b &lt; c &quot;d&quot; &#39;e&#39;&nbsp;f</div>")).toBe("a & b < c \"d\" 'e' f");
  });

  it("태그가 없는 메시지는 그대로 둔다 (일반 에러 메시지 무변경)", () => {
    const plain = "Required field is not specified. location : configGroupNo";
    expect(stripHtml(plain)).toBe(plain);
    expect(stripHtml("a < b and c > d")).toBe("a < b and c > d");
  });

  it("알려진 HTML 태그가 아닌 꺾쇠 표기(플레이스홀더 <A> 등)는 건드리지 않는다", () => {
    expect(stripHtml("value must be <A> or <B>")).toBe("value must be <A> or <B>");
    expect(stripHtml("<p>")).toBe("<p>");
  });
});

describe("NcloudClient 실패 메시지 진단 정보 (F-02)", () => {
  let client: NcloudClient;

  beforeEach(() => {
    delete process.env.NCLOUD_LANG;
    client = new NcloudClient({
      accessKey: "testKey",
      secretKey: "testSecret",
      baseUrl: "https://cloudfunctions.apigw.ntruss.com",
    });
  });

  it("requestRaw 실패: 에러 코드·평문 메시지·HTTP 상태·요청 경로·요청 ID·재시도 가능 여부를 모두 싣는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(GW_HTML_ERROR, 400, {
      "x-ncp-apigw-request-id": "dceea818-7553-47ae-b2e8-54b8aefd31ff",
      "x-ncp-trace-id": "trace-abc",
    })));

    const err = await client
      .requestRaw("PUT", "/ncf/api/v2/packages/ksj-package/actions/ksj-repo-start", { platform: "vpc", type: "basic" }, { exec: {} })
      .catch((e: Error) => e);
    const msg = String(err);
    // 기존 형식 보존(다른 테스트·파서가 앞부분에 의존한다)
    expect(msg).toContain("API 호출 실패\n\n에러 코드: 80031\n메시지: Please try again in a few minutes.");
    // F-04: HTML 제거
    expect(msg).not.toContain("<strong>");
    expect(msg).not.toContain("<br>");
    // F-02: 진단 정보
    expect(msg).toContain("HTTP 상태: 400");
    expect(msg).toContain("요청: PUT /ncf/api/v2/packages/ksj-package/actions/ksj-repo-start");
    expect(msg).not.toContain("platform=vpc"); // 쿼리스트링은 싣지 않는다
    expect(msg).toContain("요청 ID (x-ncp-apigw-request-id): dceea818-7553-47ae-b2e8-54b8aefd31ff");
    expect(msg).toContain("트레이스 ID (x-ncp-trace-id): trace-abc");
    expect(msg).toMatch(/재시도 가능: 예/); // "try again" 문구 → 일시적 오류
    expect(msg).toMatch(/관측 시각: \d{4}-\d{2}-\d{2}T/);
  });

  it("request(GET 계열) 실패에도 같은 진단 정보가 붙는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      responseError: { returnCode: "900", returnMessage: "Required field is not specified. location : configGroupNo" },
    }, 400, { "x-ncp-apigw-request-id": "rid-1" })));

    const err = await client.request("/vcache/v2/createCloudCacheInstance", { a: "1" }).catch((e: Error) => e);
    const msg = String(err);
    expect(msg).toContain("에러 코드: 900");
    expect(msg).toContain("요청: GET /vcache/v2/createCloudCacheInstance");
    expect(msg).not.toContain("responseFormatType");
    expect(msg).toContain("요청 ID (x-ncp-apigw-request-id): rid-1");
    expect(msg).toMatch(/재시도 가능: 아니오/); // 400 + 값 문제 → 재시도 무의미
  });

  it("헤더에 요청 ID가 없으면 그 줄만 빠지고 나머지 진단은 남는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { errorCode: "404", message: "Not Found" } }, 404)));
    const msg = String(await client.requestRaw("GET", "/ncf/api/v2/packages/x", { platform: "vpc" }).catch((e: Error) => e));
    expect(msg).toContain("에러 코드: 404");
    expect(msg).not.toContain("요청 ID");
    expect(msg).toContain("HTTP 상태: 404");
    expect(msg).toContain("요청: GET /ncf/api/v2/packages/x");
  });

  it("5xx 는 메시지 내용과 무관하게 재시도 가능으로 표시한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { errorCode: "81311", message: "ACTION_NAT_EXCEPTION" } }, 500)));
    const msg = String(await client.requestRaw("PUT", "/ncf/api/v2/x", undefined, {}).catch((e: Error) => e));
    expect(msg).toMatch(/재시도 가능: 예/);
  });

  it("error.details 가 message 와 다르면 '상세' 줄로 싣는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      error: { errorCode: "80306", message: "ACTION_BODY_MISSING_FIELD", details: "limits.timeout is required" },
    }, 400)));
    const msg = String(await client.requestRaw("PUT", "/ncf/api/v2/x", undefined, {}).catch((e: Error) => e));
    expect(msg).toContain("상세: limits.timeout is required");
  });

  it("NCLOUD_LANG=en 이면 진단 줄도 영문이다", async () => {
    process.env.NCLOUD_LANG = "en";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(GW_HTML_ERROR, 400, { "x-ncp-apigw-request-id": "rid-en" })));
    const msg = String(await client.requestRaw("PUT", "/ncf/api/v2/x", undefined, {}).catch((e: Error) => e));
    expect(msg).toContain("API call failed\n\nError code: 80031");
    expect(msg).toContain("HTTP status: 400");
    expect(msg).toContain("Request: PUT /ncf/api/v2/x");
    expect(msg).toContain("Request ID (x-ncp-apigw-request-id): rid-en");
    expect(msg).toMatch(/Retryable: yes/);
    delete process.env.NCLOUD_LANG;
  });

  it("헤더 객체가 없는 응답(mock)에서도 죽지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: { errorCode: "1", message: "m" } }), text: async () => JSON.stringify({ error: { errorCode: "1", message: "m" } }),
    })));
    const msg = String(await client.request("/x", {}).catch((e: Error) => e));
    expect(msg).toContain("에러 코드: 1");
    expect(msg).toContain("HTTP 상태: 400");
  });
});
