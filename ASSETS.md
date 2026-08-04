# ASSETS — 규격 · AI 툴 매칭 · 프롬프트 규칙

> 규격을 어긴 에셋은 **조용히 화면에 안 나온다.** 코드를 못 읽으면 원인을 못 찾는다.
> 그래서 이 문서가 CLAUDE.md 다음으로 중요하다.

---

## 1. 파일 규격 (엄수)

| 종류 | 포맷 | 크기 | 위치 |
|---|---|---|---|
| 타일러블 텍스처 (벽/바닥/천장) | PNG → WebP | **512×512** | `public/assets/textures/` |
| 특수 텍스처 (포스터·간판·서류) | PNG → WebP | 1024×1024 | `public/assets/textures/` |
| 모델 (무기·소품) | **GLB** (Y-up, 1 unit = 1m) | ≤ 8k tri | `public/assets/models/` |
| 모델 (좀비, 리깅+애니) | **GLB** | ≤ 6k tri | `public/assets/models/` |
| SFX | **MP3** 44.1kHz | ≤ 3초 | `public/assets/audio/sfx/` |
| 앰비언스 | **MP3** | 20초 루프 | `public/assets/audio/ambience/` |
| UI 아이콘 | SVG 또는 PNG 256px | — | `public/assets/ui/` |

### 파일명 규칙 — 소문자 + 언더스코어만
```
wall_tile_concrete.webp      floor_linoleum_dirty.webp
prop_wheelchair.glb          weapon_axe.glb
zombie_shambler.glb          sfx_pistol_fire.mp3
amb_hospital_hum.mp3
```
> 대문자·공백·한글 파일명 금지. 로딩 실패의 90%가 여기서 난다.

---

## 2. AI 툴 매칭 — 무엇을 무엇으로 만드는가

### 실제로 쓸 4개 (1주 스코프)

| 툴 | 담당 | 왜 이걸 쓰는가 |
|---|---|---|
| **Claude Code** | 코드 전부, 레벨 배치 데이터 | 이 저장소의 유일한 코드 작성자 |
| **Higgsfield** | 벽/바닥 텍스처, 포스터·간판, 앰비언스 음악, **발표용 트레일러** | 이미 붙어 있어 왕복이 없다. 트레일러까지 한 곳에서 |
| **Mixamo** (무료) | **좀비 리깅 + 걷기/달리기/공격/사망 애니메이션** | 1주 안에 좀비를 움직이게 하는 유일한 현실적 방법. 무료 |
| **ElevenLabs** | SFX 전부 (총성·발소리·신음·문·유리) | **분위기의 절반.** SFX 30개가 텍스처 30장보다 효과 크다 |

### 선택 (시간 남을 때만)

| 툴 | 담당 | 판단 |
|---|---|---|
| Meshy / Tripo | 무기·소품 3D | 무기 2~3개면 Higgsfield `generate_3d` 로도 됨. 리깅 필요 없으니 |
| Scenario | UI 아이콘 일관성 | 아이콘 10개 수준이면 과잉 |
| Suno | BGM | **호러엔 BGM이 오히려 방해.** 앰비언스로 대체 권장 |

### 작업 순서 (중요)
```
1. 코드로 회색 박스 레벨 완성  ← 먼저. 에셋 없이 게임이 돌아가야 한다
2. SFX 투입 (ElevenLabs)       ← 여기서 갑자기 무서워진다
3. 텍스처 교체 (Higgsfield)     ← 회색 박스에 입히기만
4. 좀비 모델 교체 (Mixamo)
5. 트레일러 (Higgsfield)        ← D-1
```
> **에셋을 먼저 만들지 마라.** 규격이 확정되기 전에 만든 에셋은 전부 다시 만들게 된다.

---

## 3. AI 이미지 프롬프트 규칙

### 모든 프롬프트에 반드시 붙이는 꼬리표
```
, no real-world logos, no brand names, fictional signage only,
seamless tileable, flat lighting, no baked shadows, orthographic front view,
PBR albedo map, 512x512
```
- `no baked shadows` — 텍스처에 그림자가 구워지면 게임 조명과 충돌해서 싸구려로 보인다
- `seamless tileable` — 안 붙이면 이어붙일 때 경계선이 보인다
- `flat lighting` — 손전등 연출이 살아나려면 텍스처가 평평해야 한다

