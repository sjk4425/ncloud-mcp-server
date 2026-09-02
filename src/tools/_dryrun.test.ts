import { describe, it, expect } from "vitest";
import { dryRunPreview } from "./_dryrun.js";

describe("dryRunPreview — 프리뷰는 입력이 아니라 전송 객체를 보여준다 (B-8)", () => {
  it("endpoint·method·requestParams·message를 모두 담는다", () => {
    const preview = dryRunPreview({
      label: "🔍 Dry-Run Preview: Test",
      endpoint: "/vcache/v2/createCloudCacheInstance",
      requestParams: { configGroupNo: "9964", vpcNo: "21538" },
      noun: { ko: "테스트", en: "test" },
    });

    expect(preview.label).toContain("Dry-Run");
    expect(preview.endpoint).toBe("/vcache/v2/createCloudCacheInstance");
    // Ncloud 일반 API는 생성도 GET이므로 기본값은 GET.
    expect(preview.method).toBe("GET");
    expect(preview.requestParams).toEqual({ configGroupNo: "9964", vpcNo: "21538" });
    expect(typeof preview.message).toBe("string");
  });

  it("undefined 필드는 제거한다 — 전송되지 않는 값을 전송되는 것처럼 보이지 않게 한다", () => {
    const preview = dryRunPreview({
      label: "L",
      endpoint: "/e",
      requestParams: { sent: "yes", omitted: undefined },
      noun: { ko: "n", en: "n" },
    });

    expect(preview.requestParams).toEqual({ sent: "yes" });
    expect(preview.requestParams).not.toHaveProperty("omitted");
  });

  it("notes는 requestParams와 섞이지 않고 최상위로 나간다", () => {
    const preview = dryRunPreview({
      label: "L",
      endpoint: "/e",
      requestParams: { a: 1 },
      noun: { ko: "n", en: "n" },
      notes: { warning_x: "careful" },
    });

    expect(preview.warning_x).toBe("careful");
    expect(preview.requestParams).toEqual({ a: 1 });
  });

  it("비밀 파라미터는 마스킹한다 — 프리뷰가 대화·로그에 남는다", () => {
    // 프리뷰가 전송 객체 그대로를 보여주게 되면서(B-8), 예전 손수 고른 필드 목록에는
    // 없던 자격증명이 실리게 됐다. 평문으로 내보내면 안 된다.
    const preview = dryRunPreview({
      label: "L",
      endpoint: "/e",
      requestParams: {
        cloudMysqlServiceName: "svc",
        cloudMysqlUserName: "admin",
        cloudMysqlUserPassword: "SuperSecret1!",
      },
      noun: { ko: "n", en: "n" },
    });

    const sent = preview.requestParams as Record<string, unknown>;
    expect(sent.cloudMysqlUserPassword).not.toBe("SuperSecret1!");
    expect(String(sent.cloudMysqlUserPassword)).toContain("redacted");
    // 값이 실려 나간다는 사실 자체는 확인 가능해야 한다.
    expect(String(sent.cloudMysqlUserPassword)).toContain("13");
    // 비밀이 아닌 필드는 그대로 보인다.
    expect(sent.cloudMysqlUserName).toBe("admin");
    // 직렬화 결과 어디에도 평문이 없어야 한다.
    expect(JSON.stringify(preview)).not.toContain("SuperSecret1!");
  });

  it("중첩 객체·배열 안의 비밀도 마스킹한다", () => {
    const preview = dryRunPreview({
      label: "L",
      endpoint: "/e",
      requestParams: {
        userList: [{ name: "a", password: "pw-in-list" }],
        nested: { keySecret: "sk-abc", accessKey: "AK-visible" },
      },
      noun: { ko: "n", en: "n" },
    });

    const json = JSON.stringify(preview);
    expect(json).not.toContain("pw-in-list");
    expect(json).not.toContain("sk-abc");
    // 식별자·토큰은 비밀이 아니므로 가리지 않는다.
    expect(json).toContain("AK-visible");
  });

  it("페이지네이션 토큰은 가리지 않는다 — 프리뷰에서 확인해야 할 값이다", () => {
    const preview = dryRunPreview({
      label: "L",
      endpoint: "/e",
      requestParams: { continuationToken: "tok-123", nextToken: "tok-456" },
      noun: { ko: "n", en: "n" },
    });

    const json = JSON.stringify(preview);
    expect(json).toContain("tok-123");
    expect(json).toContain("tok-456");
  });

  it("최상위 배열 본문(NKS addons 등)도 그대로 보여준다", () => {
    const addons = [{ addonName: "external-dns", version: "1.0.0" }];
    const preview = dryRunPreview({
      label: "L",
      endpoint: "/vnks/v2/clusters/x/addons",
      method: "POST",
      requestParams: addons,
      noun: { ko: "n", en: "n" },
    });

    expect(preview.requestParams).toEqual(addons);
  });
});
