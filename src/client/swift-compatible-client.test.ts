import { describe, it, expect } from "vitest";
import { SwiftCompatibleClient } from "./swift-compatible-client.js";

/**
 * Archive Storage(Swift) 존별 엔드포인트 — client/endpoints.ts ARCHIVE_STORAGE_ENDPOINTS.
 * 근거: 민간존 https://api.ncloud-docs.com/docs/common-archivestorageapi-archivestorageapi ,
 *       공공존 https://api-gov.ncloud-docs.com/docs/common-archivestorageapi-archivestorageapi (2026-09-30).
 */
describe("SwiftCompatibleClient: 존별 엔드포인트", () => {
  const base = { accessKey: "k", secretKey: "s", projectId: "p", domainId: "d" };

  it("zone 생략 = public: kr.archive.ncloudstorage.com (:5000 인증)", () => {
    const c = new SwiftCompatibleClient(base);
    expect(c.getZone()).toBe("public");
    expect(c.getEndpoints()).toEqual({ auth: "https://kr.archive.ncloudstorage.com:5000", api: "https://kr.archive.ncloudstorage.com" });
  });

  it("gov: kr.archive.gov-ncloudstorage.com (:5000 인증)", () => {
    const c = new SwiftCompatibleClient({ ...base, zone: "gov", regionCode: "KR" });
    expect(c.getEndpoints()).toEqual({ auth: "https://kr.archive.gov-ncloudstorage.com:5000", api: "https://kr.archive.gov-ncloudstorage.com" });
  });

  it("표에 없는 리전은 존의 KR 항목으로 대체된다 (두 존 모두 KR 단일 리전)", () => {
    expect(new SwiftCompatibleClient({ ...base, zone: "gov", regionCode: "KRS" }).getEndpoints().api).toBe("https://kr.archive.gov-ncloudstorage.com");
    expect(new SwiftCompatibleClient({ ...base, regionCode: "SGN" }).getEndpoints().api).toBe("https://kr.archive.ncloudstorage.com");
  });
});
