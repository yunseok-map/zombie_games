<#
  QUARANTINE No.3 — 새 PC 환경 세팅 (Windows / PowerShell)

      git clone <저장소> ; cd games_zombie ; .\setup.ps1

  하는 일
    1. Node.js·npm 확인 → npm install (게임을 돌리는 데 필요한 전부)
    2. 파이썬 확인 → tools/requirements.txt 설치 (에셋 생성기용. 게임에는 불필요)
    3. Blender 4.5 를 찾아서 경로를 알려 준다 (모델·애니메이션 변환용. 게임에는 불필요)
    4. .env.local 틀을 만든다 (ElevenLabs 키. 사운드를 새로 뽑을 때만 필요)
    5. git 으로 안 따라오는 원본 폴더가 무엇인지, 없으면 무엇을 못 하는지 알려 준다

  핵심: **게임을 실행하고 개발을 이어가는 데는 1번만 있으면 된다.**
  2~5 는 에셋을 새로 굽거나 모델을 다시 변환할 때만 쓴다.
#>

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$ok = @(); $warn = @(); $fail = @()
function Say($s) { Write-Host $s }
function Head($s) { Write-Host ""; Write-Host "== $s ==" -ForegroundColor Cyan }

Say ""
Say "QUARANTINE No.3 — 환경 세팅"
Say "경로: $root"

# ─────────────────────────────────────────────────────────────
Head "1. Node.js (필수 — 게임 실행)"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    $fail += "Node.js 가 없다. https://nodejs.org 에서 LTS 를 설치하고 이 스크립트를 다시 돌려라."
    Say "  [X] node 를 못 찾았다"
} else {
    $nv = (& node --version)
    Say "  [O] node $nv"
    $major = [int](($nv -replace '^v','') -split '\.')[0]
    if ($major -lt 18) { $warn += "node $nv 는 낮다. Vite 5 는 18 이상을 권장한다." }

    Say "  npm install ..."
    # npm 은 .cmd 셈이라 PowerShell 의 호출 연산자로 부르면 인자가 깨진다
    # ("Unknown command: pm"). cmd 로 감싸는 것이 확실하다.
    cmd /c "npm install --no-fund --no-audit" 2>&1 | ForEach-Object { "    $_" }
    if ($LASTEXITCODE -eq 0 -and (Test-Path "$root\node_modules\three")) {
        $ok += "npm 패키지 설치 완료 (three, vite)"
        Say "  [O] node_modules 준비됨"
    } else {
        $fail += "npm install 이 실패했다. 위 로그를 보라."
        Say "  [X] npm install 실패"
    }
}

# ─────────────────────────────────────────────────────────────
Head "2. 파이썬 (선택 — 에셋 생성기)"
$py = $null
foreach ($c in @('python','py','python3')) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd) { $py = $c; break }
}
if (-not $py) {
    $warn += "파이썬이 없다. 게임 실행에는 문제없다. 텍스처·데칼·표지판을 새로 구우려면 필요하다 (python.org)."
    Say "  [ ] 파이썬 없음 — 건너뜀 (게임 실행에는 불필요)"
} else {
    Say "  [O] $py $((& $py --version 2>&1))"
    Say "  pip install -r tools/requirements.txt ..."
    & $py -m pip install --quiet --disable-pip-version-check -r "tools\requirements.txt" 2>&1 |
        ForEach-Object { "    $_" }
    $probe = & $py -c "import PIL, numpy; print('ok')" 2>&1
    if ($probe -match 'ok') {
        $ok += "파이썬 패키지 설치 완료 (Pillow, numpy)"
        Say "  [O] Pillow · numpy 준비됨"
    } else {
        $warn += "파이썬 패키지 설치가 안 됐다: $probe"
        Say "  [!] 패키지 확인 실패"
    }
}

