import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

/**
 * Ncloud Key Management Service (KMS) API 2.0
 * Base URL: https://ocapi.ncloud.com
 * Auth: Account Auth (x-ncp-apigw-timestamp, x-ncp-iam-access-key, x-ncp-apigw-signature-v2)
 */
export function registerKmsTools(server: McpServer, client: NcloudClient): void {

  // ─── Key Management ───────────────────────────────────────────────────────────

  // ncloud_kms_create_key — Create a new KMS key
  server.tool(
    "ncloud_kms_create_key",
    "Create a new KMS key. Supports AES256 (symmetric), RSA2048 (asymmetric), and ECDSA key types.",
    {
      keyName: z.string().describe("Key name (3-15 chars, alphanumeric + '-' + '_', must start with letter)"),
      keyType: z.enum(["AES256", "RSA2048", "ECDSA"]).describe("Key type: AES256 (symmetric 256-bit), RSA2048 (asymmetric 2048-bit), ECDSA (asymmetric 256-bit)"),
      protectionType: z.enum(["BASIC", "COMMON_HSM"]).describe("Key storage type: BASIC (encrypted internal storage) or COMMON_HSM (Hardware Security Module)"),
      isAutoRotation: z.boolean().optional().describe("Enable auto rotation (default: false)"),
      rotationPeriod: z.number().optional().describe("Auto rotation period in days (1-730, default: 90). Only when isAutoRotation is true"),
      memo: z.string().optional().describe("Key memo/description (0-100 chars)"),
      isConvergent: z.boolean().optional().describe("Enable convergent encryption (only for AES256, default: false)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          keyName: params.keyName,
          keyType: params.keyType,
          protectionType: params.protectionType,
          isAutoRotation: params.isAutoRotation ?? false,
        };
        if (params.rotationPeriod !== undefined) body.rotationPeriod = params.rotationPeriod;
        if (params.memo !== undefined) body.memo = params.memo;
        if (params.isConvergent !== undefined) body.isConvergent = params.isConvergent;

        const result = await client.requestRaw("POST", "/kms/v1/keys", undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_get_key_info — Get key detail information
  server.tool(
    "ncloud_kms_get_key_info",
    "Get detailed information about a specific KMS key by its keyTag.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/kms/v1/keys/${params.keyTag}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_get_key_list — Get key list
  server.tool(
    "ncloud_kms_get_key_list",
    "Get list of all KMS keys with pagination.",
    {
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size 1-200 (default: 100)"),
    },
    async (params) => {
      try {
        const query: Record<string, string | number> = {};
        if (params.pageNo !== undefined) query.pageNo = params.pageNo;
        if (params.pageSize !== undefined) query.pageSize = params.pageSize;

        const result = await client.requestRaw("GET", "/kms/v1/keys", query);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_get_public_key — Get public key (RSA2048/ECDSA only)
  server.tool(
    "ncloud_kms_get_public_key",
    "Get the public key for an asymmetric key (RSA2048 or ECDSA only).",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/kms/v1/keys/${params.keyTag}/public-key`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_enable_key — Enable a disabled key
  server.tool(
    "ncloud_kms_enable_key",
    "Enable a disabled KMS key to make it usable again.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/enable`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_disable_key — Disable an active key
  server.tool(
    "ncloud_kms_disable_key",
    "Disable an active KMS key. Disabled keys cannot be used for cryptographic operations.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/disable`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ncloud_kms_update_key_name — Update key name
  server.tool(
    "ncloud_kms_update_key_name",
    "Update the name of a KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      keyName: z.string().describe("New key name (3-15 chars, alphanumeric + '-' + '_', must start with letter)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/update-name`, undefined, { keyName: params.keyName });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_rotate_key — Rotate key to create new version
  server.tool(
    "ncloud_kms_rotate_key",
    "Rotate an active key to create a new version. Only enabled keys can be rotated.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/rotate`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_enable_key_version — Enable a specific key version
  server.tool(
    "ncloud_kms_enable_key_version",
    "Enable a specific version of a KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      version: z.number().describe("Key version number to enable"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/versions/${params.version}/enable`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_disable_key_version — Disable a specific key version
  server.tool(
    "ncloud_kms_disable_key_version",
    "Disable a specific version of a KMS key. Disabled versions cannot decrypt data encrypted with that version.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      version: z.number().describe("Key version number to disable"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/versions/${params.version}/disable`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_get_key_version_list — Get key version list
  server.tool(
    "ncloud_kms_get_key_version_list",
    "Get list of all versions for a specific KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/kms/v1/keys/${params.keyTag}/versions`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_request_key_deletion — Request key deletion (⚠️ Destructive)
  server.tool(
    "ncloud_kms_request_key_deletion",
    "⚠️ Destructive: Request deletion of a KMS key. The key enters REVOKE state and will be permanently deleted after the scheduled date. This action can be cancelled before the destroy date.",
    {
      keyTag: z.string().min(1).describe("Key tag - unique identifier derived from key name (required)"),
    },
    async (params) => {
      try {
        if (!params.keyTag || params.keyTag.trim().length === 0) {
          return { content: [{ type: "text" as const, text: "Error: keyTag is required and cannot be empty" }], isError: true };
        }
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/request-deletion`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_cancel_key_deletion — Cancel key deletion request
  server.tool(
    "ncloud_kms_cancel_key_deletion",
    "Cancel a pending key deletion request. Only keys in REVOKE state can be cancelled.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/cancel-deletion`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_delete_key — Permanently delete a key (⚠️ Destructive)
  server.tool(
    "ncloud_kms_delete_key",
    "⚠️ Destructive: Permanently delete a KMS key. This action is irreversible. The key must be in REVOKE state (deletion requested) before it can be permanently deleted.",
    {
      keyTag: z.string().min(1).describe("Key tag - unique identifier derived from key name (required)"),
    },
    async (params) => {
      try {
        if (!params.keyTag || params.keyTag.trim().length === 0) {
          return { content: [{ type: "text" as const, text: "Error: keyTag is required and cannot be empty" }], isError: true };
        }
        const result = await client.requestRaw("DELETE", `/kms/v1/keys/${params.keyTag}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── Auto Rotation ────────────────────────────────────────────────────────────

  // ncloud_kms_update_rotation_period — Update auto rotation period
  server.tool(
    "ncloud_kms_update_rotation_period",
    "Update the auto rotation period for a KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      rotationPeriod: z.number().describe("Rotation period in days (1-730)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/rotation-period`, undefined, { rotationPeriod: params.rotationPeriod });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_enable_auto_rotation — Enable auto rotation
  server.tool(
    "ncloud_kms_enable_auto_rotation",
    "Enable automatic key rotation for a KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/enable-auto-rotation`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_disable_auto_rotation — Disable auto rotation
  server.tool(
    "ncloud_kms_disable_auto_rotation",
    "Disable automatic key rotation for a KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/disable-auto-rotation`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_update_memo — Update key memo
  server.tool(
    "ncloud_kms_update_memo",
    "Update the memo/description of a KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      memo: z.string().describe("New memo content (0-100 chars)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/memo`, undefined, { memo: params.memo });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Cryptographic Operations ─────────────────────────────────────────────────

  // ncloud_kms_encrypt — Encrypt data with a key
  server.tool(
    "ncloud_kms_encrypt",
    "Encrypt data (up to 32KB) using the current version of a KMS key. Only AES256 or RSA2048 key types supported.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      plaintext: z.union([z.string(), z.array(z.string())]).describe("Base64-encoded plaintext data (string or array of strings, max 32KB each)"),
      context: z.string().optional().describe("Base64-encoded context for convergent encryption (required if key has convergent encryption enabled, max 50 bytes)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = { plaintext: params.plaintext };
        if (params.context !== undefined) body.context = params.context;

        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/encrypt`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_decrypt — Decrypt ciphertext with a key
  server.tool(
    "ncloud_kms_decrypt",
    "Decrypt ciphertext using a KMS key. Only AES256 or RSA2048 key types supported. Ciphertext must include KMS prefix (ncpkms:version:ciphertext).",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      ciphertext: z.union([z.string(), z.array(z.string())]).describe("Ciphertext data including KMS prefix (string or array of strings)"),
      context: z.string().optional().describe("Base64-encoded context used during encryption (required if convergent encryption was used)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = { ciphertext: params.ciphertext };
        if (params.context !== undefined) body.context = params.context;

        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/decrypt`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_create_custom_key — Generate a random data encryption key
  server.tool(
    "ncloud_kms_create_custom_key",
    "Generate a random raw key (data encryption key) wrapped by the specified master key. Used for envelope encryption. Only AES256 or RSA2048 key types supported.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      requestPlainKey: z.boolean().optional().describe("Whether to return the plaintext key (default: false)"),
      bits: z.number().optional().describe("Key size in bits: 128, 256 (default), or 512"),
      context: z.string().optional().describe("Base64-encoded context for convergent encryption (max 50 bytes)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.requestPlainKey !== undefined) body.requestPlainKey = params.requestPlainKey;
        if (params.bits !== undefined) body.bits = params.bits;
        if (params.context !== undefined) body.context = params.context;

        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/create-custom-key`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_reencrypt — Re-encrypt ciphertext with latest key version
  server.tool(
    "ncloud_kms_reencrypt",
    "Re-encrypt ciphertext with the latest version of the specified master key. Used after key rotation to update encrypted data. Only AES256 or RSA2048 key types supported.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      ciphertext: z.union([z.string(), z.array(z.string())]).describe("Ciphertext to re-encrypt (string or array of strings)"),
      context: z.string().optional().describe("Base64-encoded context for convergent encryption"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = { ciphertext: params.ciphertext };
        if (params.context !== undefined) body.context = params.context;

        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/reencrypt`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_sign — Sign data with a key
  server.tool(
    "ncloud_kms_sign",
    "Generate a digital signature for data (up to 8KB). Only RSA2048 or ECDSA key types supported.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      data: z.string().describe("Base64-encoded data to sign (max 8KB)"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/sign`, undefined, { data: params.data });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_verify — Verify signature
  server.tool(
    "ncloud_kms_verify",
    "Verify a digital signature against data. Only RSA2048 or ECDSA key types supported.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      data: z.string().describe("Base64-encoded original data that was signed"),
      signature: z.string().describe("Signature value to verify"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/verify`, undefined, { data: params.data, signature: params.signature });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ─── IP ACL ───────────────────────────────────────────────────────────────────

  // ncloud_kms_enable_ip_acl — Enable IP ACL for token requests
  server.tool(
    "ncloud_kms_enable_ip_acl",
    "Enable IP ACL to control which IP addresses can request tokens for a KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/ip-acl/enable`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_disable_ip_acl — Disable IP ACL
  server.tool(
    "ncloud_kms_disable_ip_acl",
    "Disable IP ACL for a KMS key, allowing token requests from any IP.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/ip-acl/disable`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_get_acl_rule_list — Get IP ACL rules
  server.tool(
    "ncloud_kms_get_acl_rule_list",
    "Get the list of IP ACL rules configured for a KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/kms/v1/keys/${params.keyTag}/ip-acl/rules`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_add_acl_rule — Add IP ACL rule
  server.tool(
    "ncloud_kms_add_acl_rule",
    "Add an IP address to the ACL rules for a KMS key to allow token requests from that IP.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      ip: z.string().describe("IP address to allow (e.g., '192.168.1.1' or CIDR '192.168.1.0/24')"),
      memo: z.string().optional().describe("Description for this ACL rule"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = { ip: params.ip };
        if (params.memo !== undefined) body.memo = params.memo;

        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/ip-acl/rules`, undefined, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_delete_acl_rule — Delete IP ACL rule (⚠️ Destructive)
  server.tool(
    "ncloud_kms_delete_acl_rule",
    "⚠️ Destructive: Remove an IP address from the ACL rules for a KMS key.",
    {
      keyTag: z.string().min(1).describe("Key tag - unique identifier derived from key name (required)"),
      ruleId: z.string().min(1).describe("ACL rule ID to delete (required)"),
    },
    async (params) => {
      try {
        if (!params.keyTag || !params.ruleId) {
          return { content: [{ type: "text" as const, text: "Error: keyTag and ruleId are required" }], isError: true };
        }
        const result = await client.requestRaw("DELETE", `/kms/v1/keys/${params.keyTag}/ip-acl/rules/${params.ruleId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Token Generator ──────────────────────────────────────────────────────────

  // ncloud_kms_create_token_generator — Create token generator
  server.tool(
    "ncloud_kms_create_token_generator",
    "Create (activate) a token generator for a KMS key. Enables token-based authentication for cryptographic operations.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/token-generator`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_get_token_generator — Get token generator info
  server.tool(
    "ncloud_kms_get_token_generator",
    "Get token generator information for a KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/kms/v1/keys/${params.keyTag}/token-generator`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_update_token_generator — Update (rotate) token generator
  server.tool(
    "ncloud_kms_update_token_generator",
    "Update (rotate) the token generator for a KMS key. Generates a new secret for token creation.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/token-generator/update`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_delete_token_generator — Delete token generator (⚠️ Destructive)
  server.tool(
    "ncloud_kms_delete_token_generator",
    "⚠️ Destructive: Delete (deactivate) the token generator for a KMS key. All existing tokens will be invalidated.",
    {
      keyTag: z.string().min(1).describe("Key tag - unique identifier derived from key name (required)"),
    },
    async (params) => {
      try {
        if (!params.keyTag || params.keyTag.trim().length === 0) {
          return { content: [{ type: "text" as const, text: "Error: keyTag is required and cannot be empty" }], isError: true };
        }
        const result = await client.requestRaw("DELETE", `/kms/v1/keys/${params.keyTag}/token-generator`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_create_token_set — Create token set (access + refresh tokens)
  server.tool(
    "ncloud_kms_create_token_set",
    "Create a token set (access token + refresh token) for token-based authentication. Requires an active token generator.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("POST", `/kms/v1/keys/${params.keyTag}/tokens`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Activity Logs ────────────────────────────────────────────────────────────

  // ncloud_kms_get_key_activity_logs — Get key usage activity logs
  server.tool(
    "ncloud_kms_get_key_activity_logs",
    "Get activity logs (usage history) for a specific KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size (default: 100)"),
    },
    async (params) => {
      try {
        const query: Record<string, string | number> = {};
        if (params.pageNo !== undefined) query.pageNo = params.pageNo;
        if (params.pageSize !== undefined) query.pageSize = params.pageSize;

        const result = await client.requestRaw("GET", `/kms/v1/keys/${params.keyTag}/activity-logs`, query);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_kms_get_latest_use_info — Get latest key usage info
  server.tool(
    "ncloud_kms_get_latest_use_info",
    "Get the most recent usage information for a specific KMS key.",
    {
      keyTag: z.string().describe("Key tag - unique identifier derived from key name"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/kms/v1/keys/${params.keyTag}/latest-use`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
