# Changelog

All notable changes to this project will be documented in this file.

## [1.8.0] - 2026-06-26

> Ncloud API-change tracking release. Reflects two upstream API changes — **Container Registry `storageType`** and the **billing product-classification code revision (effective 2026-06-25)**. Unlike recent releases, this one **does change public tool schemas** (new optional parameters + a new `storageType` enum on registry create), but all changes are **additive and backward-compatible** — existing calls keep working. Verified against the live KR API — all five verification scenarios passed.

### Added
- **Container Registry `storageType`** — `ncloud_ncr_create_registry` now accepts `storageType` (`objectStorage` default | `ncloudStorage`) and `bucket`. `objectStorage` reuses an existing Object Storage bucket (`bucket` required — guarded before the call so a missing bucket fails fast with a localized message instead of a raw 400); `ncloudStorage` auto-provisions dedicated NCR storage (`bucket` omitted from the request body). `dryRun` previews reflect the resolved `storageType`/`bucket`. The added `storage_type` response field on list/detail passes through unchanged.
- **Billing `productItemKindDetailCode` request parameter** (2026-06-25 classification revision) — added as an optional enum (`VM`/`BM`/`BSTAD`/`BSTBS`/`BSTBS_BSTAD`/`CB1`/`CB2`/`FB1`/`FB2`) to all five affected tools: `ncloud_get_product_list`, `ncloud_get_product_price_list`, `ncloud_get_cost_relation_code_list`, `ncloud_get_contract_usage_list`, `ncloud_get_contract_usage_list_by_daily`. Use `VM` to query VM servers only (otherwise Bare Metal may be mixed in) or `BM` for Bare Metal only.
- **New classification fields in the slim price projection** — `slimProductPrice()` (`ncloud_get_product_price_list` default `detailLevel="price"`) now surfaces `productItemKindDetail` and `productTypeDetail`, and keyword search (`productName`) matches across them, so VM/BM and Block-Storage sub-types (e.g. `BM`, `GPU`) are searchable/visible. A `codeName()` helper reads each classification field from the code object (`{code, codeName}`) with a fallback to the flat `*Code` form — robust to either response shape.
- **Tests** — new `src/tools/containers-registry.test.ts` (6: storageType branches, bucket guard, dryRun preview, `/info` detail path) and billing classification cases in `billing.test.ts` (object/flat projection, keyword match on detail fields, request-param pass-through for both List-Price and Cost tools). Full suite: 172 passing.

### Fixed
- **`ncloud_ncr_create_registry` was calling the wrong HTTP method/path** — it issued a `GET` to `/ncr/api/v2/repositories` with no body and no `{registry}` segment, so the registry name was not in the path and no creation body was sent. Now correctly `POST`s to `/ncr/api/v2/repositories/{registry}` with a JSON body, per the official spec.
- **`ncloud_ncr_get_registry` was returning an image-list wrapper, not registry detail** — the plain `/ncr/api/v2/repositories/{registry}` path returns `{count,next,previous,results}` (image list) with no `storage_type`; only `/ncr/api/v2/repositories/{registry}/info` returns the registry detail body. The tool now queries `/info`, fixing a latent defect that predates the `storage_type` addition (confirmed live in verification scenario D).

## [1.7.0] - 2026-06-21

> Reliability release. **No public tool name/schema/group-key changes** — verified by a full tool-snapshot diff (1,035 tools, name/description/schemaKeys identical to 1.5.0/1.6.0/1.6.1). The new behavior is **opt-in via env and default OFF**, so with default settings every tool response is byte-for-byte unchanged.

### Added
- **Opt-in response-size guard (`NCLOUD_RESPONSE_MAXBYTES`).** When set to a positive byte threshold, read-only tool responses whose serialized size exceeds it are truncated **item-by-item** (largest top-level array, from the end, keeping ≥1) to stay under the limit, with `truncated: true` + `suggestedPageSize` recovery hints appended. Measured on the **post-prune** payload so pruning doesn't over-truncate. Unset/0/non-positive → guard off and the response shape is 100% unchanged. Generalizes the billing-only `paginateWithGuard` to all read-only tools without touching schemas (`src/tools/_response.ts` `guardLargeResponse`/`responseMaxBytes`, applied in the `defineTool` read-only path).
- **Validation-helper consolidation (`src/tools/_validation.ts`).** The region whitelist (code/Korean-name resolution) and the operation-status resource-type → detail-API map were extracted out of `common.ts` into a single module, with their i18n messages routed through `_messages.ts` (`L`). Sets up a single growth point for handler validation logic. The `ncloud_get_operation_status` completion/in-progress status message is now also localized (`NCLOUD_LANG=en`), closing a remaining hardcoded-Korean gap.

