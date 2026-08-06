# 새 노트북 이관 체크리스트

> 위에서부터 순서대로. 각 줄을 직접 `[x]` 로 바꿔 가며 하면 된다.
> **1~3번만 하면 게임이 돌아간다.** 4번부터는 에셋을 새로 만들 때만 필요하다.

---

## 0. 옮기기 전 — 지금 이 노트북에서 (5분)

- [ ] 작업한 것이 전부 커밋·푸시됐는지 확인
      ```powershell
      cd C:\Users\A\Desktop\games_zombie
      git status          # "nothing to commit" 이어야 한다
      git push origin master
      ```
- [ ] **`fbx_src` 를 옮길 준비** — git 으로 안 따라온다 (아래 §5 참고)
      바탕화면에 이미 두 개를 만들어 뒀다:
      - `fbx_src_core.zip` (**20MB — 이걸 권장**)
      - `fbx_src_backup.zip` (131MB — 전체)
- [ ] `.env.local` 의 ElevenLabs 키를 따로 적어 둔다 (git 에 안 올라간다)
      사운드를 새로 뽑을 일이 없으면 건너뛰어도 된다

---

## 1. 새 노트북에 프로그램 설치

### 필수 — 이거 없으면 아무것도 안 된다

- [ ] **Node.js LTS (18 이상)** → https://nodejs.org
      설치 후 확인: `node --version`
      *왜: 개발 서버(vite)와 게임 빌드가 전부 여기서 돈다*
- [ ] **Git** → https://git-scm.com
      설치 후 확인: `git --version`
      *왜: 저장소를 받고, 제출 요건인 커밋 기록을 유지한다*

### 선택 — 에셋을 새로 만들 때만

- [ ] **Python 3.9+** → https://python.org (설치 시 **"Add to PATH" 체크**)
      *왜: 텍스처·핏자국·표지판 생성기(`tools/gen_*.py`)*
      *안 깔면: 이미 구워진 이미지를 그대로 쓴다. 게임은 정상*
- [ ] **Blender 4.5 LTS** → https://blender.org/download/lts
      *왜: FBX→GLB 변환, Sketchfab 소품 반입, 무기 스윙 궤적 추출*
      *안 깔면: 변환 결과 GLB 가 저장소에 있어 게임은 정상. 애니메이션 추가만 못 한다*
      **4.5 여야 한다** — 다른 버전은 스크립트가 쓰는 API 가 달라질 수 있다

> 코드 편집기(VS Code 등)는 취향이다. 없어도 위 절차는 전부 된다.

---

## 2. 저장소 받기

- [ ] 원하는 위치에서
      ```powershell
      git clone https://github.com/yunseok-map/zombie_games.git
      cd zombie_games
      ```
      *약 120MB 라 조금 걸린다 (Sketchfab 원본 모델 19개가 들어 있다)*
- [ ] 최신인지 확인: `git log --oneline -1` 이 이 노트북의 마지막 커밋과 같은지

---

## 3. 환경 세팅 — 스크립트 한 번

- [ ] ```powershell
      .\setup.ps1
      ```
      *Node·Python·Blender 를 찾아서 필요한 패키지를 설치하고, 없는 것이 무엇이며
      그게 없으면 무엇을 못 하는지 알려 준다*
- [ ] 마지막에 **"게임을 돌릴 준비가 됐다"** 가 뜨는지 확인
      (빨간 "실패" 가 있으면 그 항목부터 해결한다)
- [ ] 실행
      ```powershell
      npm run dev
      ```
      브라우저에서 `http://localhost:5180` → **진입** → `F` 로 손전등

