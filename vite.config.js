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
  build: { target: 'es2020', outDir: 'dist' },
});
