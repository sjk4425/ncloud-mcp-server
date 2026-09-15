import { describe, it, expect } from "vitest";
import { redactSecrets, redactAtPath } from "./_secrets.js";

describe("_secrets: redactSecrets (F-03)", () => {
  it("현장 패턴 — Python 소스에 하드코딩된 access/secret key 대입을 가린다", () => {
    const code = [
      "def main(args):",
      '    access_key = "ABCDEFGHIJKLMNOPQRST"',
      '    secret_key = "dummy-secret-value-for-tests-0123456789a"',
      "    return {\"ok\": True}",
    ].join("\n");
    const { text, count } = redactSecrets(code);
    expect(count).toBe(2);
    expect(text).not.toContain("ABCDEFGHIJKLMNOPQRST");
    expect(text).not.toContain("dummy-secret-value-for-tests-0123456789a");
    expect(text).toContain('access_key = "<REDACTED:20 chars>"');
    expect(text).toContain('secret_key = "<REDACTED:40 chars>"');
    // 코드의 나머지는 그대로다 — "잘렸다"고 오해할 여지가 없어야 한다.
    expect(text).toContain("def main(args):");
    expect(text).toContain('return {"ok": True}');
  });

  it("JS/JSON/YAML 표기(콜론, 홑따옴표, 하이픈 헤더명)도 잡는다", () => {
    const src = [
      "const cfg = { apiKey: 'zzzzzzzzzzzzzzzz', password: \"hunter22hunter22\" };",
      '{"x-ncp-iam-access-key": "ABCDEFGHIJKLMNOPQRST"}',
      "client-secret: \"s3cr3t-s3cr3t-s3cr3t\"",
    ].join("\n");
    const { text, count } = redactSecrets(src);
    expect(count).toBe(4);
    expect(text).not.toContain("zzzzzzzzzzzzzzzz");
    expect(text).not.toContain("hunter22hunter22");
    expect(text).not.toContain("ABCDEFGHIJKLMNOPQRST");
    expect(text).not.toContain("s3cr3t-s3cr3t-s3cr3t");
  });

  it("값 형식만으로 식별되는 시크릿(ncp_iam_*, AKIA*, Bearer, PEM)을 가린다", () => {
    // AWS 키 ID 모양의 더미는 연결로 만든다 — 한 덩어리 리터럴로 두면 GitHub push protection이
    // 실제 키로 오인해 push를 막는다(2026-09-15 실제 발생). 런타임 값은 동일하다.
    const AWS_ID = "AKIA" + "ABCDEFGHIJKLMNOP";
    const src = [
      "k = os.environ.get('X') or 'ncp_iam_BPAMKR1234567890abcdefgh'",
      "aws = " + AWS_ID,
      "headers['Authorization'] = 'Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop'",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nABC\n-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const { text, count } = redactSecrets(src);
    expect(count).toBe(4);
    expect(text).not.toContain("BPAMKR1234567890abcdefgh");
    expect(text).not.toContain(AWS_ID);
    expect(text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(text).not.toContain("MIIEow");
  });

  it("오탐 방지 — 변수 참조·짧은 값·이름에 접미가 붙은 식별자는 건드리지 않는다", () => {
    const src = [
      'access_key = params["access_key"]',   // 따옴표로 감싼 값이 아니라 변수 참조
      'secret_key_name = "NCLOUD_SECRET_KEY"', // 이름이 _name 으로 끝난다
      'token = "short"',                       // 8자 미만
      "def get_token(): return token",
    ].join("\n");
    const { text, count } = redactSecrets(src);
    expect(count).toBe(0);
    expect(text).toBe(src);
  });

  it("문자열이 아니거나 빈 입력은 그대로 돌려준다", () => {
    expect(redactSecrets("")).toEqual({ text: "", count: 0 });
    expect(redactSecrets(undefined as any).count).toBe(0);
  });
});

describe("_secrets: redactAtPath", () => {
  it("중첩 경로의 문자열만 가리고 원본 객체는 수정하지 않는다", () => {
    const obj = { content: { exec: { code: 'secret_key = "dummy-secret-value-for-tests-0123456789a"', kind: "python:3.13" }, name: "a" } };
    const { value, count } = redactAtPath(obj, "content.exec.code");
    expect(count).toBe(1);
    expect(value.content.exec.code).toContain("<REDACTED:40 chars>");
    expect(value.content.exec.kind).toBe("python:3.13");
    expect(obj.content.exec.code).toContain("dummy-secret-value-for-tests-0123456789a"); // 원본 보존
  });

  it("경로가 없거나 문자열이 아니면 입력을 그대로 돌려준다", () => {
    const obj = { content: { exec: { binary: true } } };
    expect(redactAtPath(obj, "content.exec.code")).toEqual({ value: obj, count: 0 });
    expect(redactAtPath(obj, "nope.x.y")).toEqual({ value: obj, count: 0 });
  });
});
