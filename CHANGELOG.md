# Changelog

All notable changes to this project will be documented in this file.

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
