import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

/**
 * Private CA (사설 인증 기관) 도구 등록
 * Base URL: https://pca.apigw.ntruss.com
 * RESTful API — GET/POST/PUT/DELETE with JSON body
 */
export function registerPrivateCaTools(server: McpServer, client: NcloudClient): void {

  // ─── CA Management ───────────────────────────────────────────────────────────

  // ncloud_pca_list_cas — Get CA List
  defineTool(
    server,
    "ncloud_pca_list_cas",
    "List all Private CA (Certificate Authority) instances. Returns CA info including status, type, alias, and certificate details.",
    {
      pageNo: z.number().optional().describe("Page number for pagination"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | undefined> = {};
      if (params.pageNo !== undefined) queryParams.pageNo = params.pageNo;
      const result = await client.requestRaw("GET", "/api/v1/ca", queryParams);
      return result;
    }
  );

  // ncloud_pca_get_ca — Get CA detail
  defineTool(
    server,
    "ncloud_pca_get_ca",
    "Get detailed information of a specific Private CA by its tag value.",
    {
      caTag: z.string().describe("CA tag value (identifier)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/ca/${params.caTag}`);
    }
  );

  // ncloud_pca_create_ca — Create CA
  defineTool(
    server,
    "ncloud_pca_create_ca",
    "Create a new Private CA (Root CA or Sub CA). Requires alias, keyType, period, and x509Parameters.",
    {
      caType: z.enum(["PRIVATE_ROOT", "PRIVATE_SUB"]).describe("CA type: PRIVATE_ROOT (Root CA) or PRIVATE_SUB (Intermediate CA)"),
      issuerTag: z.string().optional().describe("Issuer CA tag value (required for PRIVATE_SUB when using internal signing)"),
      alias: z.string().describe("CA name (3-15 chars, alphanumeric + '-' + '_', starts with letter)"),
      memo: z.string().optional().describe("CA memo/description"),
      keyType: z.enum(["RSA2048", "RSA4096", "EC256", "EC521"]).describe("Key type for the CA"),
      period: z.string().describe("Validity period in days (1-3650) or 'MAX' for maximum"),
      commonName: z.string().describe("Common Name (1-64 chars)"),
      altName: z.string().optional().describe("DNS/Email SANs (domain/host name or email format)"),
      ip: z.string().optional().describe("IP SANs (IP address format)"),
      country: z.string().optional().describe("Country code (ISO 3166-1 alpha-2)"),
      locality: z.string().optional().describe("City name (0-128 chars)"),
      stateProvince: z.string().optional().describe("State/Province name (0-128 chars)"),
      organization: z.string().optional().describe("Organization name (0-64 chars)"),
      organizationUnit: z.string().optional().describe("Organization unit name (0-128 chars)"),
    },
    async (params) => {
      const queryParams: Record<string, string | undefined> = {
        caType: params.caType,
      };
      if (params.issuerTag !== undefined) queryParams.issuerTag = params.issuerTag;

      const body: Record<string, any> = {
        alias: params.alias,
        keyType: params.keyType,
        period: params.period,
        x509Parameters: {
          commonName: params.commonName,
        },
      };
      if (params.memo !== undefined) body.memo = params.memo;
      if (params.altName !== undefined) body.x509Parameters.altName = params.altName;
      if (params.ip !== undefined) body.x509Parameters.ip = params.ip;
      if (params.country !== undefined) body.x509Parameters.country = params.country;
      if (params.locality !== undefined) body.x509Parameters.locality = params.locality;
      if (params.stateProvince !== undefined) body.x509Parameters.stateProvince = params.stateProvince;
      if (params.organization !== undefined) body.x509Parameters.organization = params.organization;
      if (params.organizationUnit !== undefined) body.x509Parameters.organizationUnit = params.organizationUnit;

      const queryString = new URLSearchParams(
        Object.fromEntries(Object.entries(queryParams).filter(([, v]) => v !== undefined)) as Record<string, string>
      ).toString();
      const path = `/api/v1/ca${queryString ? `?${queryString}` : ""}`;

      const result = await client.requestRaw("POST", path, undefined, body);
      return result;
    }
  );

  // ncloud_pca_update_ca — Update CA status
  defineTool(
    server,
    "ncloud_pca_update_ca",
    "⚠️ Destructive: Update CA status (ACTIVE, DEACTIVATED, or DESTROYING). Setting to DESTROYING will permanently delete the CA and all sub-CAs after 72 hours. This action is irreversible.",
    {
      caTag: z.string().describe("CA tag value"),
      status: z.enum(["ACTIVE", "DEACTIVATED", "DESTROYING"]).describe("New CA status"),
    },
    async (params) => {
      return client.requestRaw("PUT", `/api/v1/ca/${params.caTag}`, undefined, { status: params.status });
    }
  );

  // ncloud_pca_delete_ca — Delete CA
  defineTool(
    server,
    "ncloud_pca_delete_ca",
    "⚠️ Destructive: Permanently delete a Private CA. Only CAs in DESTROYING status can be deleted. The CA's private key will be permanently destroyed and cannot be recovered. Set confirm=true to execute.",
    {
      caTag: z.string().describe("CA tag value (required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete Private CA [${params.caTag}] and destroy its private key (irreversible). To execute, call this tool again with confirm=true.` }] };
      }
      const result = await client.requestRaw("DELETE", `/api/v1/ca/${params.caTag}`);
      return result;
    }
  );

  // ncloud_pca_get_ca_chain — Get CA Chain
  defineTool(
    server,
    "ncloud_pca_get_ca_chain",
    "Get the certificate chain (PEM) of a Private CA.",
    {
      caTag: z.string().describe("CA tag value"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/ca/${params.caTag}/chain`);
    }
  );

  // ncloud_pca_get_ca_crl — Get CA CRL
  defineTool(
    server,
    "ncloud_pca_get_ca_crl",
    "Get the CRL (Certificate Revocation List) of a Private CA in PEM format.",
    {
      caTag: z.string().describe("CA tag value"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/ca/${params.caTag}/crl`);
    }
  );

  // ─── CRL Configuration ────────────────────────────────────────────────────────

  // ncloud_pca_get_crl_config — Get CRL Config
  defineTool(
    server,
    "ncloud_pca_get_crl_config",
    "Get the CRL update interval configuration for a Private CA.",
    {
      caTag: z.string().describe("CA tag value"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/ca/${params.caTag}/crl/config`);
    }
  );

  // ncloud_pca_update_crl_config — Update CRL Config
  defineTool(
    server,
    "ncloud_pca_update_crl_config",
    "Set the CRL update interval (in days) for a Private CA. Minimum 3 days.",
    {
      caTag: z.string().describe("CA tag value"),
      expiry: z.string().describe("CRL update interval in days (minimum 3, up to CA expiry)"),
    },
    async (params) => {
      return client.requestRaw("PUT", `/api/v1/ca/${params.caTag}/crl/config`, undefined, { expiry: params.expiry });
    }
  );

  // ncloud_pca_rotate_crl — Rotate CRL
  defineTool(
    server,
    "ncloud_pca_rotate_crl",
    "Manually rotate the CRL to refresh it with the latest revocation information.",
    {
      caTag: z.string().describe("CA tag value"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/ca/${params.caTag}/crl/rotate`);
    }
  );

  // ─── OCSP Management ──────────────────────────────────────────────────────────

  // ncloud_pca_create_ocsp — Create OCSP (deploy OCSP URL to certificates)
  defineTool(
    server,
    "ncloud_pca_create_ocsp",
    "Create OCSP and deploy the OCSP URL to certificates issued by this CA.",
    {
      caTag: z.string().describe("CA tag value"),
      ocspServers: z.string().describe("OCSP URL (format: https://pca.apigw.ntruss.com/ext/{caTag}/ocsp)"),
    },
    async (params) => {
      return client.requestRaw("PUT", `/api/v1/ca/${params.caTag}/urls`, undefined, { ocsp_servers: params.ocspServers });
    }
  );

  // ncloud_pca_delete_ocsp — Delete OCSP
  defineTool(
    server,
    "ncloud_pca_delete_ocsp",
    "⚠️ Destructive: Delete OCSP configuration and remove the OCSP URL from all certificates issued by this CA. Set confirm=true to execute.",
    {
      caTag: z.string().describe("CA tag value (required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return { content: [{ type: "text" as const, text: `⚠️ This will delete the OCSP configuration for CA [${params.caTag}] and remove the OCSP URL from all its issued certificates. To execute, call this tool again with confirm=true.` }] };
      }
      const result = await client.requestRaw("DELETE", `/api/v1/ca/${params.caTag}/urls`);
      return result;
    }
  );

  // ─── Sub CA Management ────────────────────────────────────────────────────────

  // ncloud_pca_get_sub_csr — Get Sub CA CSR
  defineTool(
    server,
    "ncloud_pca_get_sub_csr",
    "Get the CSR (Certificate Signing Request) of a Sub CA for external signing. Only available for unsigned Sub CAs.",
    {
      caTag: z.string().describe("CA tag value of the Sub CA"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/ca/${params.caTag}/sub/csr`);
    }
  );

  // ncloud_pca_activate_sub_ca — Activate Sub CA
  defineTool(
    server,
    "ncloud_pca_activate_sub_ca",
    "Activate a Sub CA using a signed certificate and CA chain (direct signing method).",
    {
      caTag: z.string().describe("CA tag value of the Sub CA to activate"),
      certPem: z.string().describe("Signed CA certificate in PEM format"),
      caChainPem: z.string().describe("Signer certificate chain in PEM format"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/ca/${params.caTag}/activate`, undefined, {
          certPem: params.certPem,
          caChainPem: params.caChainPem,
        });
    }
  );

  // ncloud_pca_sign_sub_csr — Sign Sub CA CSR
  defineTool(
    server,
    "ncloud_pca_sign_sub_csr",
    "Sign a Sub CA CSR using this CA to issue an intermediate CA certificate.",
    {
      caTag: z.string().describe("CA tag value of the signing (parent) CA"),
      period: z.string().describe("Validity period in days (1-3650)"),
      csrPem: z.string().describe("CSR in PEM format"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/ca/${params.caTag}/sub/sign`, undefined, {
          period: params.period,
          csrPem: params.csrPem,
        });
    }
  );

  // ─── End Certificate Management ───────────────────────────────────────────────

  // ncloud_pca_list_end_certs — Get End Cert List
  defineTool(
    server,
    "ncloud_pca_list_end_certs",
    "List all end-entity certificates issued by a specific CA. Returns serial numbers.",
    {
      caTag: z.string().describe("CA tag value"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/ca/${params.caTag}/cert`);
    }
  );

  // ncloud_pca_get_end_cert — Get End Cert detail
  defineTool(
    server,
    "ncloud_pca_get_end_cert",
    "Get detailed information of a specific end-entity certificate by serial number.",
    {
      caTag: z.string().describe("CA tag value"),
      serialNo: z.string().describe("Certificate serial number"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/ca/${params.caTag}/cert/${params.serialNo}`);
    }
  );

  // ncloud_pca_issue_end_cert — Issue End Cert
  defineTool(
    server,
    "ncloud_pca_issue_end_cert",
    "Issue a new end-entity certificate from a CA. Returns private key, certificate, and CA chain.",
    {
      caTag: z.string().describe("CA tag value of the issuing CA"),
      keyType: z.enum(["RSA2048", "RSA4096", "EC256", "EC521"]).optional().describe("Key type for the certificate"),
      period: z.string().optional().describe("Validity period in days (1-3650) or 'MAX'"),
      commonName: z.string().describe("Common Name (1-64 chars)"),
      altName: z.string().optional().describe("DNS/Email SANs"),
      organization: z.string().optional().describe("Organization name (0-64 chars)"),
      organizationUnit: z.string().optional().describe("Organization unit (0-128 chars)"),
      locality: z.string().optional().describe("City name (0-128 chars)"),
      stateProvince: z.string().optional().describe("State/Province (0-128 chars)"),
      streetAddress: z.string().optional().describe("Street address (0-128 chars)"),
      country: z.string().optional().describe("Country code (ISO 3166-1 alpha-2)"),
      ip: z.string().optional().describe("IP SANs (IP address format)"),
    },
    async (params) => {
      const body: Record<string, any> = {
        x509Parameters: {
          commonName: params.commonName,
        },
      };
      if (params.keyType !== undefined) body.keyType = params.keyType;
      if (params.period !== undefined) body.period = params.period;
      if (params.altName !== undefined) body.x509Parameters.altName = params.altName;
      if (params.organization !== undefined) body.x509Parameters.organization = params.organization;
      if (params.organizationUnit !== undefined) body.x509Parameters.organizationUnit = params.organizationUnit;
      if (params.locality !== undefined) body.x509Parameters.locality = params.locality;
      if (params.stateProvince !== undefined) body.x509Parameters.stateProvince = params.stateProvince;
      if (params.streetAddress !== undefined) body.x509Parameters.streetAddress = params.streetAddress;
      if (params.country !== undefined) body.x509Parameters.country = params.country;
      if (params.ip !== undefined) body.x509Parameters.ip = params.ip;

      const result = await client.requestRaw("POST", `/api/v1/ca/${params.caTag}/cert`, undefined, body);
      return result;
    }
  );

  // ncloud_pca_sign_end_csr — Sign End CSR
  defineTool(
    server,
    "ncloud_pca_sign_end_csr",
    "Sign a provided CSR to issue a new end-entity certificate. The existing CA certificate is returned.",
    {
      caTag: z.string().describe("CA tag value of the signing CA"),
      csrPem: z.string().describe("CSR in PEM format"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/ca/${params.caTag}/cert/sign`, undefined, {
          csrPem: params.csrPem,
        });
    }
  );

  // ncloud_pca_revoke_end_cert — Revoke End Cert
  defineTool(
    server,
    "ncloud_pca_revoke_end_cert",
    "⚠️ Destructive: Revoke an end-entity certificate by its serial number. This action is irreversible and the certificate will no longer be trusted.",
    {
      caTag: z.string().describe("CA tag value (required)"),
      serialNo: z.string().describe("Certificate serial number to revoke (required)"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/ca/${params.caTag}/cert/${params.serialNo}/revoke`);
    }
  );

  // ─── CA Maintenance ───────────────────────────────────────────────────────────

  // ncloud_pca_trim_ca — Trim CA
  defineTool(
    server,
    "ncloud_pca_trim_ca",
    "Trim expired certificates from the CRL to clean up the revocation list.",
    {
      caTag: z.string().describe("CA tag value"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/ca/${params.caTag}/trim`);
    }
  );
}
