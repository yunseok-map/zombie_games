"""SFX 생성기 — ElevenLabs Sound Effects API
키는 .env.local 의 ELEVENLABS_API_KEY 에서 읽는다 (저장소에 안 올라간다).

  python gen_sfx.py            이미 있는 파일은 건너뛴다 (재개 가능)
  python gen_sfx.py --force    전부 다시 생성

출력 포맷이 MP3 인 이유: ElevenLabs 는 OGG 를 내주지 않고 이 PC 에 ffmpeg 이 없다.
브라우저 Web Audio 는 MP3 를 전부 디코딩하므로 게임 동작에는 차이가 없다.
"""
import os, sys, json, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 저장소 루트 (tools/ 의 부모)
API = "https://api.elevenlabs.io/v1/sound-generation"

# 모든 프롬프트에 붙는 톤 고정 문구 (ASSETS.md §3 과 같은 역할)
TONE = "abandoned quarantine hospital, cold concrete interior, dry close-mic recording, no music"

# (경로, 프롬프트, 길이초, prompt_influence)
JOBS = [
    ("sfx/sfx_footstep_concrete_01", "single footstep on gritty concrete floor, boot sole, soft scuff", 1.0, 0.7),
    ("sfx/sfx_footstep_concrete_02", "single footstep on gritty concrete floor, boot heel, slight grit crunch", 1.0, 0.7),
    ("sfx/sfx_footstep_concrete_03", "single footstep on dusty tiled floor, boot, faint debris", 1.0, 0.7),
    ("sfx/sfx_footstep_concrete_04", "single footstep on dusty tiled floor, boot, small glass shard crackle", 1.0, 0.7),
    ("sfx/sfx_zombie_idle_groan_01", "low guttural human moan, wet breathing, distant, unsettling, not screaming", 3.0, 0.5),
    ("sfx/sfx_zombie_alert",         "sudden sharp inhale then aggressive guttural snarl, human throat", 2.0, 0.55),
    ("sfx/sfx_zombie_attack",        "violent guttural lunge grunt with cloth rustle", 1.5, 0.55),
    ("sfx/sfx_zombie_death",         "gurgling exhale collapsing to floor, body thud, wet rattle", 2.5, 0.5),
    ("sfx/sfx_pistol_fire",          "9mm pistol gunshot indoors, sharp crack with concrete corridor slap-back", 2.0, 0.65),
    ("sfx/sfx_flashlight_click",     "single sharp plastic flashlight switch click, dry, no reverb", 1.0, 0.7),
    ("sfx/sfx_axe_swing",            "heavy metal pipe swung fast through air, whoosh", 1.0, 0.7),
    ("sfx/sfx_axe_hit_flesh",        "heavy blunt impact into wet meat, dull thud, no music", 1.0, 0.6),
    ("sfx/sfx_reload_pistol",        "pistol magazine ejected, new magazine inserted, slide racked, metallic", 2.5, 0.7),
    ("sfx/sfx_player_hurt",          "adult male sharp pained grunt, short, breath knocked out", 1.0, 0.5),
    ("ambience/amb_hospital_hum",    "continuous low electrical hum, faint dripping water, distant wind through empty corridors, seamless loop", 20.0, 0.4),

    # 바닥 재질별 발소리 — 같은 소리를 계속 쓰면 즉시 싸구려로 들린다
    ("sfx/sfx_footstep_tile_01", "single footstep on hard ceramic tile floor, crisp click, slight echo", 1.0, 0.75),
    ("sfx/sfx_footstep_tile_02", "single footstep on hard ceramic tile floor, heel click, faint grit", 1.0, 0.75),
    ("sfx/sfx_footstep_tile_03", "single footstep on tiled floor with thin dust layer, soft click", 1.0, 0.75),
    ("sfx/sfx_footstep_tile_04", "single footstep on tiled floor, boot sole squeak", 1.0, 0.75),
    ("sfx/sfx_footstep_debris_01", "single footstep crunching broken glass and plaster rubble", 1.0, 0.8),
    ("sfx/sfx_footstep_debris_02", "single footstep on scattered glass shards, sharp crackle", 1.0, 0.8),
    ("sfx/sfx_footstep_debris_03", "single footstep crushing loose ceiling tile fragments and grit", 1.0, 0.8),
    ("sfx/sfx_footstep_wet_01", "single footstep in shallow sticky liquid, wet squelch", 1.0, 0.8),
    ("sfx/sfx_footstep_wet_02", "single wet footstep, sticky peel off floor", 1.0, 0.8),

    # 좀비 소리 다양화 — 한 종류만 반복되면 즉시 가짜로 들린다
    ("sfx/sfx_zombie_idle_groan_02", "low wet gurgling moan, labored breathing through damaged throat", 3.0, 0.5),
    ("sfx/sfx_zombie_idle_groan_03", "distant hollow groan, dragging shuffle, unsettling", 3.0, 0.5),
    ("sfx/sfx_zombie_scream_01", "sudden piercing inhuman shriek of a woman, rage, close", 2.0, 0.5),
    ("sfx/sfx_zombie_scream_02", "guttural roar rising into a ragged scream, human throat tearing", 2.2, 0.5),
    ("sfx/sfx_zombie_notice", "sharp startled gasp then wet snarl, sudden alertness", 1.5, 0.55),
    # 피격 — 무기별로 다르게
    ("sfx/sfx_hit_flesh_01", "bullet impact into wet flesh, sharp wet slap and spatter", 1.0, 0.7),
    ("sfx/sfx_hit_flesh_02", "bullet impact into body, dull wet thud with spray", 1.0, 0.7),
    ("sfx/sfx_hit_blunt_01", "heavy steel pipe striking a body, dull bone thud", 1.0, 0.7),
    ("sfx/sfx_hit_blunt_02", "metal pipe cracking bone, sharp snap with wet undertone", 1.0, 0.7),
    ("sfx/sfx_hit_headshot", "bullet impact to skull, sharp crack and wet burst", 1.0, 0.7),

    # ── 1인칭 플레이어 목소리 (2026-08-08) ──────────────────────────────────
    # 그전까지 플레이어가 내는 소리는 sfx_player_hurt 하나뿐이었다. 좀비는 8종을
    # 내는데 플레이어는 맞을 때 한 번 끙 하고 마는, 몸이 없는 카메라였다.
    #
    # 전부 **가까이서 마이크에 대고 낸 소리**여야 한다 — 1인칭이므로 잔향이 붙으면
    # 남의 소리로 들린다. 그래서 TONE 의 실내 잔향 대신 'very close mic, dry' 를
    # 프롬프트마다 직접 넣는다.
    ("sfx/sfx_player_effort_01", "adult male short sharp exhale of effort swinging a heavy weapon, very close mic, dry, no reverb", 1.0, 0.55),
    ("sfx/sfx_player_effort_02", "adult male low grunt of exertion, brief, through clenched teeth, very close mic, dry", 1.0, 0.55),
    ("sfx/sfx_player_effort_03", "adult male hard breathy hut sound while striking, very short, very close mic, dry", 1.0, 0.55),
    # 물렸을 때 — 게임에서 가장 무서운 순간인데 지금은 완전히 무음이다
    ("sfx/sfx_player_grabbed", "adult male sudden terrified scream, caught by surprise, panic, very close mic, dry", 1.8, 0.5),
    ("sfx/sfx_player_struggle_01", "adult male desperate struggling grunts, straining to push something off, very close mic, dry", 1.6, 0.5),
    ("sfx/sfx_player_struggle_02", "adult male panicked gasping and straining, fighting free, very close mic, dry", 1.6, 0.5),
    # 지쳤을 때 — 스태미나가 바닥나면 화면에만 표시되고 귀로는 아무것도 안 들렸다
    ("sfx/sfx_player_breath_01", "adult male heavy exhausted panting, out of breath, very close mic, dry, no reverb", 2.4, 0.45),
    ("sfx/sfx_player_breath_02", "adult male ragged winded breathing, gasping for air, very close mic, dry, no reverb", 2.4, 0.45),
    # 크게 다쳤을 때 — 절뚝이는 상태의 신음
    ("sfx/sfx_player_pain_01", "adult male suppressed pained groan, badly injured, breathing through pain, very close mic, dry", 2.0, 0.5),
    ("sfx/sfx_player_pain_02", "adult male weak strained wheeze of pain, wounded, very close mic, dry", 2.0, 0.5),
    # 기존 피격음이 한 종류뿐이라 연속으로 맞으면 같은 소리가 반복된다
    ("sfx/sfx_player_hurt_02", "adult male sharp pained grunt, hit hard, air knocked out, very close mic, dry", 1.0, 0.5),
    ("sfx/sfx_player_hurt_03", "adult male short cry of pain, sudden, very close mic, dry", 1.0, 0.5),

    # ── 투척·화염병 (2026-08-08) ────────────────────────────────────────────
    # 화염병을 되살리면서 필요해진 소리. 여기 등록만 하고 부르는 곳을 안 만들면
    # 게임에 없는 것이다 — 각각 weapons/Throwables.js 와 WeaponAttack._throw 가 부른다.
    ("sfx/sfx_throw_whoosh", "underhand throw of a small heavy object through air, short cloth and air whoosh", 1.0, 0.7),
    # 병이 깨지면서 동시에 확 붙는다. 두 소리를 한 파일에 담아야 타이밍이 안 어긋난다
    ("sfx/sfx_molotov_break", "glass bottle shatters hard on concrete then gasoline ignites with a deep whoosh of flame", 2.0, 0.6),
    ("sfx/sfx_fire_loop", "steady burning gasoline fire on concrete floor, crackling flames, seamless loop", 12.0, 0.45),
    # 라디오는 **소리를 내기 때문에** 좀비를 끈다. 지금까지 그 소리가 없었다
    ("sfx/sfx_radio_static", "old portable radio clatters on floor and switches on, loud hissing static with garbled voice", 3.0, 0.55),
]