### Notes
- Public behavior with default settings is unchanged: no guard, Korean messages by default. The new env var is documented in `server.json`.
- A read-only TTL cache (`NCLOUD_CACHE_TTL`) was prototyped during this round but **dropped before release**: caching all read-only tools risks stale reads for an infra-management tool (create→verify loops), and the value was marginal. If revisited, it should be scoped to an explicit static-metadata allowlist rather than all read-only tools.
- **Helper unit tests** (`_response.test.ts`, `_validation.test.ts`, plus guard integration cases in `_tool.test.ts`): opt-in gate defaults OFF, item-level truncation under threshold, single-oversized-item floor, no-array no-op, input immutability, post-prune measurement, and write-tool guard bypass.

## [1.6.1] - 2026-06-18

> Handler-level i18n follow-up. **No public tool name/schema/group-key changes** — verified by a full tool-snapshot diff (1,035 tools, name/description/schemaKeys identical to 1.5.0/1.6.0). Default behavior (Korean) is unchanged; only `NCLOUD_LANG=en` output differs.

### Fixed
- **Handler/schema-level messages now honor `NCLOUD_LANG`.** v1.6.0 localized only the `NcloudClient` error layer; messages returned **directly by tool handlers** (validation errors, dryRun previews, deletion/success notices) and zod `required_error` strings were still hardcoded Korean, so `NCLOUD_LANG=en` users still saw Korean for those. All such strings are now routed through a new `src/tools/_messages.ts` module with parallel `ko`/`en` text: `L({ ko, en })` for one-offs plus template helpers `dryRunMessage`/`requiredError`/`maxLenMessage`/`cidrMessage`/`deletedMessage`. ~90 handler strings converted across ~37 modules, plus **520 zod `required_error` strings** across 29 modules migrated via a Node utf8 codemod. Default language stays Korean.
- **`activity-tracer.ts`** "activity not found" fallback no longer uses indented `JSON.stringify(result, null, 2)` (now `JSON.stringify(result)`), aligning with the `toolText()` no-indent convention.

### Added
- **Helper unit tests** (`_messages.test.ts`, 10 tests): `ko` default preserved when `NCLOUD_LANG` is unset/unknown, English switch on `NCLOUD_LANG=en` (case-insensitive), and per-verb dryRun templates (create/upload/apply).

## [1.6.0] - 2026-06-16

> Reliability & UX release. **No public tool name/schema/group-key changes** — verified by a full tool-snapshot diff (1,035 tools, name/description/schemaKeys identical to 1.5.0). New behavior is either scoped to read-only tools or opt-in via env.

### Added
- **Read-only retry expansion** — query tools now also retry on **HTTP 503/504 and network/timeout errors** (same exponential backoff + jitter as the existing 429 path, max 2 attempts). Writes (create/delete/modify) are unchanged — still 429-only — to preserve non-idempotent safety. The read/write distinction reuses the `readOnlyHint` annotation already derived by `defineTool`: a read-only handler runs inside an `AsyncLocalStorage` retry context (`src/client/_retry-context.ts`) that `NcloudClient.fetchWithRetry` reads, so no handler or call-site code changed.
- **Error message i18n** (`NCLOUD_LANG`) — client error messages (HTTP 401/403/413/429/503/504, JSON parse failure, empty body, gateway/service errors, timeout) are now available in English. `NCLOUD_LANG=en` selects English; unset/other keeps Korean (default, unchanged). Messages were extracted into a single `src/client/messages.ts` module with parallel `ko`/`en` bundles.

### Notes
- Public behavior with default settings is unchanged: Korean error messages by default, and writes still retry only on 429. `NCLOUD_LANG` defaulting to `en` is under consideration for v2.0.0.

## [1.5.0] - 2026-06-15

> Internal-architecture release (same spirit as 1.3.0). **No public tool name/schema/group-key changes** — verified by a full tool-snapshot diff (1,035 tools, name/description/schemaKeys identical to 1.4.0). The confirm-gate boilerplate extraction is the natural follow-up to the 1.3.0 `defineTool` try/catch consolidation.

