import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // host: true — IPv4/IPv6 양쪽에 바인딩한다.
  // 기본값이면 ::1 에만 붙어서 localhost 가 IPv4 로 풀리는 환경에서 연결이 거부된다.
  // 같은 와이파이의 폰에서도 열 수 있어 시연에 편하다.
  server: {
    port: 5180, open: true, host: true,
    // 감시에서 뺀다 — 게임이 안 쓰는 **원본 에셋 폴더**다(수백 MB).
    // 여기를 감시하면 Blender 가 FBX 를 여는 순간 파일이 잠겨서 vite 가
    // EBUSY 로 죽는다. 변환을 돌리는 동안 개발 서버가 통째로 내려간다.
    watch: { ignored: ['**/fbx_src/**', '**/tools/source_*/**', '**/dist/**'] },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    // three 하나가 554kB(gzip 140kB)다. 3D 엔진이니 당연한 크기이고 줄일 방법이 없다 —
    // 기본 경고선(500kB)을 넘겼다고 매 빌드마다 경고를 띄우면 **진짜 경고를 가린다.**
    // 게임 코드 쪽이 이 선을 넘으면 그때는 진짜 문제이므로 600 으로만 올려 둔다.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        /**
         * three 를 **별도 청크로 뺀다.**
         *
         * 합치면 787kB 짜리 파일 하나가 나오는데, 그중 대부분이 three 다.
         * 게임 코드는 마감 전까지 계속 고치므로 배포할 때마다 해시가 바뀌고,
         * 한 덩어리면 **안 바뀐 three 까지 매번 다시 받는다.**
         * 갈라 두면 재방문·재배포 때 three 는 브라우저 캐시에서 나온다.
         *
         * 지연 로딩(dynamic import)은 하지 않는다 — 첫 화면부터 3D 를 그리므로
         * 쪼개 봐야 결국 같은 순간에 다 받아야 하고, 요청만 늘어난다.
         */
        manualChunks: { three: ['three'] },
      },
    },
  },
});