def read_key():
    p = os.path.join(ROOT, ".env.local")
    with open(p, encoding="utf-8") as f:
        for line in f:
            if line.startswith("ELEVENLABS_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit(".env.local 에 ELEVENLABS_API_KEY 가 없다")


def generate(key, prompt, seconds, influence):
    body = json.dumps({
        "text": f"{prompt}. {TONE}",
        "duration_seconds": seconds,
        "prompt_influence": influence,
    }).encode()
    req = urllib.request.Request(API, data=body, headers={
        "xi-api-key": key, "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def main():
    force = "--force" in sys.argv
    key = read_key()
    ok = fail = skip = 0
    for rel, prompt, seconds, influence in JOBS:
        out = os.path.join(ROOT, "public", "assets", "audio", rel + ".mp3")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if os.path.exists(out) and not force:
            print(f"skip  {rel}")
            skip += 1
            continue
        for attempt in range(3):
            try:
                data = generate(key, prompt, seconds, influence)
                if not data.startswith(b"ID3") and data[:2] != b"\xff\xfb":
                    raise RuntimeError(f"MP3 가 아님: {data[:40]!r}")
                with open(out, "wb") as f:
                    f.write(data)
                print(f"OK    {rel:34s} {len(data)//1024:4d} KB")
                ok += 1
                break
            except urllib.error.HTTPError as e:
                msg = e.read()[:200].decode("utf-8", "replace")
                print(f"HTTP {e.code} {rel} (시도 {attempt+1}/3) {msg}")
                time.sleep(4)
            except Exception as e:
                print(f"ERR   {rel} (시도 {attempt+1}/3) {e}")
                time.sleep(4)
        else:
            fail += 1
        time.sleep(1.2)          # 레이트리밋 여유
    print(f"\n완료: 성공 {ok} · 건너뜀 {skip} · 실패 {fail} / 전체 {len(JOBS)}")


if __name__ == "__main__":
    main()
