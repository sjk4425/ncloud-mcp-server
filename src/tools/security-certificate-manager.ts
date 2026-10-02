import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Certificate Manager API 1.0
 * Base URL: https://certificatemanager.apigw.ntruss.com
 *
 * v1 API는 3개 엔드포인트를 제공:
 *   - GET  /api/v1/certificates              — 인증서 목록 조회
 *   - POST /api/v1/certificate/withExternal   — 외부 인증서 등록
 *   - DELETE /api/v1/certificate/{no}?certificateName=... — 인증서 삭제
 *
 * API 2.0(/api/v2, 24 op — 인증서 신청·재발급·체인/다운로드·폐지·자동 갱신·도메인·ACME EAB)은 `opts.v2`
 *   로 켜며 **민간존 전용**(공공·금융 가이드는 1.0 op 뿐)이다. 2.0은 **메인 계정 키 전용**: Ncloud 티켓 답변으로
 *   확정됐고, 2026-10-02 라이브 실측(Sub Account, NCP_ADMINISTRATOR + NCP_CERTIFICATE_MANAGER_MANAGER)에서도
 *   v2 조회가 전부 HTTP 403(빈 응답, x-ncp-apigw-response-origin: ENDPOINT)이고 같은 키로 v1은 정상이었다.
 *   역할 분담: 1.0 과 겹치는 조회·외부 등록·삭제는 1.0 도구를 기본으로 쓰고(어떤 키든 동작), 2.0 도구는 1.0 에
 *   없는 기능만 감싼다(삭제는 1.0 과 동일하므로 2.0 으로 중복 구현하지 않음). 2.0 호출이 403 이면 자동 폴백 대신
 *   메인 계정 키 안내 + (겹치는 op 는) 1.0 도구 이름을 돌려준다 — 두 API 는 응답 형태가 달라 몰래 바꾸면 후속
 *   자동화가 깨진다. 스펙: security-certificatemanager 개요의 "Certificate Manager API 2.0" 표 24쪽(2026-10-02 대조).
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

export interface CertificateManagerToolOptions {
  /**
   * 사설 인증서 발급(`POST /api/v1/certificate/issuePrivate`) 도구 등록 여부. 기본 false.
   * 공공존 가이드(security-certificatemanager-issueprivate)에만 있는 오퍼레이션이다(2026-09-30 확인).
   */
  issuePrivate?: boolean;
  /** API 2.0 도구(`ncloud_cm2_*`) 등록 여부. 기본 false. 민간존에서만 true 로 넘긴다(공공·금융 가이드에 2.0 없음). */
  v2?: boolean;
  /**
   * STS(`sts.apigw.<zone>`) 클라이언트. 2.0 호출이 403 으로 거부됐을 때 `GET /api/v1/caller-identity` 로 호출 주체
   * (userType Main/Sub, loginAlias)를 안내문에 싣는 데만 쓴다(best effort — 없거나 실패하면 생략).
   */
  stsClient?: NcloudClient;
}

/** 2.0 도구 description 공통 꼬리말 — 민간존 전용 + 메인 계정 키 필수. */
const V2_NOTE =
  "Public zone only. Requires a main-account API key — Certificate Manager 2.0 rejects Sub Account keys with HTTP 403 (confirmed by Ncloud support; verified 2026-10-02 with NCP_ADMINISTRATOR).";

/** 2.0 ↔ 1.0 이 겹치는 op: 403 안내문에 "어떤 키든 되는 1.0 도구" 이름을 싣는다. */
const V1_EQUIVALENT: Record<string, string> = {
  list: "ncloud_list_certificates",
  register: "ncloud_register_external_certificate",
  delete: "ncloud_delete_certificate",
};

