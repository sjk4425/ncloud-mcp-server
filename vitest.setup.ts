/**
 * 테스트 중 실제 네트워크 호출 차단.
 *
 * v3.1.0 첫 릴리스 실행(2026-11-25)에서 mock 이 빠진 테스트 2건이 실제 Ncloud API 를 호출했고,
 * GitHub Actions(Node 22)에서 응답이 5초를 넘겨 타임아웃으로 실패했다. 로컬에서는 401 이 바로 와서
 * 통과했기 때문에 드러나지 않았다. 이제 mock 없는 fetch 는 즉시 오류로 끝나서 어디서 돌려도 같은 결과가 나온다.
 * fetch 를 직접 검사하는 테스트는 `vi.stubGlobal("fetch", ...)` 로 이 값을 덮어쓴다.
 */
globalThis.fetch = (async (input: unknown) => {
  const url = typeof input === "string" ? input : (input as { url?: string })?.url ?? String(input);
  throw new Error(`Real network call blocked in tests: ${url.split("?")[0]} — mock client.request/requestRaw or stub fetch.`);
}) as typeof fetch;
