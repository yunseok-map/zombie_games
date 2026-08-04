# 구조 지도 — 이 기능은 어디 있나

> "○○을 고치려면 어느 파일을 열어야 하나"에 답하는 문서.
> 폴더 계약 자체는 `CLAUDE.md §4`, 에셋 규격은 `ASSETS.md` 를 본다.

## 기능 → 파일

| 고치고 싶은 것 | 파일 |
|---|---|
| **모든 수치** (속도·체력·데미지·조명·후처리·부상·전리품) | `src/config/balance.js` |
| **무기 추가/조정** | `src/config/weapons.js` — 코드 수정 불필요 |
| 게임 루프 · 시스템 조립 | `src/core/Game.js` |
| 키보드/마우스 · 포인터락 | `src/core/Input.js` |
| 벽 충돌 · 문 열기(박스 on/off) | `src/core/Collision.js` |
| 시스템 간 통신 | `src/core/EventBus.js` |
| 사운드 재생 · 3D 오디오 · 매니페스트 | `src/core/AudioManager.js` |
| 이동 · 절뚝임 · 발소리 · 부상 | `src/player/Player.js` |
| 손전등 · 배터리 | `src/player/Flashlight.js` |
| 발사 · 근접 · 재장전 · 뷰모델 | `src/weapons/WeaponSystem.js` |
| 좀비 상태머신 · 피격 연출 | `src/enemies/Zombie.js` |
| 좀비 GLB 로드 · 클립 매핑 · 옷 변형 | `src/enemies/ZombieModel.js` |
| 좀비 풀링 | `src/enemies/ZombiePool.js` |
| 긴장도 기반 스폰 | `src/enemies/Director.js` |
| 구역 생성 · 재질 · 지오메트리 병합 | `src/world/StageLoader.js` |
| **소품 형태** (침대·문·계단·자판기…) | `src/world/Props.js` |
| 핏자국 · 의료폐기물 산포 | `src/world/Scatter.js` |
| E키 상호작용 · 수색 · 전리품 | `src/world/Interaction.js` |
| **구역 배치** (무엇을 어디에) | `src/world/stages/hospital_a.js` |
| 포그 · 비상등 · 톤매핑 | `src/fx/Atmosphere.js` |
| 블룸 · 비네트 · 그레인 | `src/fx/PostFX.js` |
| 체력바 · 경고 · 크로스헤어 · 진단패널 | `src/ui/HUD.js` |

## 에셋

```
public/assets/
├─ textures/
│  ├─ surfaces/    벽·바닥·천장 PBR (ambientCG CC0)
│  ├─ props/       소품 PBR — 도장철판·강철·직물
│  ├─ decals/      핏자국 4종 (절차적 생성)
│  ├─ signage/     명패·포스터 아틀라스 4×4
│  └─ characters/  좀비 옷 변형 (가운·수술복)
├─ models/         zombie_shambler.glb
└─ audio/
   ├─ sfx/         발소리(재질 4종) · 좀비 · 무기
   └─ ambience/    병원 공조음
```

## 에셋 생성 도구 (`tools/`)

전부 저장소 루트에서 실행한다.

| 명령 | 만드는 것 |
|---|---|
| `python tools/gen_blood.py [밝기]` | 핏자국 데칼 4종 → `textures/decals/` |
| `python tools/gen_signage.py` | 명패·포스터 아틀라스 → `textures/signage/` |
| `python tools/gen_zombie_variants.py` | 좀비 옷 변형 → `textures/characters/` |
| `python tools/gen_sfx.py` | SFX·앰비언스 (ElevenLabs) → `audio/` |
| `blender --background --python tools/fbx_to_glb.py -- fbx_src out.glb [본체.fbx]` | Mixamo FBX → GLB |

`fbx_src/` 는 gitignore 됨 — 원본 FBX 는 무거워서 저장소에 안 올린다.

## 데이터 흐름

```
main.js
  └─ Game (루프 소유)
       ├─ Input ──────────┐
       ├─ Player ◄────────┤ (키 입력)
       ├─ WeaponSystem ◄──┘
       ├─ ZombiePool → Zombie ← ZombieModel (GLB 1회 로드, 개체마다 복제)
       ├─ Director (긴장도 → 스폰)
       ├─ StageLoader → Props / Scatter / Interaction
       ├─ Atmosphere + PostFX
       └─ HUD

시스템 간 직접 참조 대신 EventBus:
  SFX · NOISE · HINT · PLAYER_DAMAGED · ZOMBIE_DIED · AMMO_CHANGED …
```

**계층 규칙**: `core/` 는 `player/` · `enemies/` · `world/` 를 import 하지 않는다.
위쪽(게임)이 아래쪽(엔진)을 쓰는 단방향만 허용.

## 문서

| 파일 | 내용 |
|---|---|
| `CLAUDE.md` | 작업 규칙 (최우선) |
| `SPEC.md` | 게임 설계의 유일한 진실 |
| `PROGRESS.md` | 현재 상태 · 다음 할 일 |
| `ASSETS.md` | 에셋 규격 · AI 툴 · 라이선스 기록 |
| `docs/ARCHITECTURE.md` | 이 문서 |
| `docs/HOSPITAL_DETAIL.md` | 디테일 작업 계획서 · QA 기록 |