### 톤 고정 문구 (모든 텍스처에 동일하게)
```
abandoned quarantine hospital, 2029, sickly institutional green and grey,
peeling paint, water stains, dried grime, cold desaturated palette
```
> 이 문장을 매번 복사해 넣는 것이 **스타일 일관성의 전부**다. 바꾸지 마라.

### 예시
```
[텍스처] seamless tileable hospital corridor wall, sickly institutional green
tiles, peeling paint, water stains, abandoned quarantine hospital 2029,
cold desaturated palette, flat lighting, no baked shadows, PBR albedo,
no real-world logos, fictional signage only, 512x512

[포스터] weathered quarantine notice poster, fictional agency,
Korean and English warning text, torn corner, stained, flat lighting, 1024x1024
```

---

## 4. SFX 목록 — 우선순위 순 (ElevenLabs)

**1순위 (없으면 게임이 안 무섭다)**
`sfx_footstep_concrete_01~04` · `sfx_zombie_idle_groan_01~03` · `sfx_zombie_alert` ·
`sfx_zombie_attack` · `sfx_pistol_fire` · `sfx_flashlight_click` · `amb_hospital_hum`

**2순위**
`sfx_axe_swing` · `sfx_axe_hit_flesh` · `sfx_reload_pistol` · `sfx_door_open_creak` ·
`sfx_player_hurt` · `sfx_heartbeat_low`

**3순위**
`sfx_glass_break` · `sfx_lever_pull` · `sfx_generator_start` · `sfx_radio_static` ·
`sfx_zombie_death` · `amb_basement_drip`

> 발소리는 **반드시 4종 이상**. 한 개를 반복하면 즉시 싸구려로 들린다.

---

## 6. 좀비 모델 준비 절차 (Mixamo → GLB)

> 이 절차는 `fbx_to_glb.py` 가 전제하는 계약이다. 파일명과 위치만 맞으면 나머지는 자동이다.

### 6-1. 준비물

| 항목 | 상태 |
|---|---|
| Blender 4.5 LTS | `C:\Program Files\Blender Foundation\Blender 4.5lender.exe` (설치 완료) |
| Mixamo 계정 | Adobe ID 로그인 필요 |

### 6-2. Mixamo 다운로드 설정 (매 파일 동일)

| 항목 | 값 |
|---|---|
| Format | `FBX Binary(.fbx)` |
| **Skin** | **`idle` 만 `With Skin`**, 나머지 전부 `Without Skin` |
| Frames per Second | `30` |
| Keyframe Reduction | `none` |

> **Characters 탭에서 캐릭터를 먼저 고른 뒤** Animations 를 받는다. 순서가 반대면 기본 마네킹으로 받아진다.
> `With Skin` 을 여러 개 받으면 같은 몸이 중복돼 파일이 몇 배가 된다.

### 6-3. 파일명 = 애니메이션 클립 이름

필수 5개 — 상태머신(`enemies/Zombie.js`)이 요구한다.

| 파일명 | 동작 | 쓰이는 상태 |
|---|---|---|
| `idle.fbx` | 서서 흔들거림 | 정지 시 |
| `walk.fbx` | 느릿한 배회 걷기 | `WANDER` · `SEARCH` · `ALERT` |
| `run.fbx` | 달리기 | `CHASE` |
| `attack.fbx` | 후려치기 / 물기 | `ATTACK` |
| `death.fbx` | 쓰러짐 | `DEAD` |

선택 — 변형은 `_01` `_02` 를 붙인다. 코드에서 개체마다 무작위로 고른다.
`walk_02` · `attack_02` · `death_02` · `scream` · `hit` · `crawl` · `standing_up`

> 소문자 + 언더스코어만. `walk (1).fbx` 로 들어가면 클립 이름이 `walk (1)` 이 되어 코드가 못 찾는다.

### 6-4. 보관 위치

```
fbx_src/                              ← 원본 FBX (gitignore 됨. 무거워서 저장소에 안 올린다)
public/assets/models/zombie_shambler.glb   ← 변환 결과물 (이것만 커밋된다)
```

### 6-5. 변환

```
blender --background --python fbx_to_glb.py -- fbx_src public/assets/models/zombie_shambler.glb idle_03.fbx
```

