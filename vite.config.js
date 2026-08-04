import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // host: true — IPv4/IPv6 양쪽에 바인딩한다.
  // 기본값이면 ::1 에만 붙어서 localhost 가 IPv4 로 풀리는 환경에서 연결이 거부된다.
  // 같은 와이파이의 폰에서도 열 수 있어 시연에 편하다.
  server: { port: 5180, open: true, host: true },
  build: { target: 'es2020', outDir: 'dist' },
});
