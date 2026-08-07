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

> **팩(Pack)으로 받지 마라.** 변환기는 FBX 하나당 애니메이션 하나를 전제하고 파일명을
> 클립 이름으로 쓴다. 팩은 한 파일에 여러 동작이 들어가고, 내부 take 이름이 전부
> `mixamo.com` 으로 같아서 쪼개도 이름을 못 살린다. 팩 안의 동작은 전부 개별로도 받을 수 있다.

### 6-3-B. 2026-08-05 추가분 (8클립)

| 원본 (Mixamo) | 클립 이름 | 왜 넣었나 |
|---|---|---|
| Zombie Reaction Hit | `hit_02` | 피격 반응이 `hit_01` 하나뿐이라 14마리가 같은 동작으로 움찔했다 |
| Zombie Reaction Hit (1) | `hit_03` | 〃 |
| Zombie Scream | `scream` | **CLIP_VARIANTS 가 찾고 있었는데 파일이 없어 `attack_02` 로 폴백 중이었다** |
| Zombie Dying | `death_03` | 사망 변형 |
| Zombie Headbutt | `attack_04` | 공격 변형 |
| Zombie Punching | `attack_05` | 공격 변형 |
| Zombie Stumbling | `walk_04` | 비틀거리며 걷기 — 배회에 가장 어울린다 |
| Zombie Running | `run_02` | 달리기가 하나뿐이었다 |

**안 쓴 것** (`fbx_src/_unused/`): `Zombie Kicking`·`Zombie Stand Up` 은 이미 있는
`kicking`·`standing_up` 과 겹친다. `Walking` 은 좀비 보행이 아니라 일반 보행이라 안 맞는다.
(`standing_up` 은 CLIP_VARIANTS 주석대로 **어떤 상태에도 넣으면 안 된다** — 루트 이동이
지워져서 공중에 뜬 채로 일어난다)

### 6-3-C. 사람 모션 → 무기 스윙 궤적

1인칭이라 뷰모델은 **무기 하나뿐**이다(팔도 몸도 없다). 그래서 사람 전신 애니메이션을
그대로 재생할 수 없다. 대신 `tools/extract_swing.py` 가 **오른손 뼈가 머리 기준으로
어떻게 움직였는지**만 28표본으로 뽑아 `swing_curves.json` 으로 굽는다.
그 곡선으로 무기를 흔들면 사인 곡선으로 만든 절차적 스윙과 달리 **사람이 실제로 휘두를 때의
가감속**이 남는다 — 예비동작에서 뜸을 들이고 타격에서 확 빠진다.

```
blender --background --python tools/extract_swing.py -- fbx_src/person public/assets/models/swing_curves.json
```

- 진폭을 1 로 정규화해서 내보낸다 → 실제 크기는 `WEAPON_SWING`(balance.js) 계수가 정한다.
  리그 크기나 cm/m 단위 차이를 게임 쪽 숫자 하나로 흡수하려는 것이다.
- 곡선 파일이 없으면 **기존 절차적 스윙으로 조용히 떨어진다.** 게임은 그대로 돌아간다.

### 6-3-D. 변환 시 **본체 파일을 반드시 지정한다**

```
blender --background --python tools/fbx_to_glb.py -- fbx_src public/assets/models/zombie_shambler.glb idle_03.fbx
```

마지막 인자가 **몸을 가져올 파일**이다. 생략하면 "메시가 든 첫 파일"을 자동으로 고르는데,
`fbx_src` 안에는 스킨이 든 파일이 여러 개라 **엉뚱한 캐릭터가 본체가 된다.**

| 파일 | 들어 있는 몸 |
|---|---|
| **`idle_03.fbx`** (16MB) | **`ZombieGirl_Body` ← 이게 진짜 좀비다. 항상 이걸 본체로 준다** |
| `idle_01.fbx` (2MB) | `Beta_Joints` — Mixamo 기본 마네킹. 본체로 쓰면 좀비가 마네킹이 된다 |

> 2026-08-05 에 `idle_01.fbx` 를 본체로 줬다가 **좀비가 통째로 회색 마네킹으로 바뀌었다.**
> 클립 수와 파일 크기는 정상이라 눈으로 열기 전까지 티가 안 났다.
> 어느 파일에 어떤 몸이 들었는지는 Blender 없이도 확인된다:
> `grep -a -o -m1 "ZombieGirl[A-Za-z_]*" fbx_src/*.fbx`