세 번째 인자는 **본체(캐릭터 메시)로 쓸 파일**이다. `With Skin` 을 여러 개 받았을 때
어느 캐릭터를 쓸지 정한다. 생략하면 메시가 든 첫 파일이 잡힌다.

스크립트가 자동으로 처리하는 것 — **아래는 신경 쓸 필요 없다**:

| 항목 | 처리 |
|---|---|
| 루트 이동 (Mixamo `In Place`) | 모든 클립에서 무조건 제거. 위치는 `Zombie.js` 가 정한다 |
| 모델 크기 | 1.75m 로 정규화 (Mixamo 는 cm 단위라 그냥 쓰면 100배) |
| 삼각형 수 | 6000 초과 시 데시메이트 |
| 축 | Y-up 으로 변환 |
| 텍스처 | 1024 이하로 축소 + WebP 변환 (2048 PNG 4장이면 GLB 가 18MB 가 된다) |
| 클립 병합 | FBX 여러 개 → 애니메이션이 전부 든 GLB 하나 |

---

## 4-B. 외부 3D 모델 출처 (Sketchfab)

> **성격**: 개발자가 Sketchfab 에서 **직접 내려받아 사용하는 서드파티 모델**이다.
> 제작자와의 제휴·후원·허가 관계가 아니며, 각 모델의 공개 라이선스 범위 안에서만 쓴다.
> 아래 표는 그 출처를 밝히기 위한 기록이다.
>
> **라이선스 칸이 "확인 필요"인 항목은 각 모델 페이지에서 라이선스 종류를 확인해 채운다.**
> CC-BY 계열이면 제작자 표기가 의무이므로, 제출 전 이 표가 곧 크레딧이 된다.

### 단품 소품

| 파일(예정) | 원본 모델명 | 제작자 | 출처 링크 | 라이선스 | 용도 |
|---|---|---|---|---|---|
| `prop_bed_worn.glb` | Old and worn out hospital bed | Javier Pozo | https://skfb.ly/6RSGM | 확인 필요 | 병상 A (낡음) |
| `prop_bed.glb` | Hospital Bed | Larry3d | https://skfb.ly/6XpTM | 확인 필요 | 병상 B |
| `prop_wheelchair.glb` | wheelchair (horror game hospital) | japan3d | https://skfb.ly/E8KH | 확인 필요 | 휠체어 |
| `prop_panel.glb` | Electrical Breaker Panel Box – LP model | Nikoleta.Zhecheva | https://skfb.ly/pzHtH | 확인 필요 | **배전반** — 기계실 자판기 대용 제거 |
| `prop_ivdrip.glb` | Crutch and IV Drip | Matt LeMoine | https://skfb.ly/6WSTS | 확인 필요 | 링거대 + 목발 |
| `prop_ivpole.glb` | IV Pole | *(제작자 미확인)* | https://skfb.ly/6RzEu | 확인 필요 | 링거대 B — **제작자 확인 필요** |
| `prop_firstaid.glb` | First aid box | TahirNilin | https://skfb.ly/6XQTO | 확인 필요 | 구급상자 (수색 대상) |
| `prop_cabinet.glb` | Filing Cabinet | matthijs001 | https://skfb.ly/6CNHM | 확인 필요 | 서류함 |
| `prop_bodybag.glb` | Body Bag01 | AaronJC | https://skfb.ly/ozzOC | 확인 필요 | 시신 자루 — 영안실 |
| `prop_corpse.glb` | corpse | Daniel Yang | https://skfb.ly/6YJsD | 확인 필요 | 시체 — 영안실·복도 |
| `prop_vending.glb` | Vending Machine | RackRibs | https://skfb.ly/oGp7o | 확인 필요 | 자판기 |

### 팩 · 룸 스케일 — **소품만 추출해서 사용** (방식 b)

원본은 벽·바닥·조명이 포함된 환경 모델이다. 통째로 쓰면 절차적 레벨과 톤이 충돌하므로,
Blender 로 필요한 오브젝트만 분리해 개별 GLB 로 재출력한다.

| 원본 모델명 | 제작자 | 출처 링크 | 라이선스 | 추출할 것 |
|---|---|---|---|---|
| Morgue Room | LJM | https://skfb.ly/6RHzP | 확인 필요 | 시체 보관 서랍벽 · 해부대 |
| Charité University Hospital - Operating Room | ChrisRE | https://skfb.ly/oCTvA | 확인 필요 | 수술등 · 수술대 |
| Hospital Reception Environment | CaseyPozzobon | https://skfb.ly/oG98U | 확인 필요 | 접수 데스크 · 대기 의자 |
| VR ready hospital props | Grish_Avetisyan | https://skfb.ly/oEGEr | 확인 필요 | 팩 — 쓸 만한 소품 개별 분리 |