### Changed
- **Internal**: the destructive-tool `confirm` gate — the `if (!params.confirm) { …return prompt… }` block duplicated across **148 sites / 54 modules** — is now handled by a `destructive` option on the `defineTool` wrapper (`src/tools/_tool.ts`). The wrapper injects the `confirm` parameter (when not already declared), returns the warning prompt when `confirm` is falsy, strips `confirm` from the params passed to the handler, and forces `destructiveHint: true`. Migrated via a TypeScript-AST codemod; the warning text is built from a unified template for the canonical single-identifier case (`{ noun, describe, action? }`) and preserved verbatim via a `message` builder for tools with multiple identifiers, non-delete verbs, or extra safety warnings. Public behavior is unchanged.

### Added
- **Registry invariant tests** (`registry.test.ts`): a tool with a `confirm` parameter must carry `destructiveHint: true`; a tool with `destructiveHint: true` must have a `confirm` gate unless explicitly allowlisted (catches a new destructive tool added without a gate); plus an allowlist-staleness guard. The intentional non-gated set is 4 tools (`*_kill_container`, `*_kill_master`, `edge_purge`, `pca_revoke_end_cert` — lifecycle/cache/cert ops, not data deletion).
- **Wrapper behavior tests** (`_tool.test.ts`): confirm injection, gate prompt, confirm stripping, `message` precedence over the structured template, and a verb-heuristic regression guard.

### Fixed
- Removed a stray untracked `src/tools/certificate-manager.ts.bak` from the source tree.

## [1.4.0] - 2026-06-14

> Dynamic tool-group loading. **Default behavior is unchanged** — leaving `NCLOUD_TOOL_GROUPS` unset still loads all 1,035 tools, exactly as before. The new behavior is opt-in via `NCLOUD_TOOL_GROUPS=dynamic`.

### Added
- **Dynamic tool groups** — the server can now enable tool groups at runtime, in-session, without a restart. Two always-on meta tools drive it: `ncloud_list_tool_groups` (catalog: 14 groups with services, tool counts, and current enabled/available/blocked status) and `ncloud_enable_tool_group` (activate a group; idempotent; the group catalog is embedded in the tool description so the model can pick the right group without a prior list call). On enable, the group's tools register and the SDK emits `tools/list_changed`.
- **`NCLOUD_TOOL_GROUPS=dynamic`** opt-in keyword — starts with core IaaS groups only (`common` + `compute` + `network` + `database`, ~367 tools / ~65k tokens) instead of all 1,035 (~177k tokens), a 63% context reduction, with every other group one `ncloud_enable_tool_group` call away. Combine with extra groups (e.g. `dynamic,analytics`) to also start them on.
- **Expansion is gated by the `dynamic` keyword.** Listing groups without it (e.g. `compute,network`), or using `all`/unset, is a **locked** state — the model cannot enable more groups at runtime (for strict / least-privilege environments). This replaces the need for a separate disable switch; there is no `NCLOUD_DYNAMIC_GROUPS` env.
- **Security boundary**: a group excluded via `-key` (e.g. `all,-billing`) is also refused for dynamic enable — an operator's intent to withhold a group cannot be reversed by the model at runtime.
- **Notification debounce**: the server is constructed with `debouncedNotificationMethods: ["notifications/tools/list_changed"]`, collapsing the burst of per-tool notifications during a group enable into a single `list_changed` (measured: enabling a 205-tool group emits exactly 1 notification).
- **Tests**: enable flow / idempotency / `-key` block / unknown-vs-moved key / locked-list (no `dynamic`) / full structural invariants re-checked through the dynamic-enable path. README KR/EN gain a "Dynamic groups" section with a client-compatibility table.

### Notes
- list_changed support is client-dependent. Claude Code/Desktop support it; Kiro/Cursor are under real-world validation. If unsupported, the enable response returns a fallback hint (restart with `NCLOUD_TOOL_GROUPS=all`) — i.e. no regression vs. today.
- v2.0.0 (planned) will flip the unset default to the core set and remove the `MOVED_GROUP_KEYS` deprecation shim.

## [1.3.0] - 2026-06-12

> Internal-architecture release. No public tool name/schema/group-key changes — verified by a full tool-snapshot diff (1,035 tools, name/description/schemaKeys identical to 1.2.1).

