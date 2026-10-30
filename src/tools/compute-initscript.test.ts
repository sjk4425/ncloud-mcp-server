import { describe, it, expect } from "vitest";
import { redactShellSecrets } from "./_secrets.js";
import { annotateInitScriptSecrets } from "./compute-initscript.js";

// 금융존 테스트 S-01: Init Script 본문(셸)의 자격증명이 가려지지 않은 채 반환됐다.
// 더미 값은 push protection 오탐을 피하려고 하이픈을 섞은 문자열로만 쓴다.
const SCRIPT = [
  "#!/bin/bash",
  "export NCLOUD_ACCESS_KEY=dummy-access-" + "value-0001",
  "export NCLOUD_SECRET_KEY=dummy-secret-" + "value-for-tests",
  "DB_PASSWORD='quoted-pass-" + "word-123'",
  "ref_only=$SECRET_FROM_ENV",
  "echo done",
].join("\n");

describe("redactShellSecrets", () => {
  it("따옴표 없는 셸 대입과 따옴표 대입을 모두 가리고, 변수 참조는 건드리지 않는다", () => {
    const { text, count } = redactShellSecrets(SCRIPT);
    expect(count).toBe(3);
    expect(text).not.toContain("dummy-access-value-0001");
    expect(text).not.toContain("dummy-secret-value-for-tests");
    expect(text).not.toContain("quoted-password-123");
    expect(text).toContain("export NCLOUD_ACCESS_KEY=<REDACTED:");
    expect(text).toContain("$SECRET_FROM_ENV");
    expect(text).toContain("echo done");
  });

  it("시크릿이 없으면 원문 그대로", () => {
    expect(redactShellSecrets("#!/bin/bash\nyum -y update\n")).toEqual({ text: "#!/bin/bash\nyum -y update\n", count: 0 });
  });
});

describe("annotateInitScriptSecrets", () => {
  const result = { totalRows: 1, initScriptList: [{ initScriptNo: "1", initScriptContent: SCRIPT }] };

  it("기본: initScriptList[*].initScriptContent 를 가리고 secretsRedacted 플래그를 붙인다", () => {
    const out = annotateInitScriptSecrets(result, false);
    expect(out.secretsRedacted).toBe(true);
    expect(out.redactedCount).toBe(3);
    expect(out.initScriptList[0].initScriptContent).not.toContain("dummy-secret-value-for-tests");
    expect(result.initScriptList[0].initScriptContent).toContain("dummy-secret-value-for-tests"); // 입력 불변
  });

  it("includeSecrets=true: 원문 유지 + 경고", () => {
    const out = annotateInitScriptSecrets(result, true);
    expect(out.initScriptList[0].initScriptContent).toContain("dummy-secret-value-for-tests");
    expect(out.secretsDetected).toBe(3);
    expect(out.warning).toMatch(/UNREDACTED/);
  });

  it("목록이 없거나 시크릿이 없으면 응답 무변경", () => {
    expect(annotateInitScriptSecrets({ totalRows: 0 }, false)).toEqual({ totalRows: 0 });
    const clean = { initScriptList: [{ initScriptContent: "echo hi" }] };
    expect(annotateInitScriptSecrets(clean, false)).toBe(clean);
  });
});