### 무기

| 파일(예정) | 원본 모델명 | 제작자 | 출처 링크 | 라이선스 | 용도 |
|---|---|---|---|---|---|
| `weapon_pipe.glb` | Bloody Lead Pipe | Molfgang | https://skfb.ly/oWoGT | 확인 필요 | **쇠파이프** (1순위) |
| — | PS1 Style Horror Pipe Weapon | Jan_Strydom | https://skfb.ly/oTpMT | 확인 필요 | 파이프 예비. PS1 로우파이라 PBR 과 충돌 가능 |
| `weapon_pistol.glb` | 9mm Pistol | TORI106 | https://skfb.ly/owxRE | 확인 필요 | 권총 |
| `weapon_crowbar.glb` | Crowbar | NINATOR | https://skfb.ly/o7OtO | 확인 필요 | 지렛대 — `weapons.js` 에 정의 추가 필요 |

> 산탄총은 밸런스 사유로 제외(사용자 판단).

### 반입 실측 (2026-08-04) — 그대로는 못 쓴다

| 파일 | MB | 메시 | 재질 | 이미지 | 삼각형 | 판정 |
|---|---|---|---|---|---|---|
| charite_operating_room | 12.5 | 8 | 5 | 4 | **334,808** | ★ 이것 하나가 삼각형 예산(350k)을 거의 다 먹는다 |
| hospital_reception_environment | 13.5 | 40 | 9 | 29 | 37,243 | 소품만 추출 |
| morgue_room | 13.9 | 42 | 7 | 20 | 14,080 | 소품만 추출 |
| vr_ready_hospital_props | 11.1 | 15 | 9 | 21 | 10,642 | 팩 — 개별 분리 |
| filing_cabinet | 6.7 | 5 | 2 | 6 | 1,045 | 삼각형은 적은데 **텍스처가 6.7MB** |
| crutch_and_iv_drip | 5.5 | 3 | 3 | 9 | 5,644 | 이미지 9장 |
| wheelchair | 4.6 | 1 | 1 | 3 | 3,222 | 메시1/재질1 — 인스턴싱 가능 |
| 9mm_pistol | 4.4 | 2 | 2 | 6 | 4,707 | |
| old_worn_hospital_bed | 4.2 | 3 | 3 | 9 | 526 | 삼각형 최소, 텍스처 과다 |
| hospital_bed | 3.5 | 1 | 1 | 3 | 9,724 | 메시1/재질1 — 인스턴싱 가능 |
| corpse | 3.1 | 1 | 1 | 3 | 12,833 | |
| breaker_panel | 2.8 | 3 | 3 | 8 | 4,698 | |
| first_aid_box | 2.8 | 1 | 1 | 2 | 1,396 | |
| iv_pole | 2.3 | 1 | 1 | 4 | 1,736 | |
| bloody_lead_pipe | 2.1 | 2 | 1 | 3 | 1,220 | 무기 1순위 |
| body_bag01 | 1.9 | 1 | 1 | 3 | 1,582 | |
| vending_machine | 1.6 | 2 | 2 | 1 | 1,625 | |
| crowbar | 0.7 | 1 | 1 | 3 | 732 | |
| ps1_pipe | 0.1 | 1 | 1 | 1 | 858 | |

**합계 약 100MB.** 현재 게임 전체 에셋이 ~10MB 인데 10배다.
`ASSETS.md §1` 의 초기 로딩 8초 예산을 그대로는 못 맞춘다.

### 반입 시 반드시 할 일

1. **텍스처 축소** — 용량의 대부분이 텍스처다. 512~1024 + WebP 로 재인코딩.
   좀비 GLB 선례: 18.6MB → 3.7MB (화면 차이 없음)
2. **수술실은 삼각형 감축 필수** — 334k 를 그대로 넣으면 다른 걸 아무것도 못 넣는다.
   소품(수술등·수술대)만 추출하면 대부분 해소된다
