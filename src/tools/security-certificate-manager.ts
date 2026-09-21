import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

/**
 * Certificate Manager API 1.0
 * Base URL: https://certificatemanager.apigw.ntruss.com
 *
 * v1 API는 3개 엔드포인트를 제공:
 *   - GET  /api/v1/certificates              — 인증서 목록 조회
 *   - POST /api/v1/certificate/withExternal   — 외부 인증서 등록
 *   - DELETE /api/v1/certificate/{no}?certificateName=... — 인증서 삭제
 *
 * API 2.0(/api/v2, 20 op — 인증서 신청·재발급·체인 조회·자동 갱신 등)은 의도적으로 감싸지 않는다.
 *   2026-09-21 라이브 실측: Sub Account(admin 정책) 키로 v2 조회 op 5종(certificateTypes,
 *   certificates, getCertificates, recentChanges …)을 부르면 전부 HTTP 403(빈 응답)이고, 같은 키로
 *   v1은 정상이다. 가짜 경로는 300(라우트 없음)을 돌려주므로 v2 경로는 실재하며 권한 계층에서
 *   거부되는 것이다 — 즉 v2는 메인 계정 키 전용이다. 이 서버는 Sub Account 키로 운용되므로 v1을 유지한다.
 *   v2가 Sub Account에 열리면 그때 확장한다(docs/PLAN_v1.16.0 §3).
 *
 * 주의:
 * - Certificate Manager API는 일반 Ncloud API와 달리 responseFormatType, regionCode
 *   쿼리 파라미터를 사용하지 않는다 (글로벌 서비스).
 * - 모든 요청에 Content-Type: application/json, Accept: application/json 헤더 필수.
 * - client.requestRaw()를 사용하여 자동 파라미터 주입을 회피한다.
 * - 실패는 두 형태로 온다. 입력 오류는 HTTP 400 + { returnCode: "2000"|"2100", returnMessage }
 *   (클라이언트가 그대로 에러로 올린다). 공통 오류코드 표의 1000/1006/2101/2200 등은 HTTP 200 +
 *   returnCode ≠ "0" 으로 올 수 있는데 NcloudClient는 최상위 returnCode를 보지 않으므로 여기서
 *   assertReturnCode()로 승격한다(2026-09-17 릴리스 노트에서 공통 오류코드 1000/1006/2101 추가).
 */

/**
 * certificateName 규칙 (createExternalCertificate, 2026-09-17 변경).
 * 문서: "영문자, 숫자, 특수문자 '-'를 조합하여 3~20자 이내" (이전 3~30자).
 * 2026-09-21 라이브 실측(returnCode 2000 메시지): "can only contain 3-20 English alphabet, numbers,
 * and '-' and must start with an alphabetic character" — 문서에 없는 "영문자로 시작" 규칙이 서버에 있다.
 * 삭제 도구의 certificateName은 기존(최대 30자) 인증서와 대조하는 값이라 이 규칙을 걸지 않는다.
 */
const CERT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{2,19}$/;
const CERT_NAME_RULE =
  "certificateName must be 3-20 characters, start with a letter, and contain only English letters, digits and '-' (Ncloud rule since 2026-09-17; previously 3-30 characters)";

const certificateNameSchema = z
  .string()
  .min(3, CERT_NAME_RULE)
  .max(20, CERT_NAME_RULE)
  .refine((v) => /^[A-Za-z]/.test(v), { message: `${CERT_NAME_RULE} — it must start with a letter` })
  .refine((v) => CERT_NAME_PATTERN.test(v), { message: CERT_NAME_RULE })
  .describe("Certificate name: 3-20 chars, must start with a letter, English letters/digits/'-' only, unique within the account (limit reduced from 30 to 20 chars on 2026-09-17)");

/** HTTP 200 으로 온 서비스 수준 실패(returnCode ≠ "0")를 에러로 승격한다. */
function assertReturnCode(result: any): any {
  if (result && typeof result === "object" && typeof result.returnCode === "string" && result.returnCode !== "0") {
    throw new Error(
      `Certificate Manager API 호출 실패 (returnCode ${result.returnCode}): ${String(result.returnMessage ?? "")}`.trim()
    );
  }
  return result;
}

export function registerCertificateManagerTools(server: McpServer, client: NcloudClient): void {
  // ─── 인증서 목록 조회 ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_certificates",
    "List all registered SSL/TLS certificates in Certificate Manager. Supports filtering by certificateName, certificateNo, or instanceNo.",
    {
      certificateName: z.string().optional().describe("Filter by certificate name"),
      certificateNo: z.number().optional().describe("Filter by certificate number"),
      instanceNo: z.number().optional().describe("Filter by instance number (Load Balancer, CDN+, Global Edge)"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | undefined> = {};
      if (params.certificateName !== undefined) queryParams["certificateName"] = params.certificateName;
      if (params.certificateNo !== undefined) queryParams["certificateNo"] = params.certificateNo;
      if (params.instanceNo !== undefined) queryParams["instanceNo"] = params.instanceNo;

      const hasQuery = Object.values(queryParams).some((v) => v !== undefined);
      const result = await client.requestRaw(
        "GET",
        "/api/v1/certificates",
        hasQuery ? queryParams : undefined
      );
      return assertReturnCode(result);
    }
  );

  // ─── 외부 인증서 등록 ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_register_external_certificate",
    "Register an external SSL certificate issued by a third-party CA (e.g. Let's Encrypt, ZeroSSL, DigiCert). certificateName: 3-20 chars, starts with a letter, letters/digits/'-' only (validated before the call).",
    {
      certificateName: certificateNameSchema,
      privateKey: z.string().describe("PEM-encoded private key (must be decrypted, not encrypted)"),
      publicKeyCertificate: z.string().describe("PEM-encoded certificate body (public key certificate)"),
      certificateChain: z.string().describe("PEM-encoded certificate chain (intermediate CA certificates)"),
    },
    async (params) => {
      const result = await client.requestRaw(
          "POST",
          "/api/v1/certificate/withExternal",
          undefined,
          {
            certificateName: params.certificateName,
            privateKey: params.privateKey,
            publicKeyCertificate: params.publicKeyCertificate,
            certificateChain: params.certificateChain,
          }
        );
      return assertReturnCode(result);
    }
  );

  // ─── 인증서 삭제 ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_certificate",
    "⚠️ Destructive: Permanently delete a registered certificate. Ensure it is not in use by any Load Balancer, CDN+, or Global Edge. Set confirm=true to execute.",
    {
      certificateNo: z.number().describe("Certificate number to delete (from ncloud_list_certificates)"),
      certificateName: z.string().min(1).describe("Certificate name (must match exactly for verification; older certificates may have up to 30 chars)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw(
        "DELETE",
        `/api/v1/certificate/${params.certificateNo}`,
        { certificateName: params.certificateName }
      );
      return assertReturnCode(result);
    },
    { destructive: { message: (params) => [
          `⚠️ This will permanently delete Certificate #${params.certificateNo} (${params.certificateName}).`,
          `Ensure it is not in use by any Load Balancer, CDN+, or Global Edge instance.`,
          ``,
          `To execute, call this tool again with confirm=true.`,
        ].join("\n") } }
  );
}