### 6-3-E. 본체 GLB 는 **네 개**다 (2026-08-07)

| 출력 | 본체 FBX | 무엇 |
|---|---|---|
| `zombie_shambler.glb` (4.45MB) | `idle_03.fbx` | 기본 메시(ZombieGirl). 수술복·원본 텍스처 변형 |
| `zombie_nurse.glb` (4.27MB) | `nurse_idle.fbx` | **전신 방호복 의료진.** 무리의 80% |
| `zombie_surgeon.glb` (0.69MB) | `idle_05.fbx` | **수술복 외과의.** 클립은 nurse 것을 빌려 쓴다 |
| `zombie_cop.glb` (0.92MB) | `cop_body.fbx` (Sketchfab) | **경찰.** 클립은 nurse 것을 빌려 쓴다 |

전부 **같은 클립 이름**을 갖도록 같은 애니메이션 FBX 로 굽는다. `ZombieModel` 이
개체마다 본체를 골라 쓰는데, 클립 이름이 어긋나면 한쪽만 동작이 붙는다.

**어느 FBX 에 어떤 몸이 들었는지는 Blender 없이 확인된다.** FBX 는 바이너리지만
오브젝트·재질 이름은 평문으로 박혀 있다:

```
grep -a -o -m1 "ZombieGirl[A-Za-z_]*" fbx_src/*.fbx
grep -a -o    "Ch[0-9][0-9]_[A-Za-z]*" fbx_src/idle_05.fbx | sort -u
```

`idle_04.fbx`(60MB) 는 방호복과 **같은 캐릭터**이고 `idle_05.fbx`(52MB) 안에
`Ch16_Body`(외과의)가 들어 있었다 — 새 모델을 받기 전에 **이미 받아 둔 것부터 열어 봐라.**

### 6-3-E-2. 클립은 한 벌만 싣는다

본체를 늘릴 때마다 같은 24클립이 통째로 한 벌씩 더 실린다(본체당 **약 3.1MB**).
Mixamo 리그는 뼈 이름이 같으므로 three.js 가 **노드 이름**으로 붙여 준다.
그래서 두 번째 이후 본체는 애니메이션을 빼고 굽고 첫 본체 것을 빌려 쓴다.

```
python tools/glb_strip_animations.py public/assets/models/zombie_surgeon.glb
```

`ZombieModel.MODEL_FILES` 에 `clipsFrom: 'nurse'` 로 표시한다.

> **빌려 쓰기 전에 뼈 이름 집합을 비교해라.** 방호복과 외과의는 뼈 65개가 완전히
> 일치한다. **기본 메시만 혼자 다르다** — 눈뼈 2개가 더 있고 손가락 뼈 4개가 없다.
> 어긋난 채로 빌려 쓰면 three.js 가 `no target node found` 를 **console.warn** 으로
> 뱉고 QA 가 실패한다. 비교는 `skins[].joints` 의 이름 집합으로 한다.

방호복은 애니메이션만 추린 폴더로 굽는다 — `idle_03/04/05` 는 With Skin(§6-2 위반)이라
합계 127MB 이고, 애니메이션만 필요한데 4096² 텍스처까지 끌고 들어온다. 빼면 idle 변형이
5종 → 2종으로 줄 뿐이다(`ZombieModel.pick()` 이 **있는 클립만** 고르므로 부분 집합이어도 안전).

```
blender --background --python tools/fbx_to_glb.py -- <애니만_추린_폴더> public/assets/models/zombie_nurse.glb nurse_idle.fbx
```

**"애니만 추린 폴더" 를 다시 만드는 법** — `fbx_src` 를 통째로 복사하되 `idle_03/04/05` 만 뺀다
(`nurse_idle.fbx` 는 본체라 반드시 넣는다). 하위 폴더(`person` · `_unused` · `_cop`)는
글롭에 안 걸리므로 신경 안 써도 된다.

```powershell
$dst = "$env:TEMP\nurse_src"; New-Item -ItemType Directory -Force $dst
$skip = @('idle_03.fbx','idle_04.fbx','idle_05.fbx')
Get-ChildItem fbx_src -Filter *.fbx -File | Where-Object { $skip -notcontains $_.Name } |
  ForEach-Object { Copy-Item $_.FullName $dst }
```

