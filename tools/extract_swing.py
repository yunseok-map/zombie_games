"""
extract_swing.py — 사람 근접공격 FBX 에서 **손 궤적**만 뽑아 JSON 으로 굽는다.

    blender --background --python tools/extract_swing.py -- fbx_src/person public/assets/models/swing_curves.json

왜 궤적만 뽑는가:
  이 게임은 1인칭이고 뷰모델은 **무기 하나뿐**이다(팔도 몸도 없다). 그래서 사람 전신
  애니메이션을 그대로 재생할 수가 없다. 대신 오른손 뼈가 머리 기준으로 어떻게 움직였는지를
  샘플링해서, 그 곡선으로 무기를 흔든다. 사인 곡선으로 만든 절차적 스윙과 달리
  **실제로 사람이 휘두른 가감속**이 남는다 — 예비동작에서 뜸을 들이고 타격에서 확 빠진다.

출력 형식 (진폭을 1로 정규화한다 — 단위·스케일 문제를 게임 쪽 계수 하나로 흡수한다):
  { "<이름>": { "dur": 초, "samples": [ {"t":0~1, "p":[x,y,z], "e":[rx,ry,rz]}, ... ] } }

좌표계: 블렌더(Z-up) → three.js(Y-up) 로 바꿔서 내보낸다.  three(x, y, z) = blender(x, z, -y)
"""
import bpy
import json
import math
import os
import sys
from mathutils import Vector

SAMPLES = 28          # 곡선 하나당 표본 수. 이보다 촘촘해도 눈으로 차이가 안 난다
HAND = "mixamorig:RightHand"
REF = "mixamorig:Head"   # 머리 기준 = 1인칭 카메라 기준에 가장 가깝다


def argv_after_ddash():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.actions, bpy.data.armatures, bpy.data.meshes):
        for item in list(block):
            block.remove(item)


def find_bone(arm, name):
    """이름이 정확히 안 맞을 수 있다 — 접미사로도 찾아본다"""
    if name in arm.pose.bones:
        return arm.pose.bones[name]
    tail = name.split(":")[-1].lower()
    for pb in arm.pose.bones:
        if pb.name.split(":")[-1].lower() == tail:
            return pb
    return None


def extract(path):
    clear_scene()
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    if not arm:
        print(f"  ! {os.path.basename(path)}: 아마추어가 없다 — 건너뜀")
        return None
    action = arm.animation_data.action if arm.animation_data else None
    if not action:
        print(f"  ! {os.path.basename(path)}: 액션이 없다 — 건너뜀")
        return None

    hand = find_bone(arm, HAND)
    ref = find_bone(arm, REF)
    if not hand:
        print(f"  ! {os.path.basename(path)}: {HAND} 를 못 찾았다 — 건너뜀")
        return None

    f0, f1 = (int(round(v)) for v in action.frame_range)
    fps = bpy.context.scene.render.fps
    dur = max(0.05, (f1 - f0) / float(fps))

    raw = []
    for i in range(SAMPLES):
        f = f0 + (f1 - f0) * i / float(SAMPLES - 1)
        bpy.context.scene.frame_set(int(f), subframe=f - int(f))
        bpy.context.view_layer.update()

        hm = arm.matrix_world @ hand.matrix
        pos = hm.to_translation()
        if ref:
            # 머리를 원점으로 — 몸이 앞으로 나아가는 성분을 지운다.
            # 안 지우면 무기가 화면 밖으로 걸어 나간다.
            pos = pos - (arm.matrix_world @ ref.matrix).to_translation()
        eul = hm.to_euler("XYZ")
        raw.append((pos.copy(), Vector((eul.x, eul.y, eul.z))))

    # 첫 표본을 기준으로 삼아 **차이만** 남긴다 (뷰모델의 원래 자세가 기준이 되도록)
    p0, e0 = raw[0]
    pts = []
    for pos, eul in raw:
        d = pos - p0
        de = eul - e0
        # 블렌더(Z-up) → three.js(Y-up)
        pts.append(([d.x, d.z, -d.y], [de.x, de.z, -de.y]))

    # 진폭 1 로 정규화 — 단위(cm/m)·리그 크기 차이를 여기서 흡수한다
    pmax = max((max(abs(c) for c in p) for p, _ in pts), default=0) or 1.0
    emax = max((max(abs(c) for c in e) for _, e in pts), default=0) or 1.0

    samples = [
        {
            "t": round(i / float(SAMPLES - 1), 4),
            "p": [round(c / pmax, 4) for c in p],
            "e": [round(c / emax, 4) for c in e],
        }
        for i, (p, e) in enumerate(pts)
    ]
    print(f"  {os.path.basename(path)} -> {dur:.2f}s, 표본 {len(samples)}개 "
          f"(위치 진폭 {pmax:.3f}, 회전 진폭 {math.degrees(emax):.1f}도)")
    return {"dur": round(dur, 3), "samples": samples}


def main():
    args = argv_after_ddash()
    if len(args) < 2:
        raise SystemExit("사용법: ... -- <fbx폴더> <출력.json>")
    src_dir, out_path = args[0], args[1]

    files = sorted(f for f in os.listdir(src_dir) if f.lower().endswith(".fbx"))
    if not files:
        raise SystemExit(f"{src_dir} 에 FBX 가 없다")

    out = {}
    for fname in files:
        # 파일명을 소문자 언더스코어로 — 게임에서 이 키로 찾는다
        key = os.path.splitext(fname)[0].lower()
        for ch in " ()-":
            key = key.replace(ch, "_")
        while "__" in key:
            key = key.replace("__", "_")
        key = key.strip("_")
        data = extract(os.path.join(src_dir, fname))
        if data:
            out[key] = data

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(out, fp, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(out_path)
    print(f"\n완료: {out_path}  ({size / 1024:.1f} KB, 곡선 {len(out)}개)")
    print("키:", ", ".join(out.keys()))


main()