### Added
- **MCP tool annotations** on all 1,035 tools (`readOnlyHint` / `destructiveHint` / `idempotentHint`), derived from a verb-token heuristic with per-tool overrides (e.g. `ncloud_set_region` is marked local-only via `openWorldHint: false`). MCP clients can now apply auto-approval/confirmation UX based on standard metadata instead of parsing description text. Annotations are hints per the MCP spec — the existing `confirm` parameter gate and `⚠️ Destructive` description warnings on destructive tools are kept as a second line of defense.
- **CI**: GitHub Actions workflow (build + test on Node 20.x/22.x) with README badges.
- **Release automation**: tag-triggered workflow (`v*`) that verifies tag == `package.json` == `server.json` versions, then publishes to npm (Trusted Publishing/OIDC, provenance) and the MCP registry (`mcp-publisher` GitHub OIDC login). Requires a one-time Trusted Publisher registration on npmjs.com.
- **Registry invariant tests**: 4 new checks — every tool carries annotations; destructive-named tools have `destructiveHint: true`; `readOnlyHint` and `destructiveHint` never co-exist; destructive tools keep the `⚠️ Destructive` description warning (promoted from a local hook to a test).

### Changed
- **Internal**: all ~1,035 tool registrations migrated from `server.tool()` to a common `defineTool()` wrapper (`src/tools/_tool.ts`) via a TypeScript-AST codemod (999 auto-converted, 1 manual). The wrapper centralizes the try/catch error envelope, `toolText()` serialization, and annotation derivation; handlers now return raw data (completed `{ content }` responses such as dry-run previews and confirm prompts pass through untouched). Public behavior is unchanged; net −3,473 lines.

## [1.2.1] - 2026-06-12

> Reliability & internal-consistency patch. No public tool name/schema/group-key changes.

### Fixed
- **MCP server version drift**: the server version is now read from `package.json` as the single source of truth (was hardcoded `1.1.1` in `src/index.ts` while `package.json` was already `1.2.0`).
- **Empty response body on POST/PUT**: `postRequest`/`putRequest` called `response.json()` directly, so a `200`/`201` with an empty body threw `Unexpected end of JSON input` and failed the tool call. All three (`post`/`put`/`delete`) now reuse the hardened `requestRaw` path and return `{ success: true }` for empty bodies. The Cloud-Insight-required `x-ncp-region_code` header is preserved.
- **`ncloud_set_region` only applied to the default client**: region changes are now propagated to every memoized client across all base URLs (Cloud Insight, NKS, Billing, etc.), and newly created clients inherit the current region. The response now documents the scope (not applied: Object/Archive Storage and Cloud Functions — these require a server restart).

### Added
- **Request timeout** (default 30s, override via `NCLOUD_TIMEOUT_MS`): requests no longer hang indefinitely when the gateway is unresponsive; on timeout a friendly message is returned.
- **Automatic retry on HTTP 429** (max 2 attempts, exponential backoff + jitter, honors `Retry-After`). Conservative by design: only 429 is retried (other status codes and network errors are not), and auth headers are regenerated on each attempt.

## [1.2.0] - 2026-06-10

### ⚠️ BREAKING — `NCLOUD_TOOL_GROUPS` group keys

The tool-group taxonomy was realigned so each `NCLOUD_TOOL_GROUPS` group key maps 1:1 to a service category. This changes some public group keys. The default behavior is **unaffected** — leaving `NCLOUD_TOOL_GROUPS` unset still loads everything (`all` ON), exactly as before. Only setups that explicitly listed the changed keys are affected.

- `integration` removed → renamed to **`application`** (API Gateway, SENS).
- `global` removed → split into **`cdn`** (Global Edge) and **`network`** (Global DNS / Global Traffic Manager).
- **Cloud Functions**: moved from `integration` → **`compute`** (region-specific base URL handling moved with it).
- **Security Monitoring**: moved from `monitoring` → **`security`**.
- **Activity Tracer · Cloud Advisor · Resource Manager · Sub Account**: moved into a new **`governance`** group (Activity Tracer/Cloud Advisor were in `monitoring`, Resource Manager and Sub Account were in `integration`/`security`). Sub Account (IAM: accounts/groups/policies/roles) is classified as account & access governance.
- Old keys are **not auto-aliased**: specifying `integration` or `global` prints a guidance message naming the new key(s) and is then ignored for that request.

> Note: group keys are still stabilizing since the feature was introduced in 1.1.0 and may change again. Strict semver would make this a major bump, but the affected surface is a days-old, opt-in knob with no impact on default behavior, so it ships as a minor release.

### Changed
- Group count 13 → 14 (`governance` added; `integration`→`application` and `global`→`cdn` are renames). Total tool count is unchanged — registrations were moved between groups, not added or removed.

