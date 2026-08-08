/**
 * ESLint — **오직 한 가지 목적**으로 둔다: 임포트가 빠진 식별자를 잡는 것.
 *
 *   npm i --no-save eslint
 *   npx eslint src tools
 *
 * 왜 필요한가 — 파일을 가르다 임포트를 빠뜨리면 **빌드는 그대로 통과한다.**
 * JS 는 그 줄을 실제로 실행할 때까지 모르기 때문이다. 자동 검사가 안 밟는
 * 경로면 제출본까지 그대로 간다. 실제로 두 번 그랬다:
 *   · WeaponViewModel 의 SURFACE·MUZZLE — 뷰모델 생성 때 터졌다 (하네스가 잡음)
 *   · WeaponViewModel 의 bus·EV — 재장전 중에만 터진다 (아무도 못 잡았다)
 *
 * 코드 스타일은 건드리지 않는다. 들여쓰기·따옴표·세미콜론 규칙을 켜면 기존
 * 파일 전체가 빨개져서 정작 봐야 할 것이 묻힌다.
 */
export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // 브라우저
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        location: 'readonly', console: 'readonly', fetch: 'readonly',
        performance: 'readonly', matchMedia: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        AudioContext: 'readonly', webkitAudioContext: 'readonly',
        Image: 'readonly', Audio: 'readonly', Blob: 'readonly', URL: 'readonly',
        AbortSignal: 'readonly', devicePixelRatio: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly',
        CustomEvent: 'readonly', Event: 'readonly', ResizeObserver: 'readonly',
        // Node (tools/ 스크립트)
        process: 'readonly', __dirname: 'readonly', Buffer: 'readonly',
        globalThis: 'readonly',
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      'no-undef': 'error',
      // 쓰지 않는 임포트는 경고만 — 가르는 과정에서 남은 것을 알려 주되 막지는 않는다
      'no-unused-vars': ['warn', {
        args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none',
      }],
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
];
