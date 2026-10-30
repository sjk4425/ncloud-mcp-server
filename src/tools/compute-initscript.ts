import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { redactShellSecrets } from "./_secrets.js";

const INCLUDE_SECRETS_SCHEMA = z
  .boolean()
  .optional()
  .default(false)
  .describe("Return initScriptContent unredacted (default false). Even when true, the response still reports how many secret-like values were detected.");

/**
 * `initScriptList[*].initScriptContent` 의 시크릿을 가린다(금융존 테스트 S-01).
 * Init Script 본문에 Access/Secret Key 를 넣는 패턴이 흔해, 조회 한 번으로 자격증명이 LLM 컨텍스트에 남았다.
 * 동작은 ncloud_functions_get_action 과 같다 — 기본은 가리고, includeSecrets=true 면 원문 + 경고.
 */
export function annotateInitScriptSecrets(result: any, includeSecrets: boolean): any {
  const list = result?.initScriptList;
  if (!Array.isArray(list)) return result;
  let count = 0;
  const redacted = list.map((s: any) => {
    if (typeof s?.initScriptContent !== "string") return s;
    const r = redactShellSecrets(s.initScriptContent);
    count += r.count;
    return r.count > 0 ? { ...s, initScriptContent: r.text } : s;
  });
  if (count === 0) return result;
  if (includeSecrets) {
    return {
      ...result,
      secretsDetected: count,
      warning: `initScriptContent contains ${count} secret-like value(s) (hard-coded credentials). They are returned UNREDACTED because includeSecrets=true — do not paste this output into shared logs; rotate the keys.`,
    };
  }
  return {
    ...result,
    initScriptList: redacted,
    secretsRedacted: true,
    redactedCount: count,
    note: `${count} secret-like value(s) in initScriptContent were replaced with <REDACTED:n chars> (the script is otherwise complete). Pass includeSecrets=true to retrieve them; consider rotating these keys.`,
  };
}

export function registerComputeInitScriptTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_init_scripts",
    "List all init scripts in the current region. Secrets in script content are REDACTED by default (includeSecrets=true to opt out).",
    {
      initScriptNoList: z.array(z.string()).optional().describe("Filter by init script numbers"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
      includeSecrets: INCLUDE_SECRETS_SCHEMA,
    },
    async (params) => {
      const { includeSecrets, ...apiParams } = params;
      const result = await client.request("/vserver/v2/getInitScriptList", apiParams);
      return annotateInitScriptSecrets(result, includeSecrets);
    }
  );

  defineTool(
    server,
    "ncloud_get_init_script_detail",
    "Get detailed information about a specific init script. Secrets in the script content (access/secret keys, passwords, tokens) are REDACTED by default and the response carries secretsRedacted=true; pass includeSecrets=true only if you genuinely need the raw values.",
    {
      initScriptNo: z.string().describe("Init script number to query"),
      includeSecrets: INCLUDE_SECRETS_SCHEMA,
    },
    async (params) => {
      const { includeSecrets, ...apiParams } = params;
      const result = await client.request("/vserver/v2/getInitScriptDetail", apiParams);
      return annotateInitScriptSecrets(result, includeSecrets);
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_init_script",
    "Create a new init script. The response echoes the script content with secrets REDACTED.",
    {
      initScriptContent: z.string().describe("Init script content (shell script)"),
      initScriptName: z.string().optional().describe("Init script name"),
      initScriptDescription: z.string().optional().describe("Init script description"),
      osTypeCode: z.string().optional().describe("OS type code (LNX or WND)"),
    },
    async (params) => {
      const result = await client.request("/vserver/v2/createInitScript", params);
      // 생성 응답도 본문을 그대로 되돌려준다 — 호출자는 이미 원문을 알고 있으므로 항상 가린다.
      return annotateInitScriptSecrets(result, false);
    }
  );

  // ─── Destructive Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_init_scripts",
    "⚠️ Destructive: Permanently delete one or more init scripts. Set confirm=true to execute.",
    {
      initScriptNoList: z.array(z.string()).min(1).describe("List of init script numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vserver/v2/deleteInitScripts", apiParams);
      return result;
    },
    { destructive: { noun: "InitScript", describe: (params) => params.initScriptNoList.join(", ") } }
  );
}