### Docs
- Reworked the **Features** category table in both READMEs to classify services by purpose, so the 14 categories now map 1:1 to the `NCLOUD_TOOL_GROUPS` group keys (added a note pointing to the group-selection table). Updated the **Tool Group Selection** table with the new keys and a rename-guidance note.

## [1.1.2] - 2026-06-09

### Changed
- **VPC Peering** (`ncloud_create_vpc_peering`): `vpcPeeringName` is now validated against the official NCP naming rule — 3–30 characters, lowercase letters/numbers/hyphens only, must start and end with an alphanumeric character (was only a `max(30)` length check).
- **VPC Peering** (`ncloud_create_vpc_peering`): the create response now returns a normalized summary (resource ID, name, status, create time, source/target VPC), consistent with `ncloud_create_vpc`, instead of the raw API payload.

### Docs
- Reworked the **Tool Group Selection** (`NCLOUD_TOOL_GROUPS`) section in both READMEs to be beginner-friendly (what it is / how to use, value→result and group-key→services tables, "leave unset for everything" note) and moved it below **MCP Client Configuration** as an optional step, so first-time readers see the basic setup first. The env-var table now links down to it.
- Renamed "Cloud DB for Redis" → "Cloud DB for Cache (Redis/Valkey)" in both READMEs (service and `database` group tables) to match the rebranded NCP product; the implementation already used the Cache naming (`/vcache/v2/`, `ncloud_*_cache_*`).

## [1.1.1] - 2026-06-07

### Fixed
- Corrected wrong API endpoints (returned `code 300 Not Found`) across four monitoring/security modules, verified against official NCP docs:
  - **Cloud Log Analytics**: now uses the dedicated host `cloudloganalytics.apigw.ntruss.com` and the real `/api/{regionCode}-v1/...` path scheme (was the generic gateway + nonexistent `/cloudloganalytics/v2/...`). Replaced the nonexistent `getLogSourceList` with the real server-list endpoint, and removed the nonexistent `getLogConfig` getter; added export-bucket listing.
  - **Security Monitoring**: now uses the dedicated host `securitymonitoring.apigw.ntruss.com` with `POST` (was `GET` on the generic gateway). Replaced 2 nonexistent endpoints (`getSecurityEventList`/`getSecurityEventDetail`) with the real per-type endpoints (`getAVList`/`getIDSList`/`getIPSList`/`getWAFList`/`getDDoSList` + `getDDoSEventDetail`/`getIDSEventDetail`). Corrected params (`page`/`countPerPage`, `startDateTime`/`endDateTime`, `ticketId`).
  - **Cloud Insight – Integration**: list endpoint `/integration/list` → `/integration/page` with required `{query,pageNum,pageSize}`; detail is `GET .../{id}/detail`; create/update use `name`/`type`/`url`/`payload`; delete body is a JSON array of ids.
  - **Cloud Insight – Plugin/Schema/Maintenance**: process/port/file plugins moved to the `/cw_server/real/api/plugin/...` prefix (list/get are `GET`); schema uses method-multiplexed `/schema` (GET/POST/PUT/DELETE) with `prodName`/`cw_key`; planned maintenance uses the REST `/planned-maintenances` resource. Removed fictional params (`newProcessName`, etc.).

## [1.1.0] - 2026-06-06

### Added
- `NCLOUD_TOOL_GROUPS` env var — selectively load tool groups (e.g. `compute,network,billing` or `all,-billing`). Unset = all groups ON (same as before). Reduces context tokens and improves tool-selection accuracy. The `common` group is always registered.
- `NCLOUD_RESPONSE_PRUNE` env var — when `1`, globally strips empty values (`null`/`""`/`[]`/`{}`) from responses.
- Common response helper `src/tools/_response.ts` (`toolText()` + `prune()`).
- Group registry `src/tools/registry.ts` with a memoized per-base-URL client factory.
- Keyword search fallback for billing pricing tools (`ncloud_get_product_list`, `ncloud_get_product_price_list`): `productName` is now matched client-side (case-insensitive substring) across `productName`, `productDescription`, `productCode`, `productType.codeName`, `productItemKind.codeName` — finds products (e.g. Load Balancer) whose NCP `productName` field is empty or Korean.
- `detailLevel` parameter on `ncloud_get_product_price_list` (`price` default | `full`): `price` returns a slim projection (identity + price fields only, dropping per-item hardware/OS metadata and large `promiseList`/`periodUnitList`/`countryUnitList`/`packageUnitList` arrays), drastically shrinking large category responses. `full` returns the raw payload.
- Response size guard for billing List Price tools (`ncloud_get_product_list`, `ncloud_get_product_price_list`): results are server-sorted by `productCode` and paginated (default 50/page, max 1000) with `totalRows`/`returnedRows`/`hasMore`/`nextPageNo` metadata, so high-match queries (e.g. `productName="MySQL"`, 94 matches) stay within the client token limit. A hard size backstop drops whole items (never mid-JSON) when a single page still exceeds the byte threshold, setting `truncated: true` (with `hasMore: true` kept honest) plus a `suggestedPageSize` recovery hint so the full set can still be paged through losslessly with a smaller `pageSize`.

