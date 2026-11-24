import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 실제 네트워크 호출을 막는다(vitest.setup.ts 참고).
    setupFiles: ["./vitest.setup.ts"],
  },
});
