# SETUP — 새 PC 에서 이어가기

```powershell
git clone <저장소 주소>
cd games_zombie
.\setup.ps1
npm run dev            # → http://localhost:5180
```

`setup.ps1` 이 필요한 것을 찾아서 설치하고, 없는 것이 무엇이며 그게 없으면 무엇을
못 하는지 알려 준다. **게임을 돌리고 개발을 이어가는 데는 Node.js 하나면 된다.**

---

## 1. 무엇이 꼭 필요한가

| | 필요한 것 | 없으면 |
|---|---|---|
| **게임 실행·개발** | **Node.js 18+ 만** | 아무것도 안 된다 |
| 텍스처·데칼·표지판 다시 굽기 | 파이썬 3 + Pillow + numpy | 이미 구워진 webp 를 그대로 쓴다 (문제 없음) |
| FBX→GLB 변환, 소품 반입 | Blender **4.5 LTS** | 변환된 GLB 가 저장소에 있어서 게임은 정상 |
| 사운드 새로 뽑기 | ElevenLabs API 키 (`.env.local`) | 만들어진 사운드 34종을 그대로 쓴다 |

게임 자체는 **의존성이 둘뿐**이다 — `three` 와 `vite`. 나머지는 전부 에셋을 *만드는* 도구다.
외부 CDN 을 안 쓰고 에셋을 전부 저장소에 넣어 두는 것이 이 프로젝트의 규칙이라
(CLAUDE.md §1-6), 받자마자 오프라인에서도 돌아간다.

---

## 2. git 으로 따라오는 것 / 안 오는 것

**따라온다** — 게임에 필요한 전부
- `src/` 게임 코드 · `public/assets/` 완성된 에셋 17MB (텍스처·사운드·모델·GLB)
- `tools/` 생성 스크립트 전부 + `tools/source_models/` Sketchfab GLB 원본 19개(98MB)
- 문서 전부 (`CLAUDE.md` `SPEC.md` `PROGRESS.md` `ASSETS.md` `TODO_MORNING.md`)

**안 온다** — 용량이 커서 `.gitignore` 에 있다. 없어도 게임은 정상이다.

| 폴더 | 용량 | 없으면 못 하는 것 |
|---|---|---|
| `fbx_src/` | 약 150MB | 좀비 애니메이션 재변환. **변환 결과 GLB(27클립)는 저장소에 있다** |
| `tools/source_textures/*.zip` | 약 47MB | 벽·바닥 텍스처를 다른 해상도로 재생성. 구워진 webp 는 있다 |
| `node_modules/` | — | `npm install` 로 복구 |
| `.env.local` | — | 사운드 재생성. `setup.ps1` 이 빈 틀을 만들어 준다 |

> **새 PC 에서 좀비 애니메이션을 다시 변환할 계획이라면 `fbx_src/` 를 USB·클라우드로 따로 옮겨라.**
> git 으로는 안 간다. 그 외의 작업은 전부 저장소만으로 가능하다.

---

## 3. 이 프로젝트가 쓰는 프로그램 전체

| 프로그램 | 버전 | 쓰는 곳 |
|---|---|---|
| Node.js + npm | 18+ | 개발 서버·빌드 (`vite`) |
| Python | 3.9+ | `tools/gen_*.py` 에셋 생성기 |
| Blender | **4.5 LTS** | `fbx_to_glb.py` · `import_props.py` · `extract_swing.py` |
| Git | — | 형상 관리. 제출 요건이 **커밋 기록 유지**다 |

### npm 패키지
`three ^0.169` · `vite ^5.4` — 이게 전부다.

### 파이썬 패키지 (`tools/requirements.txt`)
`Pillow>=10` · `numpy>=1.24`
Blender 안에서 도는 스크립트는 Blender 자체 파이썬(`bpy`·`mathutils`)을 쓰므로 pip 설치가 없다.

### 폰트
`gen_signage.py` 는 한글 트루타입이 필요하다. 윈도우는 맑은 고딕(`malgun.ttf`)을 자동으로 찾고,
맥·리눅스는 AppleGothic·나눔고딕·Noto CJK 를 차례로 찾는다. 못 찾으면 기본 폰트로 떨어져
글자가 깨지므로, 표지판을 다시 구울 때만 신경 쓰면 된다.

---

## 4. 받은 뒤 확인

```powershell
npm run dev
```

브라우저에서 `http://localhost:5180` → 타이틀에서 **진입** → 손전등(F)을 켜고 복도를 걷는다.

콘솔(F12)에서 자동 검사:

```js
// 구역 배치 — 25항목 × 5구역
const { runQA, summarize } = await import('/tools/qa_stages.js');
console.log(summarize(runQA(window.game)));        // 125/125 여야 한다

// 좀비 모션 — 프레임 단위로 바닥뚫림·공중부양·배속이상을 본다
const { runMotionQA, summarize: m } = await import('/tools/qa_motion.js');
console.log(m(await runMotionQA(window.game)));    // 문제프레임 0 이어야 한다
```

둘 다 통과하면 환경이 제대로 붙은 것이다.

---

## 5. 자주 밟는 함정

- **좀비 GLB 를 다시 변환할 때는 본체 파일을 반드시 지정한다.**
  `... -- fbx_src public/assets/models/zombie_shambler.glb idle_03.fbx`
  빠뜨리면 Mixamo 기본 마네킹이 몸이 된다. 자세한 것은 `ASSETS.md §6-3-D`.
- **GitHub Pages 배포 시 `vite.config.js` 에 `base: '/저장소이름/'`** 을 넣어야 한다.
  안 넣으면 에셋 경로가 깨져서 심사자가 검은 화면을 본다.
- 저장소가 약 120MB 다 (`tools/source_models` 98MB 포함). clone 이 느릴 수 있지만
  GitHub 의 파일당 100MB 제한에는 걸리지 않는다.