# ─────────────────────────────────────────────────────────────
Head "3. Blender 4.5 (선택 — 모델·애니메이션 변환)"
$blender = $null
$cand = @()
$cand += (Get-Command blender -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
foreach ($p in @("$env:ProgramFiles\Blender Foundation", "${env:ProgramFiles(x86)}\Blender Foundation",
                 "$env:LOCALAPPDATA\Programs\Blender Foundation")) {
    if (Test-Path $p) {
        $cand += (Get-ChildItem $p -Directory -ErrorAction SilentlyContinue |
                  ForEach-Object { Join-Path $_.FullName 'blender.exe' })
    }
}
foreach ($c in $cand) { if ($c -and (Test-Path $c)) { $blender = $c; break } }

if ($blender) {
    $bv = (& $blender --version 2>&1 | Select-Object -First 1)
    Say "  [O] $bv"
    Say "      $blender"
    $ok += "Blender 발견: $blender"
    Set-Content -Path "$root\.blender-path" -Value $blender -Encoding utf8
    Say "      경로를 .blender-path 에 적어 뒀다 (gitignore 됨)"
} else {
    $warn += "Blender 가 없다. 게임 실행에는 문제없다. FBX→GLB 변환·소품 반입을 하려면 4.5 LTS 가 필요하다 (blender.org)."
    Say "  [ ] Blender 없음 — 건너뜀 (게임 실행에는 불필요)"
}

# ─────────────────────────────────────────────────────────────
Head "4. .env.local (선택 — ElevenLabs 사운드 생성)"
if (Test-Path "$root\.env.local") {
    Say "  [O] 이미 있다"
} else {
    Set-Content -Path "$root\.env.local" -Encoding utf8 -Value @'
# ElevenLabs API 키. tools/gen_sfx.py 가 사운드를 새로 뽑을 때만 쓴다.
# 이미 만들어진 사운드 34종은 저장소에 들어 있으므로, 게임을 돌리는 데는 필요 없다.
# 이 파일은 .gitignore 에 있어서 저장소에 안 올라간다.
ELEVENLABS_API_KEY=
'@
    Say "  [O] 틀을 만들었다 — 사운드를 새로 뽑을 때만 키를 채우면 된다"
}

# ─────────────────────────────────────────────────────────────
Head "5. git 으로 안 따라오는 원본 폴더"
$sources = @(
    @{ path = 'fbx_src';               size = '약 150MB'; what = 'Mixamo 좀비 FBX 원본 27개 + person 근접모션';
       lose  = '좀비 애니메이션을 다시 변환할 수 없다 (변환 결과 zombie_shambler.glb 는 저장소에 있으므로 게임은 정상)' },
    @{ path = 'tools\source_textures'; size = '약 47MB';  what = 'ambientCG PBR 원본 zip (CC0)';
       lose  = '벽·바닥 텍스처를 다른 해상도로 다시 구울 수 없다 (구워진 webp 는 저장소에 있다)' }
)
foreach ($s in $sources) {
    if (Test-Path (Join-Path $root $s.path)) {
        Say "  [O] $($s.path) 있음"
    } else {
        Say "  [ ] $($s.path) 없음 ($($s.size)) — $($s.what)"
        Say "      없으면: $($s.lose)"
        $warn += "$($s.path) 없음 — $($s.lose)"
    }
}
Say "  참고: tools\source_models (Sketchfab GLB 원본 19개)는 저장소에 포함돼 있어 그대로 따라온다."

# ─────────────────────────────────────────────────────────────
Head "결과"
foreach ($m in $ok)   { Write-Host "  OK   $m" -ForegroundColor Green }
foreach ($m in $warn) { Write-Host "  주의 $m" -ForegroundColor Yellow }
foreach ($m in $fail) { Write-Host "  실패 $m" -ForegroundColor Red }

Say ""
if ($fail.Count -eq 0) {
    Write-Host "게임을 돌릴 준비가 됐다:" -ForegroundColor Green
    Say "    npm run dev        → http://localhost:5180"
    Say ""
    Say "다음으로 읽을 것: CLAUDE.md (규칙) → PROGRESS.md (현재 상태) → TODO_MORNING.md (제출물)"
} else {
    Write-Host "위 '실패' 항목을 해결한 뒤 다시 돌려라." -ForegroundColor Red
    exit 1
}