/** 403 안내문. 테스트·문구 변경을 한 곳에서 하려고 export 한다. */
export async function buildV2DeniedMessage(stsClient: NcloudClient | undefined, v1Equivalent?: keyof typeof V1_EQUIVALENT): Promise<string> {
  const lines = [
    "Certificate Manager 2.0 denied this key (HTTP 403). Only main-account API keys can use the 2.0 API; Sub Account keys are rejected (confirmed by Ncloud support).",
  ];
  if (stsClient) {
    try {
      const who: any = await stsClient.requestRaw("GET", "/api/v1/caller-identity");
      if (who && typeof who === "object") {
        lines.push(`Caller identity (STS /api/v1/caller-identity): userType=${who.userType ?? "?"}${who.loginAlias ? `, loginAlias=${who.loginAlias}` : ""}.`);
      }
    } catch {
      // best effort only
    }
  }
  if (v1Equivalent) {
    lines.push(`For ${v1Equivalent} use the 1.0 tool ${V1_EQUIVALENT[v1Equivalent]}, which works with any key.`);
  } else {
    lines.push("This operation exists only in the 2.0 API — retry with the main account's Access Key / Secret Key.");
  }
  return lines.join("\n");
}

/** 에러 메시지가 HTTP 403(게이트웨이/엔드포인트 거부)인지 — NcloudClient 는 빈 403 을 `HTTP 403 (빈 응답|empty response)` 로 포맷한다. */
export function isHttp403(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP 403\b/.test(msg) || /\b403\b.*(Forbidden|Access denied|접근 거부|권한)/i.test(msg);
}

export function registerCertificateManagerTools(server: McpServer, client: NcloudClient, opts: CertificateManagerToolOptions = {}): void {
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

  // ─── 사설 인증서 발급 (공공존 전용) ──────────────────────────────────────────
  // 스펙: POST /api/v1/certificate/issuePrivate — caTag·certificateName·certificateType·keyType·period·
  // registPrivateKey·commonName 필수, 조직/주소 필드·SAN 배열 선택 (api-gov security-certificatemanager-issueprivate).
  if (opts.issuePrivate) {
    defineTool(
      server,
      "ncloud_issue_private_certificate",
      "Issue a private SSL/TLS certificate from a Private CA through Certificate Manager (Government zone only). Requires the caTag of an existing Private CA (ncloud_pca_list_cas).",
      {
        caTag: z.string().describe("CA identifier (caTag) from the Private CA list"),
        certificateName: z.string().describe("Certificate name (3-30 chars: letters, numbers, '-', must be unique)"),
        certificateType: z.enum(["NCP_PRIVATE", "NCP_PRIVATE_SSL"]).describe("Certificate type: NCP_PRIVATE or NCP_PRIVATE_SSL"),
        keyType: z.enum(["RSA2048", "RSA4096", "EC256", "EC521"]).describe("Key type: RSA2048 | RSA4096 | EC256 | EC521"),
        period: z.string().describe("Validity period: '1'~'3650' days, or 'MAX' for the maximum allowed"),
        registPrivateKey: z.boolean().describe("Whether to store the private key in Certificate Manager"),
        commonName: z.string().describe("Common Name (CN) — 1-64 characters"),
        organization: z.string().optional().describe("Organization (O) — 0-64 chars"),
        organizationUnit: z.string().optional().describe("Organizational Unit (OU) — 0-128 chars"),
        locality: z.string().optional().describe("Locality/city (L) — 0-128 chars"),
        stateProvince: z.string().optional().describe("State/Province (ST) — 0-128 chars"),
        streetAddress: z.string().optional().describe("Street address — 0-128 chars"),
        country: z.string().optional().describe("Country code (C) — ISO 3166-1 alpha-2"),
        dnsSans: z.array(z.string()).optional().describe("DNS Subject Alternative Names"),
        emailSans: z.array(z.string()).optional().describe("Email Subject Alternative Names"),
        ipSans: z.array(z.string()).optional().describe("IP Subject Alternative Names"),
      },
      async (params) => {
        const body: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(params)) if (v !== undefined) body[k] = v;
        const result = await client.requestRaw("POST", "/api/v1/certificate/issuePrivate", undefined, body);
        return assertReturnCode(result);
      }
    );
  }

  if (opts.v2) registerCertificateManagerV2Tools(server, client, opts.stsClient);
}

// ═══════════════════════════════════════════════════════════════════════════
// Certificate Manager API 2.0 (민간존 전용, 메인 계정 키 전용) — security-certificatemanager-* 2.0 표 24 op (삭제 제외 23 도구)
// ═══════════════════════════════════════════════════════════════════════════

type V2Equivalent = keyof typeof V1_EQUIVALENT;