**경찰 본체 재굽기** (원본은 `fbx_src/_cop/`. 텍스처는 FBX 옆과 `textures/` 양쪽에 둬야
Blender FBX 임포터가 찾는다):

```
blender --background --python tools/fbx_to_glb.py -- fbx_src/_cop public/assets/models/zombie_cop.glb cop_body.fbx
python tools/glb_strip_animations.py public/assets/models/zombie_cop.glb
```

> **삼각형 상한(6000)에 걸리는 모델은 예전 스크립트로 굽지 마라.** 데시메이트를
> 모디파이어로 남겨 두면 익스포터가 애니메이션 프레임마다 5만 삼각형을 다시 깎아서
> **66분을 넘겨도 안 끝난다.** 지금은 익스포트 직전에 확정 적용하므로 1분 30초다.

### 6-3-F. 변환 뒤 **텍스처가 실제로 줄었는지 총계를 본다**

로그 끝에 `텍스처: 총 N장 중 M장 축소` 가 찍힌다. **N 과 M 이 다르면 그만큼
원본 해상도 그대로 나간 것이다.** 실제로 방호복 첫 변환에서 9장 중 3장만 줄어
4096 노멀맵·광택맵이 GLB 에 그대로 실렸고, 파일이 3MB 더 컸다.
(원인은 `img.has_data` — 팩된 이미지는 한 번 건드리기 전까지 False 다)

이미 나온 GLB 를 다시 굽지 않고 줄이려면:

```
python tools/glb_shrink_textures.py --max 512 --quality 80 "public/assets/models/props/*.glb"
```

지오메트리·노드·애니메이션은 한 바이트도 안 건드리고 **이미지 바이트만** 갈아끼운다.
소품은 손전등 원뿔 안에서만 보이므로 **512 로 줄여도 눈에 안 띈다** — 옛 텍스처와
2배 확대해 나란히 비교해 확인했다(녹·긁힘·노멀 디테일 모두 유지).

### 6-4. 보관 위치

