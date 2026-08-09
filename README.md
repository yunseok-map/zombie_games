# QUARANTINE No.3 — 제3격리병원

1인칭 좀비 서바이벌 호러. **브라우저에서 설치 없이 돌아간다.**
Vite + Three.js, 외부 엔진 없음. NHN GAME X AI HACKATHON (NAN 2026) 사전 과제 제출작.

**▶ 플레이: https://yunseok-map.github.io/zombie_games/**
**▶ 플레이 영상: https://www.youtube.com/watch?v=TH71shPSNqs**

봉쇄된 격리병원에서 깨어난다. 1F 격리병동 → B1 영안실 → 2F 병동 → 3F 수술부 →
옥상까지 다섯 구역을 지나 헬기를 부르는 것이 목표다.
손전등 배터리는 유한하고, 탄약은 모자라고, 물리면 마우스가 아니라 몸이 굳는다.

---

## 실행

```bash
npm install
npm run dev        # http://localhost:5180
```

Node 20 이상. 처음 실행 시 좀비·무기·소품 GLB 를 받느라 로딩 막대가 한 번 찬다.

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | `dist/` 로 정적 빌드 |
| `npm run lint` | ESLint. 경고 하나도 허용하지 않는다 (`--max-warnings 0`) |
| `npm run qa` | 자동 검사 — 구역 125항목 + 모션 1482프레임 + 전투 경로 |
| `npm run qa:dist` | 빌드한 뒤 **`dist/` 를 실제로 띄워** 게임이 시작되는지 확인 |
| `npm run verify` | lint → 사운드 배선 → QA 를 한 번에 |

## 조작

| 키 | |  | 키 | |
|---|---|---|---|---|
| `WASD` | 이동 | | `1` `2` `3` | 근접 · 총기 · 투척 |
| `Shift` | 달리기 (스태미나) | | `좌클릭` | 공격 |
| `Ctrl` | 웅크리기 | | `우클릭` | 정조준 |
| `F` | 손전등 | | `R` | 재장전 |
| `E` | 상호작용 · 수색 | | `Space` | 물렸을 때 연타로 뿌리치기 |
| `ESC` | 일시정지 | | | |

---

## 설계에서 지킨 것

**공포는 어둠·소리·정적으로 만든다.** 고어 묘사에 기대지 않는다.
손전등 사거리 밖은 완전한 검정이고, 포그 밀도로 시야를 강제로 자른다.
계속 무서우면 안 무서우므로 `Director` 가 긴장도를 보고 스폰을 조절하며 **쉬는 구간을 지킨다.**

**모든 수치는 `src/config/` 안에만 있다.** 속도·체력·데미지·거리·시간은 코드에 직접 쓰지 않는다.
값 하나만 고쳐서 게임 느낌을 바꿀 수 있어야 한다는 것이 이 프로젝트의 첫 번째 규칙이다.

**성능은 기능보다 먼저다.** 목표 1080p/60fps, 드로우콜 ≤ 300, 동시 좀비 14 하드캡,
그림자 광원은 손전등 하나. 좀비는 전부 풀링하고, 런타임에 `new Zombie()` 를 부르지 않는다.

**광원 개수를 절대 바꾸지 않는다.** three.js 는 셰이더 프로그램 캐시 키에 광원 **개수**를
넣기 때문에, 구역마다 광원이 늘고 줄면 그때마다 씬의 재질이 통째로 재컴파일된다
(누적 프로그램 68 → 200 을 실측했다). 그래서 비상등·달빛·불빛 모두 **자리를 미리 잡아 두고
세기만 0↔n 으로 여닫는다.** `fx/Atmosphere.js` 의 슬롯 구조가 이것이다.

---

## 구조

```
src/
├─ main.js              부트스트랩만. 로직 금지
├─ config/              ★ 모든 수치는 여기에만
│  ├─ balance.js          배럴 — 아래 다섯 개를 다시 내보낸다
│  ├─ balance/            player · zombie · combat · render · world
│  └─ weapons.js          무기 정의 (데이터 드리븐)
├─ core/                엔진 계층
│  ├─ Game.js             루프 · 씬 소유 · 시스템 조립
│  ├─ Input.js  EventBus.js  Collision.js  AudioManager.js
├─ player/    Player.js (이동·체력·부상·발소리) · Flashlight.js
├─ weapons/   WeaponSystem(장착) · WeaponAttack(판정) · WeaponViewModel(손)
│             Throwables(투사체·불웅덩이) · SwingCurves · ViewModels
├─ enemies/   Zombie · ZombieCombat · ZombieAnim · ZombieModel · ZombiePool
│             Director — 긴장도 기반 동적 스폰
├─ world/     StageLoader · Props · Scatter · Interaction · rng
│  └─ stages/   구역 5개 (데이터에 가깝게)
├─ fx/        Atmosphere(포그·조명) · PostFX(블룸·비네트·그레인) · Impact(피)
└─ ui/        HUD.js — DOM 오버레이
```

