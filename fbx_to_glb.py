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

# 이 클립들은 루트 이동(root motion)을 지운다.
# 이동은 Zombie._goTo() 가 하므로 애니메이션에도 전진이 들어있으면 두 배로 미끄러진다.
# Mixamo 의 "In Place" 체크박스와 같은 일을 여기서 확실하게 한다.
STRIP_ROOT_MOTION = {"walk", "run"}


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
        raise SystemExit("사용법: ... -- <fbx폴더> <출력.glb>")
    src_dir, out_path = args[0], args[1]

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
            if name in STRIP_ROOT_MOTION:
                n = strip_root_motion(action, arm)
                print(f"    루트 이동 제거: {name} (커브 {n}개)")
            clips.append(name)

        if base_arm is None and meshes:
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
        base_arm.scale = (factor, factor, factor)
        bpy.context.view_layer.update()
        print(f"  키 {height:.3f} -> {TARGET_HEIGHT} (배율 {factor:.4f})")

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
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
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
