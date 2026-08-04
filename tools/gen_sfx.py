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