**계층 규칙**: `core/` 는 게임 내용을 몰라야 한다. 통신이 필요하면 직접 참조 대신 `EventBus`.
(예외는 `core/Game.js` 하나 — 시스템을 조립하는 합성 루트라서 위쪽을 안다.)

어느 파일을 열어야 할지 모르겠으면 **`docs/ARCHITECTURE.md` 의 기능→파일 표**를 본다.

---

## 자동 검사

브라우저 게임이라 "돌아간다"를 눈으로만 확인하면 놓친다.
그래서 실제 크롬을 띄워 게임을 돌리는 하네스를 만들고 **CI 게이트로 걸었다** —
검사를 통과해야 배포된다 (`.github/workflows/deploy.yml`).

| 도구 | 무엇을 보는가 |
|---|---|
| `tools/qa_run.mjs` | 구역 125항목 · 모션 1482프레임 · 전투 경로 · 콘솔/네트워크 오류 |
| `tools/qa_dist.mjs` | **빌드 결과물**을 띄워 404·번들 파손 확인. 개발 서버에서는 안 나는 사고 전담 |
| `tools/qa_geometry.mjs` | 충돌박스·메시 좌표 **지문**. 리팩터 뒤 맵이 안 움직였는지 바이트 비교 |
| `tools/qa_brightness.mjs` | 구역별 "먹통 %"(휘도 0.02 미만 픽셀) · 평균 휘도 · 탄 픽셀 |
| `tools/qa_swing.mjs` | 근접 스윙의 프레임별 진폭 |
| `tools/check_audio.mjs` | 등록 · 파일 · 재생 호출 3자 대조 |

**헤드리스 크롬은 소프트웨어 렌더라 이 게임이 1fps 로 돈다.** 그래서 하네스는 실제 플레이로
검사하지 않고, `game.state = 'PAUSED'` 로 세운 뒤 고정 dt 로 직접 프레임을 돌린다.
`main.js` 의 `window.game` 은 그 계약이다 — 지우면 CI 가 멈춘다.

이 검사가 실제로 잡아낸 것들: 임포트 누락 2건, 변수 가려짐(`no-undef` 로는 안 잡히는 종류) 1건,
등록만 되고 한 번도 안 울린 사운드, 그리고 화면에서 진폭이 정확히 0 이던 타격·투척 모션.

---

## 만드는 데 쓴 것

에셋을 살 예산이 없어서 **AI 생성 + CC0/CC BY 에셋**으로 채웠다.
어떤 도구로 무엇을 만들었고 라이선스가 무엇인지는 **`ASSETS.md` 에 전부 기록**돼 있다.

- **효과음·앰비언스 54종** — ElevenLabs Sound Effects
- **좀비 본체 4종 + 애니메이션 30클립** — Mixamo (Adobe) 28 · Sketchfab (CC BY) 2
- **소품 GLB 25개 · 무기 GLB 4개** — Sketchfab (CC BY 4.0) · Kenney (CC0)
- **표면·사이니지 텍스처** — ambientCG (CC0) · Python 절차 생성 (`tools/gen_*.py`)

CC BY 에셋의 제작자 22명은 **게임 안 크레딧 화면**에도 전원 표기돼 있다 (표기가 의무다).

> **ElevenLabs 무료 플랜 산출물은 약관상 비상업 한정**이다. 본 제출물은 판매·광고·수익화가
> 없는 무료 웹 게임이라 그 조건 안에 있다. 근거는 `docs/submission_ai_tech.html` §6-4 에
> 약관 원문으로 적어 뒀다.

---

## 문서

| 파일 | |
|---|---|
| `SPEC.md` | 게임 설계 — 구역별 사건, 적 종류, 난이도 곡선 |
| `PROGRESS.md` | 작업 기록 — 되는 것 / 안 되는 것 / **밟은 함정** |
| `ASSETS.md` | 에셋 출처·라이선스 전수 기록 |
| `SETUP.md` | 다른 PC 에서 개발 환경 세우기 |
| `CLAUDE.md` | 이 저장소에서 작업할 때의 강제 규칙 |
| `docs/notes/` | 개인 작업 메모 (제출물과 무관) |

### 해커톤 제출물

| 제출물 | 파일 |
|---|---|
| 1. 플레이 가능한 빌드 + 전체 소스 | 이 저장소 · [GitHub Pages](https://yunseok-map.github.io/zombie_games/) |
| 2. 플레이 동영상 | https://www.youtube.com/watch?v=TH71shPSNqs |
| 3. 게임 소개 및 설명 | [`docs/제출3_게임소개.pdf`](docs/) · 원본 `docs/submission_game_overview.html` |
| 4. AI 활용 기술 문서 | [`docs/제출4_AI활용기술.pdf`](docs/) · 원본 `docs/submission_ai_tech.html` |
| 5. 팀원 롤 기술서 | 개인 참여라 해당 없음 |

PDF 는 HTML 원본에서 `npm run pdf` 로 다시 만든다 — 내용을 고칠 때는 **HTML 을 고친다.**

`PROGRESS.md` 의 "알려진 함정" 절은 같은 실수를 두 번 하지 않으려고 남긴 것이라
이 프로젝트에서 가장 실용적인 문서다.
