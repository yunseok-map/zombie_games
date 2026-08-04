"""Mixamo FBX → 게임용 GLB 변환기 (Blender 헤드리스 전용)

사용법:
    blender --background --python fbx_to_glb.py -- fbx_src public/assets/models/zombie_shambler.glb

동작:
  1. fbx_src/ 안의 FBX 를 전부 읽는다.
     메시가 들어있는 파일(With Skin) 하나가 본체, 나머지(Without Skin)는 애니메이션만 가져온다.
  2. 파일명이 그대로 애니메이션 이름이 된다.  walk.fbx -> "walk"
     Zombie.js 가 이 이름으로 클립을 찾으므로 소문자로 맞춘다.
  3. 키(1.75m — balance.js 의 ZOMBIE.shambler.height)에 맞춰 자동으로 스케일한다.
     Mixamo 는 cm 단위로 내보내서 그냥 쓰면 100배 크게 나온다.
  4. 삼각형이 상한(6000, ASSETS.md §1)을 넘으면 데시메이트한다.
  5. GLB 하나로 내보낸다. 애니메이션은 전부 이 파일 안에 들어간다.

Blender 를 직접 열 필요는 없다. 위 명령 한 줄이면 끝난다.
"""
import bpy, sys, os, math

TARGET_HEIGHT = 1.75      # balance.js ZOMBIE.shambler.height
MAX_TRIS = 6000           # ASSETS.md §1 (좀비 리깅 모델 상한)

# Mixamo 캐릭터는 2048² PNG 를 4장씩 들고 온다. 그대로 두면 GLB 가 18MB 가 되어
# ASSETS.md §3 의 "초기 로딩 8초" 예산을 깬다.
# 이 게임은 손전등 원뿔 안에서만 보이므로 1024 로 줄여도 화면에서 차이가 없다.
MAX_TEX = 1024
TEX_QUALITY = 82          # WebP 품질. WebP 는 PNG 보다 훨씬 작고 알파도 유지한다


def shrink_textures():
    """텍스처를 MAX_TEX 이하로 줄인다. 내보내기 전에 호출한다."""
    for img in bpy.data.images:
        if not img.has_data or img.size[0] == 0:
            continue
        w, h = img.size
        if max(w, h) <= MAX_TEX:
            continue
        s = MAX_TEX / max(w, h)
        nw, nh = max(1, int(w * s)), max(1, int(h * s))
        img.scale(nw, nh)
        print(f"    텍스처 축소: {img.name} {w}x{h} -> {nw}x{nh}")

# 루트 이동(root motion)은 클립 종류와 무관하게 전부 지운다.
# 이 게임에서 좀비의 위치는 항상 Zombie.js 가 정한다(_goTo/_chase/_attack).
# 애니메이션에 들어있는 이동은 예외 없이 이중 이동이 되므로 오차일 뿐이다.
# 덕분에 Mixamo 의 "In Place" 체크박스도, 파일명 규칙도 신경 쓸 필요가 없다.


def strip_root_motion(action, armature):
    """루트(힙) 본의 위치 커브를 지운다. 회전은 남긴다 — 그게 걸음걸이다."""
    if not action or not action.fcurves:
        return 0
    # 부모 없는 본 = 루트. Mixamo 는 mixamorig:Hips
    roots = [b.name for b in armature.data.bones if b.parent is None]
    removed = 0
    for fc in list(action.fcurves):
        if not fc.data_path.endswith(".location"):
            continue
        bone = fc.data_path.split('"')[1] if '"' in fc.data_path else None
        if bone in roots:
            action.fcurves.remove(fc)
            removed += 1
    return removed


