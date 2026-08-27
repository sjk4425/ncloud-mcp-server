# Changelog

All notable changes to this project will be documented in this file.

## [1.12.0] - 2026-08-28

> **Live-verified against a real KR account, 2026-08-27~28 KST** (33 checks, every executed check passed, all test resources removed) — see Tests below.
>
> Governance and analytics audit release. Three services' tools were compared one-by-one against every operation in their official API docs — 79 for [Sub Account](https://api.ncloud-docs.com/docs/management-subaccount), 27 for [Data Catalog](https://api.ncloud-docs.com/docs/analytics-datacatalog), 6 for [Resource Manager](https://api.ncloud-docs.com/docs/management-resourcemanager). The comparison turned up **five tools whose request URI made success impossible**, **two parameters that do not exist in the API at all**, a **path-encoding defect** affecting 15 tools, and a required-parameter defect that blocked tag-key-only resource lookups — alongside four field-reported gaps, all now resolved (17 new tools: 4 access-key, 7 policy, 6 Data Catalog write). Backward-compatible — no tool was removed and no parameter was dropped from a schema; the two non-existent parameters are still accepted and now explicitly reported as ignored. Specs confirmed against the official docs and, apart from the Data Catalog write tools, against the live API.

### Fixed
- **`ncloud_detach_policy_from_sub_account` and `ncloud_detach_policy_from_group` sent the policy ID in the URI path — every call failed.** Both built `DELETE /api/v1/{sub-accounts|groups}/{id}/policies/{policyId}` with no request body, but the API takes **no policy ID in the path**: it is `DELETE /api/v1/sub-accounts/{subAccountId}/policies` (and `.../groups/{groupId}/policies`) with the IDs in the body as `policyIdList`. Policy detachment via MCP was therefore entirely broken, while the matching attach tools (same paths, POST) worked. Both tools now send the documented path plus a `policyIdList` body, and gained a `policyIdList` array parameter so several policies can be detached in one call. The old singular `policyId` still works — it is merged into `policyIdList` (deduped) at send time — and a call with neither is rejected before reaching the API.
- **`ncloud_create_role` required `isMyAccount`, a parameter `createRole` does not have.** The API's create-role body is `roleName`, `roleType`, `sessionExpirationSec`, `descCont`, `tags`; `isMyAccount` belongs to a different endpoint entirely — *add Account role target* (`POST /api/v1/roles/{roleNo}/entities/account`). Callers were forced to supply a value that the server ignored, and the parameter implied the tool set the role's target when it did not. `isMyAccount` is now optional and **not sent**, with the description and the dry-run preview's `ignoredParams` naming the endpoint that actually consumes it.
- **`ncloud_create_group` sent `groupDescription`, a field the group resource does not have.** `createGroup` accepts only `groupName` and `tags`, and `getGroup` returns no description either. The value is no longer sent (still accepted, reported under the dry-run preview's `ignoredParams`), and the description points to tags as the way to annotate a group.
- **`ncloud_create_role` mis-documented `sessionExpirationSec`.** It was described as optional and "not allowed for Server type"; the API makes it **required when `roleType` is `Account`**. The parameter is now typed to the four valid values (600 / 1800 / 3600 / 10800) and a missing value on an `Account` role is rejected with a clear message instead of an API error.
- **Three Data Catalog table tools sent camelCase path segments where the API uses kebab-case — every call 404'd.** `ncloud_datacatalog_get_table_partition_keys` requested `.../tables/{tableName}/partitionKeys` instead of **`/partition-keys`**, `ncloud_datacatalog_get_table_schema_and_partition_keys` used `/schemaAndPartitionKeys` instead of **`/schema-and-partition-keys`**, and `ncloud_datacatalog_get_table_schema_versions` used `/schemaVersions` instead of **`/schema-versions`**. A knock-on effect: `ncloud_datacatalog_get_table_schema_by_version` had the right path (`/schema/{version}`) but was effectively unusable, because the only way to discover a version ID is the schema-versions listing that was broken. The file now carries a header note that Data Catalog path segments are kebab-case (`partition-keys`, `schema-and-partition-keys`, `schema-versions`, `run-scanner`), and a test asserts no request path contains any of the three camelCase spellings.
- **`ncloud_resource_list_resources` could not filter by tag key alone.** In `getResourceList`, `tag[].tagValue` is Optional — omitting it matches every resource carrying the key — but the tool's schema made it required, so "find everything tagged `env`" was impossible. Now optional.
- **`ncloud_resource_list_resources`'s `productName` description described the wrong thing, and a field report traced a false "this service has no resources" conclusion back to it.** The API defines `productName` as the resource's **service code** and matches it exactly; the tool's description offered display-name-style examples (`'Server (VPC)'`, `'VPC'`), which leads a caller to pass `Data Query` when the only accepted value is `DataQuery`. The result is zero rows for a service that does have resources — in #6 that nearly produced the conclusion that Data Query is absent from Resource Manager entirely. The description now states that this is the service code (no spaces or parentheses), that every filter in this API is an exact match, and that each returned item carries both `productName` (the code) and `productDisplayName` (the console name) so the valid codes can be discovered by listing without the filter.
- **Data Catalog interpolated database and table names into request paths without URL-encoding them.** Data Catalog's own `createDatabase` spec allows **spaces** in a database name (`[a-z0-9_\-\s]+`), so a database called `my database` produced a request path with a raw space — breaking both the URL and the signature computed over it. All 15 tools that put a name in the path now build it through shared `dbPath()` / `tablePath()` helpers that `encodeURIComponent` each segment.

- **`ncloud_create_role`'s description no longer implies that creating a role grants anything.** It now states that a role is only a container: policies must be attached (`POST /api/v1/roles/{roleNo}/policies`) and a role target set (`.../entities/account` or `.../entities`) — and that neither endpoint has an MCP tool yet.

### Added
- **Sub account API access-key tools (4)** — closes a field-reported gap: a sub account created through MCP could not call the API until someone issued its keys in the console:
  - `ncloud_create_sub_account_access_key` — POST `/api/v1/sub-accounts/{subAccountId}/access-keys`. Returns `accessKey` + `keySecret`; the description states that the secret is shown **only once** and should not be pasted into shared logs.
  - `ncloud_list_sub_account_access_keys` — GET the same path (keys with `active` state and `createTime`; secrets are never returned).
  - `ncloud_set_sub_account_access_key_status` — PUT with `{accessKey, active}` to deactivate or re-activate a key without deleting it.
  - `ncloud_delete_sub_account_access_key` — ⚠️ Destructive (confirm gate), DELETE with `{accessKey}`; the warning points to the status tool for a reversible disable.
- **User-created (custom) policy tools (7)** — closes a field-reported gap: fine-grained permissions (Action / Resource / Condition) could not be designed or inspected from MCP, so scoping a sub account meant leaving for the console:
  - `ncloud_create_policy` — POST `/api/v1/policies` with `policyName`, `permissions`, optional `description`/`tags`. The permission shape is the API's own: `permissions[{effect: "Allow", targets[{product, actions[], resourceNrns[]}], condition?}]` (note: **not** the `permissionList[{action, resource}]` shape the bug report guessed at). `actions` accepts an exact action name, `View*`, `Change*`, or `*`; `resourceNrns` accepts `["*"]`.
  - `ncloud_validate_policy` — POST `/api/v1/policy/validation`. **Real server-side validation** before creating: returns `success` plus INFO/WARNING/ERROR `details`. Annotated read-only.
  - `ncloud_get_policy_detail` — GET `/api/v1/policies/{policyId}`, defaulting `withPermissions=true` (the API defaults to false) so the permission statements are actually returned — `ncloud_list_policies` only ever showed names and descriptions.
  - `ncloud_get_policy_resources` — GET `.../resources`: which sub accounts, groups and roles a policy is assigned to.
  - `ncloud_update_policy` — PUT `.../{policyId}`. The description states that `permissions` **replaces** the existing statements, so the current set should be read first.
  - `ncloud_delete_policy` / `ncloud_delete_policies` — ⚠️ Destructive (confirm gate), single and multi. The multi form sends the documented **bare array** body (`["id1","id2"]`, not an object) and requires 2+ IDs, pointing single deletions at `ncloud_delete_policy`.
- **`ncloud_create_sub_account` gains the access-restriction and tag fields** the API documents but the tool never exposed: `useApiAllowSource` + `apiAllowSources[{type: IP | VPC | VPC_SERVER, source}]`, `useConsolePermitIp` + `consolePermitIps[]`, and `tags`. Without these, a sub account created via MCP could not be restricted to specific API source IPs/VPCs or console IP ranges at creation time.
- **`ncloud_create_group` and `ncloud_create_role` gain `tags`** (max 20 per resource), the only annotation mechanism those resources have.
- **Data Catalog write tools (6)** — closes a field-reported gap: the Data Catalog tools were read-only and the recommended ingestion path (register an Object Storage / Iceberg location as tables via a scanner) could not be built from MCP. Coverage goes from 21 of 27 operations to **27 of 27**:
  - `ncloud_datacatalog_create_scanner` — POST `/api/v1/catalogs/{catalogId}/scanners`. `type` accepts `OBJECT_STORAGE`, **`ICEBERG`**, the four `CLOUD_DB_FOR_*` types and `JDBC`. The API's three conditional rules are enforced before the call: `location` is required for `OBJECT_STORAGE`/`ICEBERG`, `connectionId` for the DB and JDBC types, and `schedule` (a cron expression) when `scheduleType` is `CRON`. The description and dry-run preview both state that creating a scanner does not scan — `ncloud_datacatalog_run_scanner` does.
  - `ncloud_datacatalog_create_database` — POST `.../databases`. The dry-run preview shows the `resolvedLocation`, since the API appends the database name to `location` as a sub-path (`s3a://mybucket` + `mydatabase` → `s3a://mybucket/mydatabase`).
  - `ncloud_datacatalog_update_database` — PUT `.../databases/{databaseName}`, rejecting a call that would change nothing.
  - `ncloud_datacatalog_update_database_tag` / `ncloud_datacatalog_update_table_tag` — PUT `.../tag`. Both descriptions lead with the fact that the list **replaces all tags** (an empty list clears them) and name the tool to read the current tags with.
  - `ncloud_datacatalog_update_table_schema` — PUT `.../tables/{tableName}/schema`. The `columns` list replaces the entire schema (min 1 entry enforced); this is the only API path for correcting a column type a scanner inferred wrongly.
- **`ncloud_resource_list_resources` now diagnoses a zero-result `productName` filter instead of just returning nothing.** When a `productName` filter matches no resource, the tool retries once with that one filter removed (same other filters, first 100 rows) and attaches `productNameFilterHint`: the `productName` / `productDisplayName` pairs that actually exist, plus `suggestedProductName` when one of them matches the input after normalization (lowercasing and dropping non-alphanumerics), so `"Data Query"` resolves to `DataQuery`. The extra call happens only in the zero-result case, and if the probe itself fails the original response is returned untouched — a diagnostic must never turn a successful query into an error. This is the closest thing to the partial matching the field report asked for: the API supports exact matching only, and has no display-name filter at all.
- **Resource Manager parameter constraints are now documented in the tool descriptions**: `size` range 1~100, `page` is 0-based, tag key 1~128 chars / value 1~256 chars with the allowed special characters (`_ . / = + - @`), and the fact that every filter is an exact match. `nrnList` on the four tag/group tools now rejects an empty array before the call.

### Security
- **`vitest` bumped from `^3.1.3` to `^3.2.7`, clearing GHSA-5xrq-8626-4rwp (CVE-2026-47429, CVSS 9.8).** In Vitest `<3.2.6` the UI/API server can be made to read and execute arbitrary files via Windows-style path traversal. It is a **devDependency**, and exploitation needs the Vitest UI/API server to be listening (`--api.host`, `--ui`, or Browser Mode on Windows) — this repo runs `vitest --run` with no UI or API server, and the published package ships only `dist` + docs with `@modelcontextprotocol/sdk` and `zod` as its sole runtime dependencies, so no consumer of `ncloud-mcp-server` ever installed the affected package. Patched regardless, since the fix is a patch-level bump inside the same major.
- **`npm audit fix` applied to the rest of the dev tree** (vite 7.3.6, esbuild 0.28.2, postcss), taking the local audit to **0 vulnerabilities**. All of those were dev-server-only advisories in Vitest's own dependency chain.
- **Note on the remaining advisories seen in dependency scanners:** the SDK's HTTP transport stack (`hono`, `@hono/node-server`, `express-rate-limit`, `body-parser`, `qs`, `fast-uri`) carries its own advisories, but this server registers **`StdioServerTransport` only** — none of that HTTP code path is reachable. Those packages are transitive dependencies of `@modelcontextprotocol/sdk`, so a consumer's install resolves them from the SDK's own ranges, not from this repo's lockfile; keeping the declared range at `^1.12.1` means a fresh install already picks up the newest 1.x SDK.

### Notes
- **`create_sub_account` was not given an `issueApiKey` option**, one of the suggestions in the field report. A secret key is returned exactly once, at issue time; folding it into the account-creation response would mix a one-shot credential into a response callers tend to log, and would leave rotation/deactivation/deletion elsewhere anyway. The four access-key tools keep the whole key lifecycle in one place.
- **`ncloud_validate_policy` is the real server-side validation that dry runs were asked to provide, but only for policies.** No equivalent validation endpoint exists for server or block-storage creation, so `dryRun` there remains an input-shape preview (its wording was corrected in v1.11.0).
- **Data Catalog connection and catalog creation were not added, because those APIs do not exist.** The field report listed "커넥션 생성" and "카탈로그 생성" as missing tools, but the official API surface has only `getConnection`/`getConnections` and `getCatalogs` — creating a connection or a catalog is console-only. The report also missed four operations that *are* documented and are now wrapped (the update-database / update-table family).
- **The official Data Catalog overview page under-lists its own API.** Its API table shows only the 21 read operations; the six write operations (`createScanner`, `createDatabase`, `updateDatabase`, `updateDatabaseTag`, `updateTableSchema`, `updateTableTag`) are absent there but each has a complete spec page with request body and curl example, which is what these tools were written from. Same pattern as the NKS Add-on Manager gap in v1.10.0 — an operation missing from an overview table is not evidence the API is missing.
- **Resource Manager was already complete at 6 of 6 operations** — the audit found no missing endpoint there, only the description and schema defects above. Its documented `nrnList` sub-table looks like an array of `{nrn}` objects, but the curl examples send a plain string array, which is what the tools do and what live use confirms.
- **Sub Account coverage is now 26 of the 75 sub-account/group/policy/role operations.** The remaining gaps are tracked internally — most consequentially, **role operation** (attach policy / set role target / enable-disable) and **group membership** are entirely absent, so a role or group created via MCP cannot yet be populated. External Access (Trust Anchor, Profile, Subject, CRL — 24 operations on a different base URL, `https://externalaccess.apigw.ntruss.com`) is unimplemented.

### Tests
- New `src/tools/governance-sub-account.test.ts` (24): detach-policy path/body for both sub account and group (documented path, `policyIdList` body, legacy singular `policyId` merged and deduped, no-ID rejection without an API call, confirm gate); `create_role` sends only documented fields with `isMyAccount` withheld, rejects an `Account` role without `sessionExpirationSec`, omits it for `Server`, and reports the ignored parameter in the dry-run preview; `create_group` sends only `groupName`/`tags`; `create_sub_account` forwards the new access-source and tag fields without leaking `dryRun`; all four access-key tools (paths, bodies, confirm gate); all seven policy tools including `withPermissions`, the validation endpoint, the dry-run preview pointing at `ncloud_validate_policy`, and the bare-array multi-delete body.
- New `src/tools/analytics-datacatalog.test.ts` (20): the three corrected kebab-case paths plus a sweep asserting no request path contains `partitionKeys`/`schemaAndPartitionKeys`/`schemaVersions`; database and table names with spaces and `#` encoded in the path; `create_database` body and the dry-run `resolvedLocation`; `update_database` field filtering and its nothing-to-change rejection; tag replacement via PUT `/tag` for both database and table (including the empty list); `update_table_schema` body; and `create_scanner` — body excludes `catalogId`/`dryRun`, `ICEBERG` accepted with a location, all three conditional rules rejected before the API call, a DB type accepted with `connectionId`, and the dry-run preview stating that no scan runs.
- New `src/tools/governance-resource-manager.test.ts` (11): filters forwarded as given, a tag filter with the key alone, no probe when rows came back or when no `productName` was given, the zero-result probe (called with `productName` removed and `page`/`size` pinned, suggests the real code, dedupes and sorts the code list, omits the suggestion when nothing matches), the original response preserved when the probe throws, tag attach/detach (key-only detach behind the confirm gate), and group attach with an encoded `groupId`.
- Full suite: 211 -> 266 passing.
- **Live verification (2026-08-27~28 KST, KR region).** 33 checks run against a real account; every executed check passed and all created resources were deleted afterwards (verified back to the pre-test state). The five release-blocking items are confirmed working against the live API, not just against mocks:
  - **Policy detachment works — DELETE with a `policyIdList` body is accepted.** `detach_policy_from_sub_account` returned `[{success: true, name: "removePolicy"}]` and the sub account's `policies` came back empty; the group path was confirmed the same way, with `get_policy_resources` going from one `Group` entry to `[]`. The legacy singular `policyId` input was exercised on both and also detached correctly. This was the one assumption mocked tests could not settle (an API gateway may drop DELETE bodies), and it holds. `delete_sub_account_access_key` (same DELETE-with-body path) and `delete_policies` (bare-array body, two policies at once) also succeeded.
  - **Custom policies work end to end:** created, read back with statements, updated (the new `permissions` fully replaced the old ones — `View*` gone, `Change*` present), and deleted both singly and in bulk. `validate_policy` returned `{"details":[],"success":true}` for a valid definition and `ERROR iam.policy.invalidProduct` for a bad `product`, creating nothing either way.
  - **Access keys work:** issue returned `accessKey` + `keySecret` + `createTime`, list/deactivate/reactivate/delete all behaved as documented.
  - **The three corrected Data Catalog paths return 200** (`partition-keys`, `schema-and-partition-keys`, `schema-versions`) where they previously 404'd, and the version ID from `schema-versions` then fetched a versioned schema — the lookup that was unusable before.
  - **The Resource Manager diagnostics fire on real responses:** `productName: "Global DNS"` returned zero rows plus `suggestedProductName: "GlobalDNS"` and six code/display-name pairs, and a tag filter with the key alone matched resources with two different values (a `tagValue` filter matched only one).
  - **`create_sub_account`'s new fields are applied:** the account came back with `useApiAllowSource: true` and the submitted `apiAllowSources` entry, and its `tags` were later found through a Resource Manager tag query.
  - **Not verified:** Data Catalog write tools were exercised only up to their pre-call validation (all three `create_scanner` conditional rules rejected correctly, `create_database` dry-run resolved the location). Actually creating a database or scanner was skipped because Data Catalog has no delete API — cleanup would be console-only. Path encoding was confirmed indirectly (a bogus table name reached the API and came back as `12002 invalid Table Name` rather than failing to parse), since no name with a space exists in the account. Resource group add/remove was skipped for lack of a disposable group.

### Notes from live verification
- **A sub account holds at most two access keys.** The third issue attempt returns `409 최대 허용값을 초과하였습니다`. The limit is absent from the API docs; `ncloud_create_sub_account_access_key`'s description now states it and points at the status tool for rotation.
- **The server rewrites `resourceNrns: ["*"]`.** A policy created with `["*"]` on product `Server` reads back as `["nrn:*:Server:*::*"]`, so a round-trip comparison must not expect the submitted string. Documented on the parameter.
- **`getResourceList` does not enforce its documented `size` range.** `size: 101` returned 101 rows rather than being rejected or clamped to 100. The parameter description now states the documented range and this observed behavior instead of implying 100 is a hard cap — a client-side `.max(100)` was deliberately not added, since it would reject a call the API currently accepts.

## [1.11.0] - 2026-08-17

> Snapshot-creation bug fix from a field report, plus Ncloud Storage storage-class support — and, uncovered while verifying those against the live API, three pre-existing defects that had silently broken every XML-body bucket call and the Ncloud Storage object listing. `ncloud_create_snapshot` could never create a snapshot; it now works. Mostly backward-compatible — no tool name was removed and `blockStorageInstanceNo` keeps working; the one breaking-looking change (the lifecycle transition class enum) only rejects values the API never accepted. Specs confirmed against the official Ncloud API docs and **verified against the live Ncloud API** (see Live verification below).

### Fixed
- **`ncloud_create_snapshot` sent the wrong source-volume parameter name — every call failed.** The tool passed its own input name `blockStorageInstanceNo` straight through to the API, but `createBlockStorageSnapshotInstance` takes the source volume as **`originalBlockStorageInstanceNo`**. Every call therefore returned `900 / Required field is not specified. location : originalBlockStorageInstanceNo.`, regardless of volume state, region, or credentials — snapshot creation via MCP was entirely broken (query/delete snapshot tools were unaffected). The handler now maps the input to `originalBlockStorageInstanceNo` at send time and builds the request params explicitly instead of spreading the raw input.
- **`ncloud_create_snapshot` dry-run previewed a request that differed from the real one.** The preview echoed the input names; it now shows the endpoint and the exact `requestParams` that will be sent, so a wrong parameter name is visible in the preview.
- **Every S3-compatible request with a body now sends `content-md5` — XML-body bucket APIs were entirely unusable without it.** `S3CompatibleClient.request` never attached an integrity header, so Ncloud Storage rejected `ncloud_put_bucket_lifecycle` with `InvalidRequest: Missing required header for this request: Content-MD5 OR x-amz-checksum-*` (reproduced against the live API). The same pattern affected `ncloud_put_bucket_cors`, `ncloud_put_bucket_encryption`, and `ncloud_ncs_delete_objects` — all XML-body calls that had never worked. The client now computes the base64 MD5 of the body and adds `content-md5` **before signing** (so it lands in `SignedHeaders`), skipping injection when the caller already supplied `content-md5` or any `x-amz-checksum-*` header — a case-insensitive check, since a duplicate header differing only in case would corrupt the canonical headers and break the signature. This is a client-level fix, so it covers Object Storage's XML-body tools too. (`ncloud_delete_multiple_objects` in `storage-object.ts` set the header by hand and keeps working — the client defers to it.)
- **`ncloud_ncs_list_objects` returned an empty object list for every bucket.** Its `<Contents>` parser was a single regex that pinned the element order as `Key → LastModified → Size → ETag → StorageClass`, but ListObjectsV2 actually returns **`ETag` before `Size`**, so no entry ever matched: `keyCount` came back correct while `contents` was always `[]`, making populated buckets look empty. The parser now splits `<Contents>` blocks first and extracts each field independently, so element order no longer matters. `parseListBucketsXml` had the same order-pinned shape and was converted alongside it. (Pre-existing defect, unrelated to the rest of v1.11.0 — found while verifying storage classes.)
- **`ncloud_ncs_head_object` did not report the object's storage class**, leaving no way to confirm what class an object was stored in once the list parser failed. It now returns `storageClass` from the `x-amz-storage-class` response header, plus `storageClassHeader` recording whether the header was actually present — S3-compatible services omit it for `STANDARD`, so an absent header is reported as `STANDARD` with that reasoning made explicit rather than silently assumed.
- **`ncloud_put_bucket_lifecycle` offered storage classes that do not exist in Ncloud Storage.** The transition target enum was `STANDARD_IA` | `GLACIER` (AWS S3 class names) and the description advertised `STANDARD`/`STANDARD_IA`/`GLACIER`; the service's `PutBucketLifecycleConfiguration` spec allows only **`ONEZONE_IA`** and **`DEEP_ARCHIVE`** as `Transition.StorageClass`. Every transition rule the tool could produce was therefore invalid. The enum now matches the spec. Callers who previously passed `STANDARD_IA`/`GLACIER` will now get a schema rejection instead of an API rejection — those rules never applied in the first place.
- **`ncloud_create_server` dry-run omitted `networkInterfaceList` and `associateWithPublicIp`.** Both were applied correctly on the real call, but the hand-curated preview object left them out, making it look like they had been dropped. The preview now includes the resolved NIC list (order / subnet / ACGs / IP), `associateWithPublicIp`, and `isProtectServerTermination`.

### Added
- **`ncloud_create_snapshot` gains three parameters** documented by the API but previously unavailable: `originalBlockStorageInstanceNo` (the API's own name for the source volume — accepted as an alias of `blockStorageInstanceNo` and taking precedence when both are given), `snapshotTypeCode` (`FULL` | `INCREMENTAL`), and `regionCode`. Name/description constraints from the doc (3–30 chars, ≤ 1000 bytes) are now stated in the parameter descriptions.
- **Ncloud Storage storage-class selection, including the new `ONEZONE_IA` class.** `ncloud_ncs_put_object` and `ncloud_ncs_copy_object` gain an optional `storageClass` parameter — `STANDARD` (default) | `ONEZONE_IA` (One Zone-IA / Infrequent Access) | `DEEP_ARCHIVE` (Archive) — sent as the `x-amz-storage-class` header per the PutObject/CopyObject specs. Omitting it preserves the previous behavior (no header; the API applies `STANDARD`). `ncloud_ncs_put_object`'s dry-run preview shows the class that will be applied, and `ncloud_ncs_copy_object` reports it in its result. Copying an object onto itself with a different class is how an existing object's class is changed.
- **`snapshotTypeCode` is documented as XEN-only.** Per the Ncloud user guide (*서버 > 스냅샷 생성 (VPC)*), snapshot-type selection exists only on **XEN (Gen2, HDD/SSD)** volumes: `FULL` (default) or `INCREMENTAL`, where an incremental snapshot requires an existing full snapshot of the same volume and is capped at 7 per full snapshot. **KVM (Gen3, CB1/CB2/FB1/FB2) has no snapshot type at all** — the console offers no such choice — so the parameter should be omitted for KVM volumes. The API reference does not carry this distinction; the parameter description and the dry-run preview do (the preview no longer claims "FULL (default)" for an unset type). Description-level guidance only — not enforced in code, since the hypervisor would require an extra lookup per call. Live testing confirmed the API **accepts `snapshotTypeCode: "INCREMENTAL"` on a KVM volume without an error and creates a `FULL` snapshot anyway**, so the description says so explicitly and the dry-run preview raises a `warning_snapshotTypeCode` whenever the parameter is set.

### Changed
- **The shared dry-run message now states that no server-side validation is performed.** `dryRunMessage` (`src/tools/_messages.ts`, used by every `create_*`/upload/apply preview) previously said only "이 요청은 실제 X를 생성하지 않습니다", which read as if the request had been validated. It now adds that the preview checks the input shape only and that a successful preview does not guarantee the real call will succeed — the API is never contacted during a dry run. Affects the preview text of all dry-run-capable tools; no behavior change.

### Notes
- **`CreateMultipartUpload` also accepts `x-amz-storage-class`**, but Ncloud Storage multipart upload is not wrapped by any tool yet (`ncloud_ncs_*` covers buckets, objects, and lifecycle only), so there was nothing to extend there.
- **`HeadObject` does not document a storage-class response header** in the Ncloud Storage spec. It is reported anyway (see Fixed) because live testing left no other way to confirm an object's class, but it is read defensively: an absent header is reported as `STANDARD` with `storageClassHeader` stating the header was missing, so a service that never sends it cannot be mistaken for one that stores everything as `STANDARD`. The authoritative source remains `ncloud_ncs_list_objects`, whose `<StorageClass>` element comes straight from the API.

### Tests
- New `src/client/s3-compatible-client.test.ts` (5): `content-md5` computed for body-bearing requests, included in `SignedHeaders`, absent on bodyless queries, and not injected when the caller already set `content-md5` (any casing) or `x-amz-checksum-*`.
- New `src/tools/storage-ncloud.test.ts` (10): ListObjectsV2 parsing against the real element order (ETag before Size, with and without an `<Owner>` block), bucket-list parsing, `head_object` storage-class reporting in both the header-present and header-absent cases, `x-amz-storage-class` header emitted for put/copy, header omitted when unset, dry-run preview shows the class, lifecycle transitions emit `<StorageClass>ONEZONE_IA</StorageClass>`, and schema rejection of the non-existent `STANDARD_IA`/`GLACIER` classes.
- New `src/tools/compute-storage.test.ts` (6): source-volume name mapping (`blockStorageInstanceNo` → `originalBlockStorageInstanceNo`, wrong name no longer sent), alias precedence, missing-source rejection without an API call, optional `snapshotTypeCode`/`regionCode` filtering, the KVM `warning_snapshotTypeCode` preview warning, and the dry-run preview showing the real request params. `_messages.test.ts`: dry-run message states the no-server-side-validation limitation (ko/en). Full suite: 211 passing.
- **Live verification (2026-08-17, KR region).** Run against a real account across three rounds; two of the fixes above exist *because* of it.
  - **Snapshots:** `ncloud_create_snapshot` with the legacy `blockStorageInstanceNo` input now returns a snapshot instead of `900 Required field is not specified`; alias precedence resolves to `originalBlockStorageInstanceNo`; the missing-source guard blocks the call before it reaches the API; created snapshots carry the submitted name and description. Test snapshots were deleted afterwards.
  - **Lifecycle:** the `content-md5` failure was found here — `ncloud_put_bucket_lifecycle` was rejected outright, then applied successfully after the client fix, with `ncloud_get_bucket_lifecycle` confirming `storageClass: ONEZONE_IA`. `ncloud_ncs_put_object` and `ncloud_ncs_delete_objects` were re-run afterwards to confirm the new header caused no regression on either the auto-injected or the manually-set path.
  - **Object listing:** the empty-`contents` defect was found here too, and `ncloud_ncs_list_objects` / `ncloud_ncs_list_buckets` / `ncloud_ncs_head_object` were confirmed working after the parser fix.
  - **Not verified:** storing an object *as* `ONEZONE_IA`/`DEEP_ARCHIVE` was left untested to avoid minimum-retention charges — that path is covered only at the schema, preview, and request-header level. XEN incremental snapshots were skipped for the same reason (cost), and the English dry-run wording was checked by unit test rather than a live `NCLOUD_LANG=en` restart.

## [1.10.1] - 2026-07-25

> Patch from live verification of the v1.10.0 NKS Add-on Manager tools (all 8 tools passed an end-to-end lifecycle test against a live k8s 1.36.2 KVM cluster). Two follow-ups only; no schema/behavior change.

### Fixed
- **Client error messages for REST/Spring-style flat error bodies** — `NcloudClient.handleErrorResponse` assumed `body.error` was always an object `{errorCode, message}` and blindly destructured it. Endpoints that return a flat REST error (e.g. `{status, error: "Bad Request", message, path}` — observed on the NKS `/vnks/v2/addon-configs` catalog path) have `body.error` as a **string**, so failures surfaced as "에러 코드: undefined / 메시지: undefined". The parser now guards `body.error` to objects and adds a flat-shape branch that reads the top-level `message` + `statusCode`/`status`. Improves diagnostics for every endpoint returning that shape, not just NKS.

### Changed
- **`ncloud_nks_list_available_addons` description corrected** — it claimed the **LoadBalancer Controller** is available as an installable add-on, but the live 1.36.2 catalog contains only `external-dns`, `nks-csi`, `nks-gateway-adapter`, `nks-nas-csi` (no LB Controller add-on). The description now names only the verified ExternalDNS provider and notes the catalog varies by version/region. (Corrects the unverified claim in the v1.10.0 notes; ExternalDNS-as-add-on was confirmed installed and running in testing.)
- **Add-on Manager's Kubernetes 1.36+ requirement made explicit on the catalog tools** — `ncloud_nks_list_available_addons`, `ncloud_nks_get_available_addon`, and `ncloud_nks_get_available_addon_version` now state that Add-on Manager is only available on Kubernetes 1.36+ clusters (previously only `ncloud_nks_install_addons` mentioned it).

### Tests
- New client error-format case (`ncloud-client.test.ts`): flat REST error body (`{status, error:"Bad Request", message}`) now surfaces the real message/status instead of `undefined`. Full suite: 189 passing.

## [1.10.0] - 2026-07-24

> Ncloud platform-update tracking release (2026-07). Reflects two upstream updates: the **NKS Add-on Manager** (2026-07-23 Kubernetes Service update, 8 new tools) and **VOD Station channel editing** (1 new tool). **Additive and backward-compatible** — no existing tool names/schemas changed. Endpoint specs were confirmed against the official Ncloud API docs; behavior is covered by mocked unit tests (not exercised against the live API this round).

### Added
- **NKS Add-on Manager tools (8)**, `ncloud_nks_*` (Add-on Manager is available on Kubernetes 1.36+ clusters):
  - `ncloud_nks_list_available_addons` — GET `/vnks/v2/addon-configs` (installable catalog; requires `k8sVersion` in `major.minor.patch`).
  - `ncloud_nks_get_available_addon` — GET `/vnks/v2/addon-configs/{addonName}`.
  - `ncloud_nks_get_available_addon_version` — GET `/vnks/v2/addon-configs/{addonName}/versions/{version}` (returns the `configurationValues` schema).
  - `ncloud_nks_list_cluster_addons` — GET `/vnks/v2/clusters/{uuid}/addons` (installed add-ons + status).
  - `ncloud_nks_get_cluster_addon` — GET `/vnks/v2/clusters/{uuid}/addons/{addonRef}` (`addonRef` = add-on name or the installed add-on's UUID).
  - `ncloud_nks_install_addons` — POST `/vnks/v2/clusters/{uuid}/addons`. Request body is a **bare top-level JSON array** of `{addonName, version, configurationValues?, resolveConflicts?}`; `configurationValues` is a stringified JSON object and `resolveConflicts` is `Overwrite` (default) | `Preserve`. Supports `dryRun`.
  - `ncloud_nks_update_addon` — PATCH `/vnks/v2/clusters/{uuid}/addons/{addonRef}` (single-object body; at least one of `version`/`configurationValues`/`resolveConflicts` required).
  - `ncloud_nks_delete_addon` — ⚠️ Destructive, DELETE `/vnks/v2/clusters/{uuid}/addons/{addonRef}` behind the `confirm` gate.
  - The **LoadBalancer Controller** and **NAVER Cloud Global DNS (ExternalDNS) webhook provider** shipped in the same 2026-07-23 update have no dedicated management API — they are delivered as add-ons and installed via `ncloud_nks_install_addons`.
- **VOD Station `ncloud_vodstation_update_channel`** — new tool wrapping the channel-edit endpoint `PUT /api/v2/channels/{channelId}` (2026-07 VOD Station channel-editing update). Modifies a channel's `name`, `protocolList` (HLS/DASH), `segmentDuration`/`segmentDurationOption`, and `encryptionList`/`drm` settings. It is a full-replacement PUT, so callers provide the complete desired state. (Note: the modify API's channel-name field is `name`, distinct from create's `channelName`.)

### Notes
- **Kubernetes 1.36 needs no code change** — `k8sVersion` is a passthrough string and `ncloud_nks_get_versions` (`/vnks/v2/option/version`) surfaces new versions automatically.
- `deriveAnnotations` (`src/tools/_tool.ts`) now treats `install` as a non-destructive, create-like verb, so `ncloud_nks_install_addons` gets `destructiveHint: false`.
- The Cilium memory-leak fix / minor upgrade in the same NKS update is internal to the managed service and has no API surface (nothing to wrap).

### Tests
- New `src/tools/containers-nks.test.ts` (7): catalog list query, install `dryRun` + bare-array body shape, update field-filtering + empty-body rejection, delete `confirm` gate (both states). New `src/tools/media-vodstation.test.ts` (2): channel-update PUT path + `channelName`→`name` mapping, optional-field filtering. Full suite: 188 passing.

## [1.9.0] - 2026-07-24

> Compute usability release. Adds boot/data-volume selection to server creation and a stop-state pre-check to server termination, plus an internal source-file reorganization. Public changes are **additive and backward-compatible**: one new optional parameter on `ncloud_create_server`, and `ncloud_terminate_server` now pre-checks server state (the happy path — terminating already-stopped servers — is unchanged). No tool names, group keys, or existing schemas were removed or renamed. Parameter/precondition specs were confirmed against the official Ncloud API docs, covered by unit tests, and verified working against the live Ncloud API.

### Added
- **`ncloud_create_server` block storage mapping (KVM/Gen3).** New optional `blockStorageMappingList` parameter chooses the boot volume type (order 0, e.g. `CB2`) and/or creates additional volumes at server-creation time, matching the console. Each entry: `order` (0 = boot, 1–20 = additional), `blockStorageVolumeTypeCode` (`CB1`/`CB2`/`FB1`/`FB2`), `blockStorageSize`, `blockStorageName`, `snapshotInstanceNo`. Flattened to the API's 1-based `blockStorageMappingList.N.*` query params (same pattern as `networkInterfaceList`). Handler-side validation runs before the call: exactly one boot entry (order 0), unique orders, ≤ 21 entries. `dryRun` previews the resolved mapping. KVM-only (never sent on the XEN product-code path). Resolves the previously-documented limitation where the boot volume type could not be set and always defaulted to CB1.
- **CB2 recommendation for the KVM boot volume.** The `ncloud_create_server` description now recommends `CB2` for the Gen3 KVM boot volume unless the caller specifies otherwise — description-level guidance only, not enforced in code (no silent, irreversible volume-type change).

### Changed
- **`ncloud_terminate_server` now pre-checks server state before deleting.** On `confirm=true` it first queries the target servers and, if any is not stopped (`serverInstanceStatus.code !== "NSTOP"`) or has termination protection enabled, returns an actionable `{ terminated: false, blockedServers, nextSteps }` object **without calling the terminate API** — instead of letting the raw NCP "must be stopped" error bounce back and force another round-trip. When all targets are stopped and unprotected, termination proceeds exactly as before. The `confirm` gate, `⚠️ Destructive` warning, and `min(1)` validation are unchanged. Adds one read (`getServerInstanceList`) per terminate.
- **Internal: tool source files renamed to a `<group>-<service>.ts` convention** matching the registry group keys (e.g. `vpc.ts` → `network-vpc.ts`, `cloud-insight.ts` → `monitoring-cloud-insight.ts`, `global-edge.ts` → `cdn-global-edge.ts`, `autoscaling.ts` → `compute-autoscaling.ts`; 30 files via `git mv`). Import paths updated only in the `src/tools/index.ts` barrel. **No public tool names, descriptions, group keys, or schemas changed** — purely a file-layout cleanup so every service module is prefixed by its registry group.

### Tests
- `src/tools/compute-server.test.ts`: `blockStorageMappingList` flattening + validation (boot-volume required, duplicate/absent order rejection, dryRun preview) and `ncloud_terminate_server` pre-check (running → blocked, stopped+protected → blocked, stopped+unprotected → proceeds). Full suite: 179 passing.

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
