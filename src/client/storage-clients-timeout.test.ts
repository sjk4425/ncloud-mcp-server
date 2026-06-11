import { describe, it, expect, vi, afterEach } from "vitest";
import { S3CompatibleClient } from "./s3-compatible-client.js";
import { SwiftCompatibleClient } from "./swift-compatible-client.js";

// S3/Swift 클라이언트도 공용 타임아웃 헬퍼(_timeout.ts)를 타는지 검증 (DESIGN §3-4).
// AbortSignal.timeout 의 실제 만료 대신 fetch 가 TimeoutError 를 던지는 상황을 mock 한다.

function stubTimeoutFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NCLOUD_TIMEOUT_MS;
});

describe("S3CompatibleClient: 타임아웃", () => {
  it("타임아웃 발생 시 사용자 친화 메시지로 변환", async () => {
    stubTimeoutFetch();
    const client = new S3CompatibleClient({
      accessKey: "testKey",
      secretKey: "testSecret",
      regionCode: "KR",
      storageType: "object",
    });

    await expect(client.request({ method: "GET" })).rejects.toThrow("API 호출 시간 초과");
  });

  it("NCLOUD_TIMEOUT_MS 오버라이드가 메시지 초 단위에 반영된다", async () => {
    process.env.NCLOUD_TIMEOUT_MS = "5000";
    stubTimeoutFetch();
    const client = new S3CompatibleClient({
      accessKey: "testKey",
      secretKey: "testSecret",
      regionCode: "KR",
    });

    await expect(client.request({ method: "GET" })).rejects.toThrow("API 호출 시간 초과(5s)");
  });
});

describe("SwiftCompatibleClient: 타임아웃", () => {
  it("인증(Keystone) 요청 타임아웃도 사용자 친화 메시지로 변환", async () => {
    stubTimeoutFetch();
    const client = new SwiftCompatibleClient({
      accessKey: "testKey",
      secretKey: "testSecret",
      projectId: "proj",
      domainId: "dom",
      regionCode: "KR",
    });

    await expect(client.request({ method: "GET" })).rejects.toThrow("API 호출 시간 초과");
  });
});