3. **룸/팩 4개는 오브젝트 분리** — Blender 로 필요한 것만 개별 GLB 재출력
4. **메시1/재질1 인 것(wheelchair, hospital_bed 등)은 InstancedMesh** 로 묶어 드로우콜 절약

### 원본 대비 수정 내역

게임에 넣으면서 손댄 부분을 남긴다. (CC-BY 계열은 변경 사실을 밝히는 것이 권장된다)

| 파일 | 수정 내용 |
|---|---|
| *(파일 반입 후 작성)* | 예: 스케일 ×2.55 · X축 -90° 회전 · 텍스처 2048→512 WebP · 재질 색 ×0.12 |

---

## 5. 라이선스 기록 (제출물 심사 대응 — 반드시 채운다)

| 에셋 | 생성/출처 | 플랜 | 상업 이용 | 비고 |
|---|---|---|---|---|
| wall_plaster_peeling_{color,normal,rough}.webp | ambientCG (PaintedPlaster015) | CC0 | 가능 | 512px WebP 로 리사이즈, AO를 color에 55% 합성 |
| floor_tile_hospital_{color,normal,rough}.webp | ambientCG (Tiles040) | CC0 | 가능 | 동일 |
| ceiling_panel_office_{color,normal,rough}.webp | ambientCG (OfficeCeiling001) | CC0 | 가능 | 동일 |
| decal_blood_{pool,splatter,drag}.webp | 절차적 생성 (numpy/PIL 스크립트) | 자체 제작 | 가능 | fBm 노이즈 기반. 저작권 이슈 없음 |
| sfx_footstep_concrete_01~04.mp3 | **ElevenLabs** Sound Effects | Free | 확인 필요 | 발소리 4종 |
| sfx_zombie_{idle_groan_01,alert,attack,death}.mp3 | **ElevenLabs** Sound Effects | Free | 확인 필요 | |
| sfx_{pistol_fire,flashlight_click,axe_swing,axe_hit_flesh,reload_pistol,player_hurt}.mp3 | **ElevenLabs** Sound Effects | Free | 확인 필요 | |
| amb_hospital_hum.mp3 | **ElevenLabs** Sound Effects | Free | 확인 필요 | 20초 루프 (API 최대 길이 22초) |
| zombie_shambler.glb | **Mixamo** (Adobe) | Free | 확인 필요 | 여성 좀비 캐릭터 + 애니메이션 19클립. 6k tri / 1024 WebP |
| weapon_axe.glb · weapon_molotov.glb | **Kenney** Survival Kit | CC0 | 가능 | 나머지 무기는 절차적 생성 (SF 광선총은 세계관에 안 맞아 제외) |
| prop_{enamel,metal,fabric}_*.webp | ambientCG (PaintedMetal013 / Metal038 / Fabric045) | CC0 | 가능 | 소품 PBR |

> **왜 OGG 가 아니라 MP3 인가** — ElevenLabs 는 OGG 를 내주지 않고 이 PC 에 ffmpeg 이 없다.
> 브라우저 Web Audio 는 MP3 를 전부 디코딩하므로 게임 동작은 동일하다. MP3 특허는 2017년 만료.
> 생성 스크립트는 `gen_sfx.py` (`.env.local` 의 키를 읽는다. 이미 있는 파일은 건너뛴다).

> **제출 전 확인**: ElevenLabs 무료 플랜의 상업적 이용 조건을 약관에서 확인하고 위 표의
> "상업 이용" 칸을 채울 것. 무료 플랜은 어트리뷰션을 요구하는 경우가 있다.

> 데칼 생성 스크립트는 `gen_blood.py` (BRIGHT 인자로 전체 밝기 조절).
> **주의**: 출력은 반드시 sRGB 인코딩(`^(1/2.2)`)해야 한다. 선형 값을 그대로 쓰면
> three.js 가 sRGB 로 디코딩해서 3~4배 어두워지고 화면에서 안 보인다.

> **왜 텍스처는 AI가 아닌가** — 이미지 생성 모델은 albedo 한 장만 내놓는다.
> 실사감을 만드는 normal/roughness 맵이 없고 seamless 도 보장되지 않는다.
> AI 는 **포스터·간판·경고문**(창작이 필요하고 타일링이 불필요)과 **SFX·트레일러**에 쓴다.

> 제출 전 이 표가 비어 있으면 안 된다. "AI를 어떻게 썼는가"가 심사 항목일 가능성이 높다.
