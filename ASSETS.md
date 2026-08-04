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
| SFX | **OGG** 모노 44.1kHz | ≤ 3초 | `public/assets/audio/sfx/` |
| 앰비언스 | **OGG** 스테레오 | 30~90초 루프 | `public/assets/audio/ambience/` |
| UI 아이콘 | SVG 또는 PNG 256px | — | `public/assets/ui/` |

### 파일명 규칙 — 소문자 + 언더스코어만
```
wall_tile_concrete.webp      floor_linoleum_dirty.webp
prop_wheelchair.glb          weapon_axe.glb
zombie_shambler.glb          sfx_pistol_fire.ogg
amb_hospital_hum.ogg
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

## 5. 라이선스 기록 (제출물 심사 대응 — 반드시 채운다)

| 에셋 | 생성/출처 | 플랜 | 상업 이용 | 비고 |
|---|---|---|---|---|
| wall_plaster_peeling_{color,normal,rough}.webp | ambientCG (PaintedPlaster015) | CC0 | 가능 | 512px WebP 로 리사이즈, AO를 color에 55% 합성 |
| floor_tile_hospital_{color,normal,rough}.webp | ambientCG (Tiles040) | CC0 | 가능 | 동일 |
| ceiling_panel_office_{color,normal,rough}.webp | ambientCG (OfficeCeiling001) | CC0 | 가능 | 동일 |

> **왜 텍스처는 AI가 아닌가** — 이미지 생성 모델은 albedo 한 장만 내놓는다.
> 실사감을 만드는 normal/roughness 맵이 없고 seamless 도 보장되지 않는다.
> AI 는 **포스터·간판·경고문**(창작이 필요하고 타일링이 불필요)과 **SFX·트레일러**에 쓴다.

> 제출 전 이 표가 비어 있으면 안 된다. "AI를 어떻게 썼는가"가 심사 항목일 가능성이 높다.