```
fbx_src/                              ← 원본 FBX (gitignore 됨. 무거워서 저장소에 안 올린다)
public/assets/models/zombie_shambler.glb   ← 변환 결과물 (이것만 커밋된다)
public/assets/models/zombie_nurse.glb      ← 방호복 본체 (〃)
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
> **라이선스 확인 완료 (2026-08-04, 개발자가 각 모델 페이지에서 확인)** —
> 아래 19개 모델은 **전부 CC Attribution (CC BY 4.0)** 이다.
> 제작자 표기가 의무이므로 **이 표가 곧 제출용 크레딧**이다. 게임 내 크레딧 화면에도 같은 내용을 넣는다.
> CC-BY 는 변경(스케일·텍스처 축소·오브젝트 분리)을 허용하되 변경 사실을 밝히는 것이 권장되므로,
> 아래 **"원본 대비 수정 내역"** 표를 반드시 채운다.

### 단품 소품

| 파일(예정) | 원본 모델명 | 제작자 | 출처 링크 | 라이선스 | 용도 |
|---|---|---|---|---|---|
| `prop_bed_worn.glb` | Old and worn out hospital bed | Javier Pozo | https://skfb.ly/6RSGM | CC BY 4.0 | 병상 A (낡음) |
| `prop_bed.glb` | Hospital Bed | Larry3d | https://skfb.ly/6XpTM | CC BY 4.0 | 병상 B |
| `prop_wheelchair.glb` | wheelchair (horror game hospital) | japan3d | https://skfb.ly/E8KH | CC BY 4.0 | 휠체어 |
| `prop_panel.glb` | Electrical Breaker Panel Box – LP model | Nikoleta.Zhecheva | https://skfb.ly/pzHtH | CC BY 4.0 | **배전반** — 기계실 자판기 대용 제거 |
| `prop_ivdrip.glb` | Crutch and IV Drip | Matt LeMoine | https://skfb.ly/6WSTS | CC BY 4.0 | 링거대 + 목발 |
| `prop_ivpole.glb` | IV Pole | **Mouch** | https://skfb.ly/6RzEu | CC BY 4.0 | 링거대 B |
| `prop_firstaid.glb` | First aid box | TahirNilin | https://skfb.ly/6XQTO | CC BY 4.0 | 구급상자 (수색 대상) |
| `prop_cabinet.glb` | Filing Cabinet | matthijs001 | https://skfb.ly/6CNHM | CC BY 4.0 | 서류함 |
| `prop_bodybag.glb` | Body Bag01 | AaronJC | https://skfb.ly/ozzOC | CC BY 4.0 | 시신 자루 — 영안실 |
| `prop_corpse.glb` | corpse | Daniel Yang | https://skfb.ly/6YJsD | CC BY 4.0 | 시체 — 영안실·복도 |
| `prop_vending.glb` | Vending Machine | RackRibs | https://skfb.ly/oGp7o | CC BY 4.0 | 자판기 |

### 팩 · 룸 스케일 — **소품만 추출해서 사용** (방식 b)

원본은 벽·바닥·조명이 포함된 환경 모델이다. 통째로 쓰면 절차적 레벨과 톤이 충돌하므로,
Blender 로 필요한 오브젝트만 분리해 개별 GLB 로 재출력한다.

| 원본 모델명 | 제작자 | 출처 링크 | 라이선스 | 추출할 것 |
|---|---|---|---|---|
| Morgue Room | LJM | https://skfb.ly/6RHzP | CC BY 4.0 | 시체 보관 서랍벽 · 해부대 |
| Charité University Hospital - Operating Room | ChrisRE | https://skfb.ly/oCTvA | CC BY 4.0 | 수술등 · 수술대 |
| Hospital Reception Environment | CaseyPozzobon | https://skfb.ly/oG98U | CC BY 4.0 | 접수 데스크 · 대기 의자 |
| VR ready hospital props | Grish_Avetisyan | https://skfb.ly/oEGEr | CC BY 4.0 | 팩 — 쓸 만한 소품 개별 분리 |

### 4-C. 캐릭터 · 애니메이션 (Sketchfab, 2026-08-07 추가)

> 앞의 소품과 **성격이 같다** — 개발자가 Sketchfab 에서 직접 내려받은 서드파티 모델이고,
> 제작자와의 제휴·후원 관계가 아니다. 아래 4개는 **전부 CC Attribution (CC BY 4.0)** 이며
> 개발자가 각 모델 페이지에서 확인했다. 제작자 표기가 의무이므로 이 표가 곧 제출용 크레딧이다.

| 원본 | 제작자 | 라이선스 | 게임에서 무엇이 됐나 |
|---|---|---|---|
| Zombie Walk (`zombie-walk-test`) | **OSCAR CREATIVO** | CC BY 4.0 | 걷기 클립 `walk_05` |
| Zombie Crawl (`zombie-crawl`) | **Beer Game Maker** | CC BY 4.0 | 포복 클립 `crawl_02` |
| Sexy Zombie Girl (`sexy_zombie_girl.glb`) | **doublesob** | CC BY 4.0 | 소품 `prop_standing_body.glb` — 병실 구석에 **서 있는 시신** |
| Animated Zombie Cop Running Loop | **LasquetiSpice** | CC BY 4.0 | 본체 `zombie_cop.glb` — 무리의 8% |

**원본 대비 수정 내역** (CC-BY 는 변경 사실을 밝히는 것이 권장된다)

| 원본 | 손댄 것 |
|---|---|
| Zombie Walk | 메시·텍스처는 안 쓰고 **애니메이션만** 뽑아 기존 좀비 GLB 에 클립으로 합쳤다. 루트 이동 제거(`fbx_to_glb.py`) |
| Zombie Crawl | 〃 |
| Sexy Zombie Girl | 삼각형 **150,000 → 5,000** 데시메이트 · 텍스처 512 WebP 재인코딩 · 키 1.70m 로 정규화 · 원점을 바닥 중앙으로 (`import_props.py`) |
| Animated Zombie Cop | 애니메이션은 **버렸다**(달리기 한 개뿐이라 상태머신을 못 채운다). 메시만 쓰고, 뼈 65개에 `mixamorig:` 접두어를 붙여 기존 27클립을 빌려 쓰게 했다. 삼각형 9,845 → 6,000 · 텍스처 1024 WebP |

> **경찰 모델이 살아난 이유** — 원본은 `mixamorig:` 네임스페이스만 빠졌을 뿐 **Mixamo 리그
> 그대로**였다(뼈 65개, 이름 하나도 안 틀림). three.js 는 클립을 노드 이름으로 붙이므로
> 접두어만 붙이면 그대로 맞는다. 그래서 `fbx_to_glb.py` 에 `normalize_bone_names()` 를 넣었다 —
> **버텍스 그룹도 같이 바꿔야 한다.** 안 바꾸면 스키닝이 끊겨 메시가 원점에 뭉친다.
> 검증은 `skins[].joints` 이름 집합 비교 + 콘솔에 `no target node found` 경고가 0건인지로 했다.

### 무기

| 파일(예정) | 원본 모델명 | 제작자 | 출처 링크 | 라이선스 | 용도 |
|---|---|---|---|---|---|
| `weapon_pipe.glb` | Bloody Lead Pipe | Molfgang | https://skfb.ly/oWoGT | CC BY 4.0 | **쇠파이프** (1순위) |
| — | PS1 Style Horror Pipe Weapon | Jan_Strydom | https://skfb.ly/oTpMT | CC BY 4.0 | 파이프 예비. PS1 로우파이라 PBR 과 충돌 가능 |
| `weapon_pistol.glb` | 9mm Pistol | TORI106 | https://skfb.ly/owxRE | CC BY 4.0 | 권총 |
| `weapon_crowbar.glb` | Crowbar | NINATOR | https://skfb.ly/o7OtO | CC BY 4.0 | 지렛대 — `weapons.js` 에 정의 추가 필요 |

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

모두 `tools/import_props.py` 로 변환했다. 공통 처리:
**텍스처 512px WebP 재인코딩 · 원점을 바닥 중앙으로 이동 · 삼각형 상한 초과 시 데시메이트.**
`prop_cabinet` 만 원본이 눕혀져 있어 X축 +90° 회전을 추가로 넣었다.
게임 안에서는 재질 색을 `SURFACE.propModelDim`(0.55) 로 눌러 쓴다 — 손전등이 26cd 라 안 누르면 탄다.

| 파일 | 원본 | 스케일 | 결과 크기 X×높이×Z (m) | 삼각형 | MB |
|---|---|---|---|---|---|
| `prop_bed_worn.glb` | old_and_worn_out_hospital_bed.glb | ×0.00976 | 2.05×0.722×0.976 | 526 | 0.42 |
| `prop_bed.glb` | hospital_bed.glb | 원본 크기 유지 | 0.807×1.191×1.776 | 2,500 | 0.2 |
| `prop_wheelchair.glb` | wheelchair_horror_game_hospital.glb | ×0.06049 | 0.845×0.818×1.05 | 3,222 | 0.81 |
| `prop_panel.glb` | electrical_breaker_panel_box__lp_model.glb | 원본 크기 유지 | 0.792×1.232×0.453 | 3,000 | 0.74 |
| `prop_ivdrip.glb` | crutch_and_iv_drip.glb | ×0.00474 | 0.812×1.9×0.537 | 1,800 | 0.17 |
| `prop_ivpole.glb` | iv_pole.glb | ×0.1594 | 0.666×1.9×1.941 | 1,736 | 0.28 |
| `prop_firstaid.glb` | first_aid_box.glb | ×0.01237 | 0.32×0.306×0.288 | 1,396 | 0.29 |
| `prop_cabinet.glb` | filing_cabinet.glb | ×1.19591 | 0.682×1.32×0.832 | 1,045 | 2.07 |
| `prop_bodybag.glb` | body_bag01.glb | 원본 크기 유지 | 0.879×0.333×1.993 | 1,582 | 0.09 |
| `prop_corpse.glb` | corpse.glb | ×0.01104 | 0.727×0.532×1.8 | 5,999 | 0.48 |
| `prop_vending.glb` | vending_machine.glb | ×0.79677 | 0.937×1.83×1.149 | 1,625 | 0.19 |
| `prop_morgue_lockers.glb` | morgue_room.glb | ×0.57213 | 3.27×2.2×2.388 | 1,660 | 0.18 |
| `prop_autopsy_table.glb` | morgue_room.glb | ×0.63722 | 1.978×0.95×0.731 | 1,734 | 0.26 |
| `prop_surgical_lamp.glb` | morgue_room.glb | ×0.50839 | 1.2×0.512×0.618 | 1,520 | 0.38 |
| `prop_trolley.glb` | morgue_room.glb | ×0.85479 | 0.583×0.95×0.606 | 888 | 0.17 |
| `prop_sink.glb` | morgue_room.glb | ×0.82414 | 0.557×0.9×0.681 | 618 | 0.14 |
| `prop_ventilator.glb` | vr_ready_hospital_props.glb | 원본 크기 유지 | 0.63×1.392×0.63 | 4,000 | 0.35 |
| `prop_curtain.glb` | vr_ready_hospital_props.glb | 원본 크기 유지 | 1.329×2.143×0.429 | 1,284 | 0.16 |
| `prop_bench.glb` | vr_ready_hospital_props.glb | 원본 크기 유지 | 2.026×0.873×0.604 | 1,176 | 0.17 |
| `prop_computer_cart.glb` | vr_ready_hospital_props.glb | 원본 크기 유지 | 0.574×1.492×0.793 | 811 | 0.08 |
| `prop_mop_bucket.glb` | vr_ready_hospital_props.glb | 원본 크기 유지 | 0.792×1.458×0.483 | 464 | 0.13 |
| `prop_water_cooler.glb` | vr_ready_hospital_props.glb | 원본 크기 유지 | 0.34×1.624×0.38 | 486 | 0.13 |
| `prop_extinguisher.glb` | vr_ready_hospital_props.glb | 원본 크기 유지 | 0.55×0.65×0.305 | 106 | 0.1 |
| `prop_reception_desk.glb` | vr_ready_hospital_props.glb | 원본 크기 유지 | 2.985×1.417×0.949 | 402 | 0.11 |
| `weapon_pipe.glb` | bloody_lead_pipe.glb | ×0.01068 | 0.066×0.62×0.03 | 1,220 | 0.24 |
| `weapon_pistol.glb` | 9mm_pistol.glb | ×0.0833 | 0.2×0.132×0.028 | 4,707 | 0.69 |
| `weapon_crowbar.glb` | crowbar.glb | ×0.15793 | 0.042×0.76×0.169 | 732 | 0.07 |

**버린 것**: `hospital_reception_environment.glb`(13.5MB) — 의자가 3개씩 한 메시로 뭉쳐 있고
데스크에 바닥(11.95×8.93m)까지 딸려 온다. VR 팩의 `reseptionDesk` 가 더 낫다.
`charite_university_hospital_-_operating_room.glb`(12.5MB) — 방 전체가 `OP_Mitte` 한 덩어리라
(삼각형 334,808 중 대부분) 노드 이름으로 수술등·수술대만 뽑아낼 수 없다. 3F 수술실은
영안실 팩의 해부대·무영등으로 대체했다.

**원본 보관 위치**: `tools/source_models/` (98MB). `public/` 밖이라 빌드에 실리지 않는다.
재변환하려면 `blender --background --python tools/import_props.py -- [이름]`.

---

## 5. 라이선스 기록 (제출물 심사 대응 — 반드시 채운다)

| 에셋 | 생성/출처 | 플랜 | 상업 이용 | 비고 |
|---|---|---|---|---|
| wall_plaster_peeling_{color,normal,rough}.webp | ambientCG (PaintedPlaster015) | CC0 | 가능 | 색 1024 · 노멀/러프 512 WebP, AO를 color에 55% 합성 (`tools/gen_surfaces.py`) |
| floor_tile_hospital_{color,normal,rough}.webp | ambientCG (Tiles040) | CC0 | 가능 | 색 1024 · 노멀/러프 512 WebP, AO를 color에 55% 합성 (`tools/gen_surfaces.py`) |
| ceiling_panel_office_{color,normal,rough}.webp | ambientCG (OfficeCeiling001) | CC0 | 가능 | 색 1024 · 노멀/러프 512 WebP, AO를 color에 55% 합성 (`tools/gen_surfaces.py`) |
| decal_blood_{pool,splatter,drag}.webp | 절차적 생성 (numpy/PIL 스크립트) | 자체 제작 | 가능 | fBm 노이즈 기반. 저작권 이슈 없음 |
| sfx_footstep_concrete_01~04.mp3 | **ElevenLabs** Sound Effects | Free | 확인 필요 | 발소리 4종 |
| sfx_zombie_{idle_groan_01,alert,attack,death}.mp3 | **ElevenLabs** Sound Effects | Free | 확인 필요 | |
| sfx_{pistol_fire,flashlight_click,axe_swing,axe_hit_flesh,reload_pistol,player_hurt}.mp3 | **ElevenLabs** Sound Effects | Free | 확인 필요 | |
| amb_hospital_hum.mp3 | **ElevenLabs** Sound Effects | Free | 확인 필요 | 20초 루프 (API 최대 길이 22초) |
| zombie_shambler.glb | **Mixamo** (Adobe) | Free | 확인 필요 | 여성 좀비 캐릭터 + 애니메이션 **30클립**. 6k tri / 1024 WebP |
| zombie_nurse.glb / zombie_surgeon.glb | **Mixamo** (Adobe) | Free | 확인 필요 | 방호복·수술복 본체. surgeon 은 클립을 nurse 에서 빌린다 |
| walk_05 · crawl_02 (클립) | **Sketchfab** — OSCAR CREATIVO / Beer Game Maker | CC BY 4.0 | 가능 (표기 의무) | 걷기·포복 변형. 메시는 안 쓰고 애니메이션만 (§4-C) |
| zombie_cop.glb | **Sketchfab** — LasquetiSpice | CC BY 4.0 | 가능 (표기 의무) | 경찰 본체. 클립은 nurse 것을 빌린다 (§4-C) |
| props/prop_standing_body.glb | **Sketchfab** — doublesob | CC BY 4.0 | 가능 (표기 의무) | 병실 구석에 서 있는 시신. 150k → 5k tri (§4-C) |
| models/swing_curves.json | **Mixamo** (Adobe) 모션에서 추출 · 2026-08-05 | Free | 확인 필요 | 사람 근접공격 3종(Backhand / Downward / Shooting)에서 **오른손 궤적만** 뽑아 구운 곡선. 5.7KB. 메시·스켈레톤은 안 들어간다 — 손 위치·회전을 28표본으로 정규화한 숫자만 있다 (`tools/extract_swing.py`) |
| weapon_axe.glb | **Kenney** Survival Kit | CC0 | 가능 | 나머지 무기는 절차적 생성 (SF 광선총은 세계관에 안 맞아 제외). 원본이 참조하던 아틀라스 `Textures/colormap.png` 는 킷에 딸린 공용 팔레트라 저장소에 없다 — 매 로드마다 404 가 나서 **GLB 안의 텍스처 참조를 제거**했다. 색은 원래도 안 붙었고 `WEAPON_VIEW.colorMul`(0.12)이 그 민무늬 상태 기준이라 화면은 그대로다 |
| ~~weapon_molotov.glb~~ | **Kenney** Survival Kit | CC0 | — | **미사용.** 화염병은 컷했다(불꽃·화상 미구현). 파일은 남겨 뒀지만 게임이 읽지 않는다 |
| prop_{enamel,metal,fabric}_*.webp | ambientCG (PaintedMetal013 / Metal038 / Fabric045) | CC0 | 가능 | 소품 PBR |
| ui/title_keyart.webp | **Higgsfield** (nano_banana_2) 생성 · 2026-08-05 | 유료 크레딧 | 가능 | 타이틀 배경 키아트. 1376×768 WebP q84, 59KB. 프롬프트에 `no real-world logos, no brand names, fictional signage only` 포함, 인물·글자 없음 (CLAUDE.md §2) |

> **키아트는 원본 그대로 쓰지 않는다 — `index.html` 의 `#title .art` 에서 CSS 로 가공한다.**
> 생성 원본은 맑은 실사 사진이라 그대로 깔면 "포스터"가 아니라 **"다른 게임의 스크린샷"**으로
> 읽힌다(본편은 거의 검은 화면에 각진 지오메트리라 체급이 다르다). 그래서
> 채도를 걷어 녹·빨만 남기고, 대비를 올려 검정을 게임만큼 떨어뜨리고, 0.4px 흐림으로
> 사진 특유의 미세 질감을 죽인 뒤 인쇄 그레인 두 겹을 얹는다.
> **파일은 원본 그대로 두고 가공은 전부 CSS 에 있다** — 값만 고쳐서 다시 맞출 수 있어야 하기 때문.

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
> AI 는 **포스터·간판·경고문·타이틀 키아트**(창작이 필요하고 타일링이 불필요)와
> **SFX·트레일러**에 쓴다. 키아트는 게임 화면과 톤이 어긋나면 안 되므로 §3 의 톤 고정 문구
> (병든 institutional green, cold desaturated palette)를 그대로 넣는다.

> 제출 전 이 표가 비어 있으면 안 된다. "AI를 어떻게 썼는가"가 심사 항목일 가능성이 높다.