function registerCertificateManagerV2Tools(server: McpServer, client: NcloudClient, stsClient?: NcloudClient): void {
  /** 2.0 핸들러 공통 래퍼: 403 이면 메인 계정 안내(+1.0 대체 도구)를 isError 응답으로 돌려준다. 그 외 에러는 그대로 던진다. */
  const v2 = <T>(run: () => Promise<T>, v1Equivalent?: V2Equivalent) => async () => {
    try {
      return assertReturnCode(await run());
    } catch (err) {
      if (!isHttp403(err)) throw err;
      return { content: [{ type: "text" as const, text: await buildV2DeniedMessage(stsClient, v1Equivalent) }], isError: true };
    }
  };
  const paging = {
    page: z.number().int().min(1).optional().describe("Page number (1-based)"),
    pageSize: z.number().int().min(1).optional().describe("Items per page"),
    certificateName: z.string().optional().describe("Restrict results to this certificate name"),
  };
  const pagingQuery = (p: { page?: number; pageSize?: number; certificateName?: string }) => {
    const q: Record<string, string | number | undefined> = {};
    if (p.page !== undefined) q.page = p.page;
    if (p.pageSize !== undefined) q.pageSize = p.pageSize;
    if (p.certificateName !== undefined) q.certificateName = p.certificateName;
    return Object.keys(q).length > 0 ? q : undefined;
  };
  const dnsNameSchema = z.array(z.string()).optional().describe("Domains for the certificate SAN (Subject Alternative Name)");

  // ─── Certificate Lookup ─────────────────────────────────────────────────────

  // security-certificatemanager-listcertificatetypes: GET /api/v2/certificate/certificateTypes
  defineTool(
    server,
    "ncloud_cm2_list_certificate_types",
    `List the certificate types Certificate Manager can issue or register (Certificate Manager 2.0). ${V2_NOTE}`,
    {},
    v2(() => client.requestRaw("GET", "/api/v2/certificate/certificateTypes"))
  );

  // security-certificatemanager-listcertificates: GET /api/v2/certificate/certificates?page&pageSize&certificateName
  defineTool(
    server,
    "ncloud_cm2_list_certificates",
    `List all certificates with paging (Certificate Manager 2.0). For a plain inventory prefer ncloud_list_certificates (1.0, works with any key); this one adds page/pageSize and the 2.0 response fields (certificate type, status, order). ${V2_NOTE}`,
    paging,
    (params) => v2(() => client.requestRaw("GET", "/api/v2/certificate/certificates", pagingQuery(params)), "list")()
  );

  // security-certificatemanager-listcloudcertificates: GET /api/v2/certificate/getCertificates
  defineTool(
    server,
    "ncloud_cm2_list_cloud_certificates",
    `List Cloud Basic SSL and Global Edge certificates issued through Certificate Manager (Certificate Manager 2.0). ${V2_NOTE}`,
    paging,
    (params) => v2(() => client.requestRaw("GET", "/api/v2/certificate/getCertificates", pagingQuery(params)))()
  );

  // security-certificatemanager-listadvancedcertificates: GET /api/v2/certificate/getPaidCertificates
  defineTool(
    server,
    "ncloud_cm2_list_advanced_certificates",
    `List Advanced (paid DV/OV) certificates and their orders (Certificate Manager 2.0). ${V2_NOTE}`,
    paging,
    (params) => v2(() => client.requestRaw("GET", "/api/v2/certificate/getPaidCertificates", pagingQuery(params)))()
  );

  // security-certificatemanager-listdcvstatuses: GET /api/v2/certificate/getVerificationInfo/{certificateNo}?domainAddress=
  defineTool(
    server,
    "ncloud_cm2_get_dcv_status",
    `Get the domain-control-validation (DCV) status and the DNS record to set for a requested SSL certificate (Certificate Manager 2.0). ${V2_NOTE}`,
    {
      certificateNo: z.number({ required_error: requiredError("certificateNo") }).int().describe("Certificate number"),
      domainAddress: z.string({ required_error: requiredError("domainAddress") }).describe("Domain (FQDN) to validate"),
    },
    (params) => v2(() => client.requestRaw("GET", `/api/v2/certificate/getVerificationInfo/${params.certificateNo}`, { domainAddress: params.domainAddress }))()
  );

  // security-certificatemanager-listrecentcertchanges: GET /api/v2/certificate/recentChanges?minutes|seconds|startDateTime+endDateTime
  defineTool(
    server,
    "ncloud_cm2_list_recent_changes",
    `List certificates whose status changed recently (Certificate Manager 2.0). Give exactly one of minutes, seconds, or startDateTime+endDateTime — omitting all is rejected (2101) and giving minutes and seconds together returns 0 rows. ${V2_NOTE}`,
    {
      minutes: z.number().int().min(1).max(10080).optional().describe("Changes in the last N minutes (1-10080)"),
      seconds: z.number().int().min(1).max(604800).optional().describe("Changes in the last N seconds (1-604800)"),
      startDateTime: z.string().optional().describe("Start of the window (use with endDateTime)"),
      endDateTime: z.string().optional().describe("End of the window (use with startDateTime)"),
    },
    async (params) => {
      const hasRange = params.startDateTime !== undefined || params.endDateTime !== undefined;
      const modes = [params.minutes !== undefined, params.seconds !== undefined, hasRange].filter(Boolean).length;
      if (modes !== 1 || (hasRange && (params.startDateTime === undefined || params.endDateTime === undefined))) {
        return { content: [{ type: "text" as const, text: "Specify exactly one window: minutes, seconds, or both startDateTime and endDateTime." }], isError: true };
      }
      const q: Record<string, string | number | undefined> = {};
      if (params.minutes !== undefined) q.minutes = params.minutes;
      if (params.seconds !== undefined) q.seconds = params.seconds;
      if (hasRange) { q.startDateTime = params.startDateTime; q.endDateTime = params.endDateTime; }
      return v2(() => client.requestRaw("GET", "/api/v2/certificate/recentChanges", q))();
    }
  );

  // ─── Certificate Request ────────────────────────────────────────────────────

  // security-certificatemanager-cloudbasiccertificaterequest: POST /api/v2/certificate/requestCertificateIssuance
  defineTool(
    server,
    "ncloud_cm2_request_cloud_basic_certificate",
    `Request a free Cloud Basic SSL certificate (Certificate Manager 2.0). DCV is by DNS CNAME record (validationMethod D) — check ncloud_cm2_get_dcv_status afterwards for the record to create. Use dryRun=true to preview. ${V2_NOTE}`,
    {
      certificateName: z.string({ required_error: requiredError("certificateName") }).describe("Certificate name"),
      commonName: z.string({ required_error: requiredError("commonName") }).describe("Domain for the certificate CN (e.g. *.example.com)"),
      dnsName: dnsNameSchema,
      validationMethod: z.enum(["D"]).optional().default("D").describe("DCV method: D = DNS CNAME record (the only documented value)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without requesting"),
    },
    async (params) => {
      const body: Record<string, unknown> = { certificateName: params.certificateName, commonName: params.commonName, validationMethod: params.validationMethod };
      if (params.dnsName !== undefined) body.dnsName = params.dnsName;
      if (params.dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Cloud Basic certificate request", endpoint: "/api/v2/certificate/requestCertificateIssuance", method: "POST", requestParams: body, noun: { ko: "Cloud Basic 인증서 신청", en: "Cloud Basic certificate request" } });
      return v2(() => client.requestRaw("POST", "/api/v2/certificate/requestCertificateIssuance", undefined, body))();
    }
  );

  // security-certificatemanager-advancedcertificaterequest: POST /api/v2/certificate/requestPaidCertificateIssuance
  defineTool(
    server,
    "ncloud_cm2_request_advanced_certificate",
    `Request a paid Advanced DV/OV certificate from a CSR (Certificate Manager 2.0). OV (NCP_PAID_OV_01) requires organizationNo. validationMethod D = one-time DNS TXT record, PD = persistent DNS TXT record (set once, reused for later validations). Use dryRun=true to preview. ${V2_NOTE}`,
    {
      csr: z.string({ required_error: requiredError("csr") }).describe("PEM-encoded Certificate Signing Request"),
      certificateType: z.enum(["NCP_PAID_DV_01", "NCP_PAID_OV_01"], { required_error: requiredError("certificateType") }).describe("NCP_PAID_DV_01 (Advanced DV) or NCP_PAID_OV_01 (Advanced OV)"),
      certificateName: z.string({ required_error: requiredError("certificateName") }).describe("Certificate name"),
      commonName: z.string({ required_error: requiredError("commonName") }).describe("Domain for the certificate CN"),
      dnsName: dnsNameSchema,
      validationMethod: z.enum(["D", "PD"], { required_error: requiredError("validationMethod") }).describe("DCV method: D (one-time DNS TXT) or PD (persistent DNS TXT)"),
      organizationNo: z.number().int().optional().describe("Organization number — required for NCP_PAID_OV_01"),
      keyAlgorithm: z.string().optional().describe("Key algorithm"),
      subscriptionPeriod: z.number().int().optional().describe("Subscription period"),
      requestToken: z.string().optional().describe("Request token"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without requesting"),
    },
    async (params) => {
      if (params.certificateType === "NCP_PAID_OV_01" && params.organizationNo === undefined) {
        return { content: [{ type: "text" as const, text: "organizationNo is required for NCP_PAID_OV_01 (Advanced OV)." }], isError: true };
      }
      const { dryRun, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
      if (dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Advanced certificate request", endpoint: "/api/v2/certificate/requestPaidCertificateIssuance", method: "POST", requestParams: body, noun: { ko: "Advanced 인증서 신청", en: "Advanced certificate request" } });
      return v2(() => client.requestRaw("POST", "/api/v2/certificate/requestPaidCertificateIssuance", undefined, body))();
    }
  );

  // security-certificatemanager-globaledgecertificaterequest: POST /api/v2/certificate/requestGedCertificateIssuance
  defineTool(
    server,
    "ncloud_cm2_request_global_edge_certificate",
    `Request a Global Edge (CDN) SSL certificate (Certificate Manager 2.0). Use dryRun=true to preview. ${V2_NOTE}`,
    {
      certificateName: z.string({ required_error: requiredError("certificateName") }).describe("Certificate name"),
      commonName: z.string({ required_error: requiredError("commonName") }).describe("Domain for the certificate CN"),
      dnsName: dnsNameSchema,
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without requesting"),
    },
    async (params) => {
      const body: Record<string, unknown> = { certificateName: params.certificateName, commonName: params.commonName };
      if (params.dnsName !== undefined) body.dnsName = params.dnsName;
      if (params.dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Global Edge certificate request", endpoint: "/api/v2/certificate/requestGedCertificateIssuance", method: "POST", requestParams: body, noun: { ko: "Global Edge 인증서 신청", en: "Global Edge certificate request" } });
      return v2(() => client.requestRaw("POST", "/api/v2/certificate/requestGedCertificateIssuance", undefined, body))();
    }
  );

  // security-certificatemanager-reissuecertificate: POST /api/v2/certificate/{certificateNo}/reissue
  defineTool(
    server,
    "ncloud_cm2_reissue_certificate",
    `Reissue an existing certificate from a new CSR (Certificate Manager 2.0). DCV is by DNS CNAME record (validationMethod D). Use dryRun=true to preview. ${V2_NOTE}`,
    {
      certificateNo: z.number({ required_error: requiredError("certificateNo") }).int().describe("Certificate number to reissue"),
      csr: z.string({ required_error: requiredError("csr") }).describe("PEM-encoded Certificate Signing Request"),
      certificateName: z.string({ required_error: requiredError("certificateName") }).describe("Certificate name"),
      commonName: z.string({ required_error: requiredError("commonName") }).describe("Domain for the certificate CN"),
      dnsName: dnsNameSchema,
      validationMethod: z.enum(["D"]).optional().default("D").describe("DCV method: D = DNS CNAME record"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without reissuing"),
    },
    async (params) => {
      const body: Record<string, unknown> = { csr: params.csr, certificateName: params.certificateName, commonName: params.commonName, validationMethod: params.validationMethod };
      if (params.dnsName !== undefined) body.dnsName = params.dnsName;
      const path = `/api/v2/certificate/${params.certificateNo}/reissue`;
      if (params.dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: certificate reissue", endpoint: path, method: "POST", requestParams: body, noun: { ko: "인증서 재발급", en: "certificate reissue" } });
      return v2(() => client.requestRaw("POST", path, undefined, body))();
    }
  );

  // security-certificatemanager-registerexternalcertificate: POST /api/v2/certificate/withExternal (2.0 adds certificateNo for renewal re-registration)
  defineTool(
    server,
    "ncloud_cm2_register_external_certificate",
    `Re-register (renew) an existing external certificate in place by certificateNo, or register a new one (Certificate Manager 2.0). For a first-time registration prefer ncloud_register_external_certificate (1.0, works with any key); use this tool when you need the 2.0 certificateNo renewal path. ${V2_NOTE}`,
    {
      certificateName: z.string({ required_error: requiredError("certificateName") }).describe("Certificate name"),
      certificateNo: z.number().int().optional().describe("Existing certificate number to renew/re-register (omit to register a new certificate)"),
      privateKey: z.string({ required_error: requiredError("privateKey") }).describe("PEM-encoded private key (decrypted)"),
      certificateBody: z.string({ required_error: requiredError("certificateBody") }).describe("PEM-encoded certificate body"),
      certificateChain: z.string({ required_error: requiredError("certificateChain") }).describe("PEM-encoded certificate chain"),
    },
    (params) => {
      const body: Record<string, unknown> = { certificateName: params.certificateName, privateKey: params.privateKey, certificateBody: params.certificateBody, certificateChain: params.certificateChain };
      if (params.certificateNo !== undefined) body.certificateNo = params.certificateNo;
      return v2(() => client.requestRaw("POST", "/api/v2/certificate/withExternal", undefined, body), "register")();
    }
  );

  // ─── Certificate Management ─────────────────────────────────────────────────

  // security-certificatemanager-getcertificatechain: GET /api/v2/certificate/exportCertificate/{certificateNo}/chain
  defineTool(
    server,
    "ncloud_cm2_get_certificate_chain",
    `Get a certificate in PEM form together with its chain (Certificate Manager 2.0). ${V2_NOTE}`,
    {
      certificateNo: z.number({ required_error: requiredError("certificateNo") }).int().describe("Certificate number"),
    },
    (params) => v2(() => client.requestRaw("GET", `/api/v2/certificate/exportCertificate/${params.certificateNo}/chain`))()
  );

  // security-certificatemanager-downloadcertificate: POST /api/v2/certificate/exportCertificate/{certificateNo} — body { certificateNo?, type: PEM } (body may not be omitted; "{}" at minimum), Accept application/zip → binary
  defineTool(
    server,
    "ncloud_cm2_download_certificate",
    `Download a certificate as a file (zip of PEM files) (Certificate Manager 2.0). Pass savePath to write the file to disk; otherwise it is returned inline as base64 when it is 256 KB or smaller. ${V2_NOTE}`,
    {
      certificateNo: z.number({ required_error: requiredError("certificateNo") }).int().describe("Certificate number"),
      type: z.enum(["PEM"]).optional().default("PEM").describe("Export format (PEM only)"),
      savePath: z.string().optional().describe("Local file path to save the downloaded file to (recommended)"),
    },
    (params) => v2(() => client.requestBinary("POST", `/api/v2/certificate/exportCertificate/${params.certificateNo}`, undefined, { certificateNo: params.certificateNo, type: params.type }, { savePath: params.savePath }))()
  );

  // security-certificatemanager-revokecertificate: POST /api/v2/certificate/revoke { orderId, certificateNo (0 = whole order), revokeType }
  defineTool(
    server,
    "ncloud_cm2_revoke_certificate",
    `⚠️ Destructive: Revoke an Advanced certificate (or the whole order with certificateNo=0) (Certificate Manager 2.0). Set confirm=true to execute. ${V2_NOTE}`,
    {
      orderId: z.string({ required_error: requiredError("orderId") }).describe("Order ID containing the certificate"),
      certificateNo: z.number({ required_error: requiredError("certificateNo") }).int().min(0).describe("Certificate number; 0 revokes every certificate in the order"),
      revokeType: z.enum(["affiliationChanged", "superseded", "cessationOfOperation", "unspecified"], { required_error: requiredError("revokeType") }).describe("Revocation reason"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    (params) => v2(() => client.requestRaw("POST", "/api/v2/certificate/revoke", undefined, { orderId: params.orderId, certificateNo: params.certificateNo, revokeType: params.revokeType }))(),
    { destructive: { message: (params) => `⚠️ This will revoke ${params.certificateNo === 0 ? `every certificate in order [${params.orderId}]` : `certificate #${params.certificateNo} of order [${params.orderId}]`} (${params.revokeType}). Revocation cannot be undone.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // security-certificatemanager-setrenewalstatus: POST /api/v2/certificate/setCertificateRenewal { certificateNo, renewalYn }
  defineTool(
    server,
    "ncloud_cm2_set_renewal_status",
    `Enable or disable automatic renewal for a certificate (Certificate Manager 2.0). ${V2_NOTE}`,
    {
      certificateNo: z.number({ required_error: requiredError("certificateNo") }).int().describe("Certificate number"),
      renewalYn: z.enum(["Y", "N"], { required_error: requiredError("renewalYn") }).describe("Y to enable auto renewal, N to disable"),
    },
    (params) => v2(() => client.requestRaw("POST", "/api/v2/certificate/setCertificateRenewal", undefined, { certificateNo: params.certificateNo, renewalYn: params.renewalYn }))()
  );

  // security-certificatemanager-registerprivatekey: POST /api/v2/certificate/registPrivateKey { certificateNo, privateKey }
  defineTool(
    server,
    "ncloud_cm2_register_private_key",
    `Register the private key for a certificate that was issued from an external CSR (Certificate Manager 2.0). ${V2_NOTE}`,
    {
      certificateNo: z.number({ required_error: requiredError("certificateNo") }).int().describe("Certificate number"),
      privateKey: z.string({ required_error: requiredError("privateKey") }).describe("PEM-encoded private key"),
    },
    (params) => v2(() => client.requestRaw("POST", "/api/v2/certificate/registPrivateKey", undefined, { certificateNo: params.certificateNo, privateKey: params.privateKey }))()
  );

  // security-certificatemanager-subscriptionextend: POST /api/v2/certificate/subscription/extend { orderId, subscriptionPeriod 1Y|2Y|3Y }
  defineTool(
    server,
    "ncloud_cm2_extend_subscription",
    `Extend the subscription period of an Advanced certificate order by 1, 2 or 3 years (Certificate Manager 2.0). ${V2_NOTE}`,
    {
      orderId: z.string({ required_error: requiredError("orderId") }).describe("Order ID to extend"),
      subscriptionPeriod: z.enum(["1Y", "2Y", "3Y"], { required_error: requiredError("subscriptionPeriod") }).describe("Extension period"),
    },
    (params) => v2(() => client.requestRaw("POST", "/api/v2/certificate/subscription/extend", undefined, { orderId: params.orderId, subscriptionPeriod: params.subscriptionPeriod }))()
  );

  // ─── Domain validation ──────────────────────────────────────────────────────

  // security-certificatemanager-listdomainvalidations: GET /api/v2/domain/domains
  defineTool(
    server,
    "ncloud_cm2_list_domains",
    `List registered domains and their DCV validation state (Certificate Manager 2.0). ${V2_NOTE}`,
    {
      page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      pageSize: z.number().int().min(1).optional().describe("Page size (default 10)"),
      domainAddress: z.string().optional().describe("Filter by domain address"),
      dcvType: z.enum(["PTXT", "TXT"]).optional().describe("Filter by DCV type"),
      orgNo: z.number().int().optional().describe("Filter by organization number"),
      validState: z.enum(["PENDING", "VALID", "INVALID"]).optional().describe("Filter by validation state"),
    },
    (params) => {
      const q: Record<string, string | number | undefined> = {};
      for (const [k, v] of Object.entries(params)) if (v !== undefined) q[k] = v as string | number;
      return v2(() => client.requestRaw("GET", "/api/v2/domain/domains", Object.keys(q).length > 0 ? q : undefined))();
    }
  );

  // security-certificatemanager-registerdomain: POST /api/v2/domain/domains { dmnAddr, dcvType, issueType, orgNo? }
  defineTool(
    server,
    "ncloud_cm2_register_domain",
    `Register a domain for certificate issuance and start its DCV (Certificate Manager 2.0). dcvType PTXT = set the DNS TXT record once and reuse it; TXT = a new record per issuance. ${V2_NOTE}`,
    {
      dmnAddr: z.string({ required_error: requiredError("dmnAddr") }).describe("Domain address"),
      dcvType: z.enum(["PTXT", "TXT"], { required_error: requiredError("dcvType") }).describe("DCV type: PTXT (persistent TXT) or TXT (per-issuance TXT)"),
      issueType: z.enum(["CONSOLE", "ACME"], { required_error: requiredError("issueType") }).describe("How certificates for this domain are issued: CONSOLE or ACME"),
      orgNo: z.number().int().optional().describe("Organization number"),
    },
    (params) => {
      const body: Record<string, unknown> = { dmnAddr: params.dmnAddr, dcvType: params.dcvType, issueType: params.issueType };
      if (params.orgNo !== undefined) body.orgNo = params.orgNo;
      return v2(() => client.requestRaw("POST", "/api/v2/domain/domains", undefined, body))();
    }
  );

  // security-certificatemanager-deletedomain: DELETE /api/v2/domain/domains/{dmnId}
  defineTool(
    server,
    "ncloud_cm2_delete_domain",
    `⚠️ Destructive: Delete a registered domain from Certificate Manager (Certificate Manager 2.0). Set confirm=true to execute. ${V2_NOTE}`,
    {
      dmnId: z.number({ required_error: requiredError("dmnId") }).int().describe("Domain ID (from ncloud_cm2_list_domains)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    (params) => v2(() => client.requestRaw("DELETE", `/api/v2/domain/domains/${params.dmnId}`))(),
    { destructive: { noun: "Certificate Manager domain", describe: (params) => String(params.dmnId) } }
  );

  // ─── ACME EAB credentials ───────────────────────────────────────────────────

  // security-certificatemanager-listeabcredentials: GET /api/v2/acme/accounts (no paging)
  defineTool(
    server,
    "ncloud_cm2_list_eab_credentials",
    `List ACME External Account Binding (EAB) credentials (Certificate Manager 2.0). The API ignores paging and returns every credential. ${V2_NOTE}`,
    {},
    v2(() => client.requestRaw("GET", "/api/v2/acme/accounts"))
  );

  // security-certificatemanager-createeabcredential: POST /api/v2/acme/account { validationMode, certificateTypeCode, validityDays, alias, organizationNo? }
  defineTool(
    server,
    "ncloud_cm2_create_eab_credential",
    `Create an ACME EAB credential so an ACME client can obtain certificates from Certificate Manager (Certificate Manager 2.0). NPO_01 (OV) requires organizationNo. ${V2_NOTE}`,
    {
      validationMode: z.enum(["PRE", "DNS01"], { required_error: requiredError("validationMode") }).describe("Validation mode: PRE (pre-validated domain) or DNS01"),
      certificateTypeCode: z.enum(["NPD_01", "NPO_01"], { required_error: requiredError("certificateTypeCode") }).describe("Certificate type: NPD_01 (DV) or NPO_01 (OV)"),
      validityDays: z.number({ required_error: requiredError("validityDays") }).int().min(1).describe("Certificate validity in days"),
      alias: z.string({ required_error: requiredError("alias") }).describe("ACME account alias"),
      organizationNo: z.string().optional().describe("Organization number — required for NPO_01"),
    },
    async (params) => {
      if (params.certificateTypeCode === "NPO_01" && params.organizationNo === undefined) {
        return { content: [{ type: "text" as const, text: "organizationNo is required for certificateTypeCode NPO_01 (OV)." }], isError: true };
      }
      const body: Record<string, unknown> = { validationMode: params.validationMode, certificateTypeCode: params.certificateTypeCode, validityDays: params.validityDays, alias: params.alias };
      if (params.organizationNo !== undefined) body.organizationNo = params.organizationNo;
      return v2(() => client.requestRaw("POST", "/api/v2/acme/account", undefined, body))();
    }
  );

  // security-certificatemanager-deactivateeabcredential: POST /api/v2/acme/account/{accountId}/deactivate
  defineTool(
    server,
    "ncloud_cm2_deactivate_eab_credential",
    `⚠️ Destructive: Deactivate an ACME EAB credential; ACME clients using it stop working (Certificate Manager 2.0). Set confirm=true to execute. ${V2_NOTE}`,
    {
      accountId: z.number({ required_error: requiredError("accountId") }).int().describe("ACME account ID (from ncloud_cm2_list_eab_credentials)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    (params) => v2(() => client.requestRaw("POST", `/api/v2/acme/account/${params.accountId}/deactivate`))(),
    { destructive: { noun: "ACME EAB credential", action: "deactivate", describe: (params) => String(params.accountId) } }
  );
}