### Changed
- All tool responses now serialize via `toolText()` (no indentation), reducing response size ~30–40%.
- Billing pricing tools prune empty fields per item, shrinking large category dumps.
- `src/index.ts` slimmed from ~400 to ~56 lines (group-based registration).

### Fixed
- Added the missing `confirm` safety gate to 5 destructive tools that lacked it (`ncloud_pca_delete_ca`, `ncloud_pca_delete_ocsp`, `ncloud_kms_delete_key`, `ncloud_kms_delete_acl_rule`, `ncloud_kms_delete_token_generator`). All 136 destructive tools now require `confirm=true`, enforced by an automated structural test over all registered tools.

## [1.0.4] - 2026-05-29

### Fixed
- NKS cluster creation (`ncloud_nks_create_cluster`) pre-validation for G3/KVM clusters
  - `lbPrivateSubnetNo` required check (API returns 400 without details if missing)
  - `hypervisorCode` must be 'KVM' when clusterType contains G003
  - `k8sVersion` must use nks.2 suffix for G3/KVM
  - `zoneCode` required at cluster level when isRegional=false (default)
  - `softwareCode` format validation (must include pipe and image number, e.g., `CODE|12345`)

### Changed
- Improved tool description and parameter descriptions for `ncloud_nks_create_cluster`
  - Documented G3/KVM vs G2/XEN differences clearly
  - Added format guidance for softwareCode parameter
  - Clarified zoneCode requirement for single-zone clusters

## [1.0.3] - 2026-05-21

### Added
- `mcpName` field in package.json for MCP Registry integration
- `server.json` for official MCP Registry publishing
- `CHANGELOG.md` for version tracking
- Keywords update in package.json (`ncp`, `devops`)

### Changed
- Registered to official MCP Registry (`io.github.sjk4425/ncloud`)

## [1.0.2] - 2026-05-19

### Changed
- README.md formatting improvements (Korean/English)
- Added detailed service descriptions and usage examples

## [1.0.1] - 2026-05-17

### Added
- npm package publishing support (`npx ncloud-mcp-server`)
- npm version badge in README
- `.npmignore` to exclude test files from npm package
- npx installation guide in README

### Changed
- Build script updated (`tsc` → `npx tsc`)

## [1.0.0] - 2026-05-17

### Added
- Initial release
- 60+ Ncloud services, 1,000+ MCP tools
- Compute (Server, Block Storage, Snapshot, Public IP, Init Script, Login Key, Placement Group, Fabric Cluster)
- Networking (VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager)
- Database (MySQL, PostgreSQL, MSSQL, MongoDB, Redis)
- Storage (Object Storage S3-compatible, NAS, Archive Storage Swift-compatible)
- Containers (NKS, Container Registry)
- Monitoring (Cloud Insight - Dashboard, Event, Rule, Plugin, Schema, Data, Integration)
- DevTools (SourceCommit, SourceBuild, SourceDeploy, SourcePipeline)
- Media (VOD Station, Live Station, Image Optimizer)
- Security (Certificate Manager, Private CA, KMS, Security Monitoring)
- Application (Cloud Functions, API Gateway, SENS)
- Analytics (Search Engine Service, Cloud Hadoop, CDSS, Data Catalog, Data Forest, Data Flow, Data Query)
- Management (Sub Account, Activity Tracer, Resource Manager, Log Analytics, Cloud Advisor, Billing)
- Content Delivery (Global Edge)
- Auto Scaling (Launch Configuration, ASG, Scaling Policy)
- HMAC-SHA256 signature authentication
- Destructive operation confirm gate
- Dry-run support for create operations
- S3-compatible client for Object Storage
- Swift-compatible client for Archive Storage
