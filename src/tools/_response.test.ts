import { describe, it, expect, afterEach } from "vitest";
import { responseMaxBytes, guardLargeResponse, toolText } from "./_response.js";

// 응답 크기 가드 (DESIGN_post-1.6.0 §3, v1.7.0). 옵트인(NCLOUD_RESPONSE_MAXBYTES).

describe("_response: responseMaxBytes (옵트인 게이트)", () => {
  const saved = process.env.NCLOUD_RESPONSE_MAXBYTES;
  afterEach(() => {
    if (saved === undefined) delete process.env.NCLOUD_RESPONSE_MAXBYTES;
    else process.env.NCLOUD_RESPONSE_MAXBYTES = saved;
  });

  it("미설정/0/음수/비수치면 0(가드 OFF)", () => {
    delete process.env.NCLOUD_RESPONSE_MAXBYTES;
    expect(responseMaxBytes()).toBe(0);
    for (const v of ["0", "-1", "x", ""]) {
      process.env.NCLOUD_RESPONSE_MAXBYTES = v;
      expect(responseMaxBytes()).toBe(0);
    }
  });
  it("양수면 그 값", () => {
    process.env.NCLOUD_RESPONSE_MAXBYTES = "5000";
    expect(responseMaxBytes()).toBe(5000);
  });
});

describe("_response: guardLargeResponse", () => {
  it("임계 이하면 입력을 그대로(무변경) 반환", () => {
    const data = { items: [1, 2, 3] };
    const out = guardLargeResponse(data, 10_000);
    expect(out.truncated).toBe(false);
    expect(out.data).toBe(data); // 동일 참조 — 무변경
  });

  it("maxBytes<=0이면 가드 OFF(무변경)", () => {
    const data = { items: [1, 2, 3] };
    expect(guardLargeResponse(data, 0).data).toBe(data);
  });

  it("객체: 가장 큰 배열을 항목 단위로 잘라 임계 이하로 만든다", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `server-${i}`.padEnd(40, "x") }));
    const data = { total: 100, items };
    const max = 1000;
    const out = guardLargeResponse(data, max);
    expect(out.truncated).toBe(true);
    expect(JSON.stringify(out.data).length).toBeLessThanOrEqual(max);
    expect(out.data.items.length).toBeLessThan(100);
    expect(out.data.items.length).toBeGreaterThanOrEqual(1);
    expect(out.data.truncated).toBe(true);
    expect(out.data.suggestedPageSize).toBe(out.data.items.length);
    expect(out.data.total).toBe(100); // 다른 키 보존
  });

  it("입력 객체를 변형하지 않는다(클론 반환 — 캐시 오염 방지)", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, blob: "z".repeat(50) }));
    const data = { items };
    guardLargeResponse(data, 500);
    expect(data.items.length).toBe(50); // 원본 불변
  });

  it("bare 배열은 { items, ... }로 감싼다", () => {
    const arr = Array.from({ length: 80 }, (_, i) => ({ id: i, blob: "y".repeat(30) }));
    const out = guardLargeResponse(arr, 600);
    expect(out.truncated).toBe(true);
    expect(Array.isArray(out.data.items)).toBe(true);
    expect(out.data.items.length).toBeLessThan(80);
    expect(out.data.truncated).toBe(true);
    expect(JSON.stringify(out.data).length).toBeLessThanOrEqual(600);
  });

  it("단일 거대 항목은 더 줄일 수 없어 최소 1개는 남긴다", () => {
    const data = { items: [{ id: 1, blob: "q".repeat(5000) }] };
    const out = guardLargeResponse(data, 100);
    expect(out.data.items.length).toBe(1); // 1개 미만으로는 못 줄임
  });

  it("배열 없는 객체는 줄일 수 없어 그대로 반환", () => {
    const data = { blob: "w".repeat(5000) };
    const out = guardLargeResponse(data, 100);
    expect(out.truncated).toBe(false);
    expect(out.data).toBe(data);
  });
});

describe("_response: toolText + maxBytes 통합", () => {
  it("maxBytes 미지정 시 가드 미적용(기존 동작)", () => {
    const big = { items: Array.from({ length: 200 }, (_, i) => ({ i })) };
    const r = toolText(big);
    expect(JSON.parse(r.content[0].text).items.length).toBe(200);
  });

  it("maxBytes 지정 시 가드 적용", () => {
    const big = { items: Array.from({ length: 200 }, (_, i) => ({ i, blob: "a".repeat(40) })) };
    const r = toolText(big, { maxBytes: 1000 });
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.truncated).toBe(true);
    expect(r.content[0].text.length).toBeLessThanOrEqual(1000);
  });

  it("prune 후 크기로 가드를 측정한다(과도 절단 방지)", () => {
    // 각 항목의 빈 필드는 prune으로 제거됨 → 가드는 작아진 크기 기준으로 덜 자른다.
    const items = Array.from({ length: 30 }, (_, i) => ({ id: i, empty: "", nil: null, keep: "v" }));
    const prunedItems = Array.from({ length: 30 }, (_, i) => ({ id: i, keep: "v" }));
    const withPrune = toolText({ items }, { prune: true, maxBytes: 100_000 });
    expect(JSON.parse(withPrune.content[0].text).items).toEqual(prunedItems);
  });
});
