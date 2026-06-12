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
 * 주의:
 * - Certificate Manager API는 일반 Ncloud API와 달리 responseFormatType, regionCode
 *   쿼리 파라미터를 사용하지 않는다 (글로벌 서비스).
 * - 모든 요청에 Content-Type: application/json, Accept: application/json 헤더 필수.
 * - client.requestRaw()를 사용하여 자동 파라미터 주입을 회피한다.
 */
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
      return result;
    }
  );

  // ─── 외부 인증서 등록 ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_register_external_certificate",
    "Register an external SSL certificate issued by a third-party CA (e.g. Let's Encrypt, ZeroSSL, DigiCert)",
    {
      certificateName: z.string().describe("Certificate name (3-30 chars, alphanumeric and '-', no duplicates)"),
      privateKey: z.string().describe("PEM-encoded private key (must be decrypted, not encrypted)"),
      publicKeyCertificate: z.string().describe("PEM-encoded certificate body (public key certificate)"),
      certificateChain: z.string().describe("PEM-encoded certificate chain (intermediate CA certificates)"),
    },
    async (params) => {
      return client.requestRaw(
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
    }
  );

  // ─── 인증서 삭제 ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_certificate",
    "⚠️ Destructive: Permanently delete a registered certificate. Ensure it is not in use by any Load Balancer, CDN+, or Global Edge. Set confirm=true to execute.",
    {
      certificateNo: z.number().describe("Certificate number to delete (from ncloud_list_certificates)"),
      certificateName: z.string().describe("Certificate name (must match exactly for verification)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = [
          `⚠️ This will permanently delete Certificate #${params.certificateNo} (${params.certificateName}).`,
          `Ensure it is not in use by any Load Balancer, CDN+, or Global Edge instance.`,
          ``,
          `To execute, call this tool again with confirm=true.`,
        ].join("\n");
        return { content: [{ type: "text" as const, text: message }] };
      }
      const result = await client.requestRaw(
        "DELETE",
        `/api/v1/certificate/${params.certificateNo}`,
        { certificateName: params.certificateName }
      );
      return result;
    }
  );
}