def argv_after_dashdash():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def wipe_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    """임포트 전후의 오브젝트 차집합을 돌려준다"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    return [o for o in bpy.data.objects if o not in before]


def find_armature(objs):
    for o in objs:
        if o.type == 'ARMATURE':
            return o
    return None


def tri_count(meshes):
    n = 0
    for m in meshes:
        m.data.calc_loop_triangles()
        n += len(m.data.loop_triangles)
    return n


def main():
    args = argv_after_dashdash()
    if len(args) < 2:
        raise SystemExit("사용법: ... -- <fbx폴더> <출력.glb> [본체파일.fbx]")
    src_dir, out_path = args[0], args[1]
    # 3번째 인자로 본체(캐릭터 메시)를 지정한다.
    # 안 주면 메시가 든 첫 파일이 본체가 되는데, With Skin 을 여러 개 받았으면 엉뚱한 게 잡힌다.
    forced_base = args[2] if len(args) > 2 else None

    files = sorted(f for f in os.listdir(src_dir) if f.lower().endswith(".fbx"))
    if not files:
        raise SystemExit(f"{src_dir} 에 FBX 가 없다")

    wipe_scene()

    base_arm = None
    base_meshes = []
    clips = []

    for fname in files:
        path = os.path.join(src_dir, fname)
        name = os.path.splitext(fname)[0].lower()
        new_objs = import_fbx(path)
        arm = find_armature(new_objs)
        meshes = [o for o in new_objs if o.type == 'MESH']

        if arm is None:
            print(f"  ! {fname}: 아마추어가 없다 — 건너뜀")
            continue

        # 이 파일이 들고 온 액션을 이름 붙여서 보존한다
        action = arm.animation_data.action if arm.animation_data else None
        if action:
            action.name = name
            action.use_fake_user = True     # 안 하면 오브젝트 지울 때 같이 사라진다
            n = strip_root_motion(action, arm)
            if n:
                print(f"    루트 이동 제거: {name} (커브 {n}개)")
            clips.append(name)

        is_base = (fname == forced_base) if forced_base else (base_arm is None and meshes)
        if is_base and meshes:
            base_arm, base_meshes = arm, meshes
            print(f"  본체: {fname}  (메시 {len(meshes)}개)")
        else:
            # 애니메이션만 필요하다 — 임포트한 오브젝트는 버린다 (액션은 fake user 로 남는다)
            for o in new_objs:
                bpy.data.objects.remove(o, do_unlink=True)
            print(f"  클립: {fname} -> \"{name}\"")

    if base_arm is None:
        raise SystemExit("메시가 든 FBX(With Skin)가 하나도 없다. Mixamo 에서 하나는 With Skin 으로 받아라")

    # ── 키 정규화 ──────────────────────────────────────────
    zs = [(base_arm.matrix_world @ v.co).z for m in base_meshes for v in m.data.vertices]
    height = max(zs) - min(zs)
    if height > 1e-6:
        factor = TARGET_HEIGHT / height
        # ★ 대입이 아니라 곱셈이다. Mixamo FBX 는 아마추어에 0.01(cm→m) 스케일이 걸린 채
        #   들어오므로, 덮어쓰면 그 변환이 사라져서 모델이 100배로 나온다.
        base_arm.scale = tuple(s * factor for s in base_arm.scale)
        bpy.context.view_layer.update()
        print(f"  키 {height:.3f} -> {TARGET_HEIGHT} (배율 x{factor:.4f}, 최종 스케일 {base_arm.scale[0]:.5f})")

    # ── 삼각형 상한 ────────────────────────────────────────
    tris = tri_count(base_meshes)
    print(f"  삼각형 {tris}")
    if tris > MAX_TRIS:
        ratio = MAX_TRIS / tris
        for m in base_meshes:
            mod = m.modifiers.new("decimate", 'DECIMATE')
            mod.ratio = ratio
        bpy.context.view_layer.update()
        print(f"  데시메이트 적용 (비율 {ratio:.3f}) -> 약 {MAX_TRIS}")

    # ── 내보내기 ───────────────────────────────────────────
    shrink_textures()
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_image_format='WEBP',        # PNG 대비 1/10. 알파도 유지된다
        export_image_quality=TEX_QUALITY,
        export_animations=True,
        export_animation_mode='ACTIONS',   # 액션 하나당 glTF 애니메이션 하나
        export_apply=True,                 # 모디파이어(데시메이트) 적용
        export_yup=True,                   # glTF 는 Y-up (ASSETS.md §1)
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )

    size = os.path.getsize(out_path)
    print("\n" + "=" * 52)
    print(f"완료: {out_path}")
    print(f"  크기      {size/1024:.0f} KB")
    print(f"  애니메이션 {len(clips)}개: {', '.join(clips)}")
    print(f"  삼각형    {min(tris, MAX_TRIS)}")
    print("=" * 52)


if __name__ == "__main__":
    main()