> PowerShell 이 스크립트 실행을 막으면:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` 를 먼저 한 번 실행한다.

---

## 4. 제대로 붙었는지 확인 (2분)

브라우저에서 게임을 켠 상태로 `F12` → 콘솔에 붙여넣는다.

- [ ] **구역 배치 검사** — `125/125` 여야 한다
      ```js
      const { runQA, summarize } = await import('/tools/qa_stages.js');
      console.log(summarize(runQA(window.game)));
      ```
- [ ] **좀비 모션 검사** — `문제프레임: 0` 이어야 한다
      ```js
      const { runMotionQA, summarize: m } = await import('/tools/qa_motion.js');
      console.log(m(await runMotionQA(window.game)));
      ```
- [ ] 좀비가 **회색 마네킹이 아닌지** 눈으로 확인
      (한 번 이런 사고가 있었다 — `ASSETS.md §6-3-D`)
- [ ] 이 노트북에서 아직 못 한 것: **프레임 측정**
      ```js
      const { benchAll } = await import('/tools/bench.js');
      console.table(await benchAll(window.game));
      ```
      *지금까지는 탭이 백그라운드라 못 쟀다. 새 노트북에서 창을 앞에 두고 돌려라*

---

## 5. `fbx_src` 옮기기 — 필요할 때만

`fbx_src/` 는 Mixamo 원본 FBX 다. **git 으로 안 따라온다** (150MB, `.gitignore`).

**없어도 게임과 개발에는 전혀 지장이 없다.** 변환 결과인 `zombie_shambler.glb`(27클립)와
`swing_curves.json` 은 저장소에 들어 있다. 좀비 애니메이션을 **다시 변환할 때만** 필요하다.

- [ ] 옮길지 정한다

| 방법 | 크기 | 언제 |
|---|---|---|
| **`fbx_src_core.zip`** | **20MB** | **권장.** `idle_04`·`idle_05` 만 뺐다 |
| `fbx_src_backup.zip` | 131MB | 두 클립까지 완벽히 보존하고 싶을 때 |
| 안 옮긴다 | 0 | 애니메이션을 더 안 건드릴 거면 이게 맞다 |

> **왜 두 파일만 빼면 148MB → 20MB 인가**
> `idle_04`(61MB)·`idle_05`(52MB)가 실수로 **With Skin** 으로 받아져 몸이 통째로 들어 있다.
> 나머지 32개는 다 합쳐 20MB 다. 이 둘을 빼면 **변환 시간도 20분대에서 크게 준다.**
> 대가는 idle 변형이 5개 → 3개로 주는 것뿐이고, 지금 GLB 에는 5개가 다 들어 있다.

- [ ] 옮기는 수단 (편한 순서)
      1. **USB** — 계정도 업로드도 필요 없다. 20MB 면 순식간
      2. **OneDrive / Google Drive** — 이미 OneDrive 를 쓰고 있으면 폴더에 넣고 새 PC 에서 동기화
      3. GitHub Release 첨부 — 저장소 주소 하나로 따라다닌다. 다만 웹에서 업로드해야 한다
         (저장소 → Releases → Draft a new release → 파일 첨부. 저장소 용량에 안 잡힌다)
- [ ] 새 노트북에서 **저장소 루트에 `fbx_src` 라는 이름으로** 풀어 넣는다
      ```
      zombie_games\fbx_src\attack_01.fbx ...
      zombie_games\fbx_src\person\Standing Melee Attack Downward.fbx ...
      ```

---

## 5-B. 「폴더 통째로 구글 드라이브」로 옮겨도 되나

**된다. 다만 `node_modules` 는 반드시 빼고 옮겨라.**

```powershell
# 지금 노트북에서
cd C:\Users\A\Desktop\games_zombie
Remove-Item node_modules -Recurse -Force      # 새 PC 에서 npm install 로 복구된다
Compress-Archive -Path . -DestinationPath C:\Users\A\Desktop\games_zombie_full.zip
```

- [ ] `node_modules` 를 지웠는지 확인하고 압축했다

> **왜 `node_modules` 를 빼야 하나**
> 안에 **윈도우 x64 전용 바이너리**가 들어 있다 (`@esbuild/win32-x64/esbuild.exe`,
> `@rollup/rollup-win32-x64-*.node`). 새 노트북이 ARM(스냅드래곤) 이거나 OS 가 다르면
> 그대로는 안 돈다. 게다가 파일이 1,282개라 구글 드라이브 동기화가 유난히 느리다.
> `npm install` 한 번이면 그 PC 에 맞는 것으로 다시 깔린다.

### 어느 쪽이 나은가

| | 용량 | 장점 | 단점 |
|---|---|---|---|
| **git clone + `fbx_src_core.zip`** | **약 140MB** | 가볍다 · 커밋 기록이 살아 있다 · 제출 요건과 같은 상태 | `.env.local` 은 따로 챙겨야 한다 |
| 폴더 통째 (node_modules 제외) | 약 445MB | `.env.local`·`fbx_src` 까지 한 번에 간다 | 3배 무겁다 · 드라이브 업/다운로드가 오래 걸린다 |

**git 쪽을 권한다.** 폴더 통째는 인터넷이 느리거나 git 이 번거로울 때 쓰면 된다.
어느 쪽이든 새 노트북에서 `npm install`(= `setup.ps1`)은 똑같이 한 번 돌려야 한다.

- [ ] 어느 쪽으로 갈지 정했다

---

## 5-C. Claude Code 설정 — 무엇이 자동이고 무엇이 수동인가

### 자동으로 따라온다 (로그인만 하면 됨)
- [ ] 새 노트북에서 Claude Code 설치 후 **같은 계정으로 로그인**
      → Higgsfield · Gmail · Google Drive · Calendar 커넥터는 **계정에 붙어 있어** 그대로 쓸 수 있다

### 수동으로 옮겨야 한다
로컬 설정은 계정이 아니라 **이 PC 에** 들어 있다. 아래를 통째로 복사한다
(zip 으로 **약 10MB** — 실제로 묶어서 확인한 값이다).

- [ ] 지금 노트북에서 묶기
      ```powershell
      $src = "$env:USERPROFILE\.claude"
      $dst = "$env:USERPROFILE\Desktop\claude_config"
      New-Item -ItemType Directory -Force $dst | Out-Null
      Copy-Item "$src\skills"              $dst -Recurse -Force   # 스킬 9개 (impeccable 등)
      Copy-Item "$src\plugins"             $dst -Recurse -Force   # lean 플러그인
      Copy-Item "$src\settings.json"       $dst -Force            # 모델·상태줄·플러그인 활성화
      Copy-Item "$src\settings.local.json" $dst -Force            # 권한 + 훅(디자인 검사기)
      Copy-Item "$src\projects\C--Users-A\memory" "$dst\memory" -Recurse -Force  # 프로젝트 기억
      Compress-Archive -Path "$dst\*" -DestinationPath "$env:USERPROFILE\Desktop\claude_config.zip" -Force
      ```
- [ ] 새 노트북에서 풀기 — `skills` · `plugins` · `settings*.json` 은 `%USERPROFILE%\.claude\` 아래로
- [ ] **`memory` 폴더 이름을 새 PC 경로에 맞춰 바꾼다**
      `~/.claude/projects/C--Users-<사용자명>/memory/`
      *폴더 이름이 작업 경로에서 나온다. 지금은 `C--Users-A` 인데 사용자명이 다르면 안 맞는다*
- [ ] **Chrome 확장 `claude-in-chrome` 은 새로 설치해야 한다**
      새 노트북 크롬에 확장을 깔고, `localhost` 에 대한 **사이트 권한을 허용**한다
      *안 하면 브라우저로 게임을 띄워 검사하는 작업이 안 된다*

### 옮길 필요 없는 것
`sessions` · `cache` · `shell-snapshots` · `file-history` · `debug` · `telemetry` · `tasks`
— 이 PC 의 작업 흔적이다 (`projects` 폴더가 138MB 인데 대부분 이것들이다).

### 프로젝트 안에 있는 것은 이미 git 에 들어 있다
`.impeccable/config.json` (디자인 검사기 규칙 — index.html 의 dark-glow·radial-halo 억제)은
저장소에 커밋돼 있어 clone 하면 그대로 적용된다.

---

## 6. 옮긴 뒤 지워도 되는 것 (지금 노트북)

전부 푸시하고 새 노트북에서 4번까지 통과한 것을 확인한 **다음에** 지운다.

- [ ] `node_modules\` — `npm install` 로 언제든 복구
- [ ] `dist\` — `npm run build` 로 복구
- [ ] 바탕화면의 `fbx_src_*.zip` — 옮긴 뒤

> `fbx_src\` 원본은 새 노트북에서 4번 검증이 끝날 때까지 **지우지 마라.**

---

## 막혔을 때

| 증상 | 원인 / 해결 |
|---|---|
| `setup.ps1` 실행이 막힌다 | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` 후 재실행 |
| 한글이 깨져 보인다 | 스크립트는 UTF-8 BOM 으로 저장돼 있다. 편집기에서 인코딩을 바꾸지 마라 |
| `npm install` 실패 | Node 를 18 이상으로. `npm cache clean --force` 후 재시도 |
| 게임이 검은 화면 | 손전등(`F`)을 켰는지. 그래도 검으면 F12 콘솔의 빨간 줄을 확인 |
| 좀비가 안 나온다 | 브라우저 탭이 **백그라운드면 게임 루프가 멈춘다.** 창을 앞으로 |
| Blender 변환이 20분 넘게 걸린다 | 정상이다. `idle_04`·`idle_05` 때문. 뺀 핵심본을 쓰면 훨씬 빠르다 |

---

## 다음에 읽을 것

| 파일 | 내용 |
|---|---|
| `SETUP.md` | 의존성·프로그램 상세, git 으로 오는 것/안 오는 것 |
| `CLAUDE.md` | **작업 규칙.** 수치는 balance.js 에만, 폴더 구조 고정 등 |
| `PROGRESS.md` | 지금 상태 · 다음 할 일 · **알려진 함정** |
| `TODO_MORNING.md` | **제출물 5종 체크리스트** (마감 2026-08-10) |
