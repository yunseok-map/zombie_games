"""Sketchfab 소품 GLB → 게임용 GLB 변환기 (Blender 헤드리스 전용)

사용법:
    blender --background --python tools/import_props.py -- [이름 ...]
    blender --background --python tools/import_props.py --          # 전부

하는 일 (PROGRESS.md 인계 메모의 2~4번):
  1. 원본에서 필요한 오브젝트만 남긴다 (룸/팩은 노드 이름으로 골라낸다)
  2. 축을 세우고, 실제 크기(m)로 맞추고, 원점을 바닥 중앙으로 옮긴다
     → 게임 코드는 바닥 좌표만 주면 되고, 모델별 스케일 보정이 필요 없다
  3. 텍스처를 줄이고 WebP 로 재인코딩한다 (용량의 대부분이 텍스처다)
  4. 삼각형 상한을 넘으면 데시메이트한다
  5. **사람 키 막대(1.75m)와 함께 미리보기 PNG 를 렌더한다**
     Sketchfab 모델은 축·원점·스케일이 제각각이라 숫자만 보고는 맞았는지 알 수 없다.
     아래 MANIFEST 의 up/yaw/size 는 이 미리보기를 보고 고친다.

출력:
    public/assets/models/props/<이름>.glb
    tools/preview/<이름>.png
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent
# 원본(Sketchfab 다운로드본)은 public/ 밖에 둔다 — 합계 98MB 라 그대로 두면
# 빌드 산출물에 통째로 실려 나간다. 게임이 읽는 건 아래 OUT_* 로 나가는 결과물뿐이다.
SRC = ROOT / "tools/source_models"
OUT_PROPS = ROOT / "public/assets/models/props"
OUT_WEAPONS = ROOT / "public/assets/models/weapons"
PREVIEW = ROOT / "tools/preview"

MAX_TEX = 512             # 소품은 손전등 원뿔 안에서만 보인다. 좀비(1024)보다 작아도 된다
TEX_QUALITY = 80
HUMAN = 1.75              # 미리보기 기준 막대 = 플레이어 눈높이대


# ── 변환 명세 ────────────────────────────────────────────────────────────────
# size/axis : 그 축의 길이를 size(m) 로 맞춘다. axis 'y'=높이, 'max'=최장축(누운 물건)
#             size 를 안 적으면 원본 크기를 그대로 쓴다 — glb_inspect.py 로 재보고,
#             이미 실측값이면 건드리지 않는 게 맞다 (VR팩이 전부 그렇다)
# up        : 'z' 면 원본이 Z-up 이라 세워야 한다 (Blender 에서 X축 +90°)
# yaw       : 세운 뒤 Z축 회전(도). 정면을 -Z(three.js 기준 앞) 로 돌릴 때
# keep      : 룸/팩에서 남길 오브젝트 이름 (부분일치). 없으면 전부
# tris      : 삼각형 상한. 넘으면 데시메이트
# origin    : 'bottom' 바닥 중앙(기본) | 'center' 중심 (무기는 이쪽)
MANIFEST = {
    # ── 단품 소품 ──
    "prop_bed_worn":    dict(src="old_and_worn_out_hospital_bed.glb",  size=2.05, axis="max", tris=3000),
    "prop_bed":         dict(src="hospital_bed.glb",                   tris=6000),
    "prop_wheelchair":  dict(src="wheelchair_horror_game_hospital.glb", size=1.05, axis="max", tris=3500),
    "prop_panel":       dict(src="electrical_breaker_panel_box__lp_model.glb", tris=3000),
    "prop_ivdrip":      dict(src="crutch_and_iv_drip.glb",             size=1.90, axis="y", tris=4000),
    "prop_ivpole":      dict(src="iv_pole.glb",                        size=1.90, axis="y", tris=2000),
    "prop_firstaid":    dict(src="first_aid_box.glb",                  size=0.32, axis="max", tris=1500),
    # 서류함만 원본이 눕혀서 저장돼 있다 (원본 0.57×0.70×1.10 에서 높이가 Z 축)
    "prop_cabinet":     dict(src="filing_cabinet.glb", up="z", size=1.32, axis="y", tris=1200),
    "prop_bodybag":     dict(src="body_bag01.glb",                     tris=1600),
    "prop_corpse":      dict(src="corpse.glb",                         size=1.80, axis="max", tris=6000),
    "prop_vending":     dict(src="vending_machine.glb",                size=1.83, axis="y", tris=2000),

    # ── 영안실에서 추출 ──
    # 이 방은 통째로 약 1.4배 크게 만들어져 있다(시체가 2.49m). 그래서 전부 크기를 지정한다.
    "prop_morgue_lockers": dict(src="morgue_room.glb", keep=["Locker_2048"],
                                size=2.20, axis="y", tris=2500),
    "prop_autopsy_table":  dict(src="morgue_room.glb", keep=["AutopsyTable_"],
                                size=0.95, axis="y", tris=2000),
    "prop_surgical_lamp":  dict(src="morgue_room.glb", keep=["Surgical_Lamp"],
                                size=1.20, axis="max", tris=1600),
    "prop_trolley":        dict(src="morgue_room.glb", keep=["Surgical_Trolley"],
                                size=0.95, axis="y", tris=1000),
    "prop_sink":           dict(src="morgue_room.glb", keep=["Sink_"],
                                size=0.90, axis="y", tris=800),

    # ── VR 팩에서 추출 — 원본이 이미 실측 크기라 스케일을 건드리지 않는다 ──
    "prop_ventilator":     dict(src="vr_ready_hospital_props.glb",
                                keep=["anesthesiaVentilator"], tris=4000),
    "prop_curtain":        dict(src="vr_ready_hospital_props.glb",
                                keep=["standingCourtains"], tris=1400),
    "prop_bench":          dict(src="vr_ready_hospital_props.glb",
                                keep=["hospitalBench"], tris=1300),
    "prop_computer_cart":  dict(src="vr_ready_hospital_props.glb",
                                keep=["computerCart"], tris=900),
    "prop_mop_bucket":     dict(src="vr_ready_hospital_props.glb",
                                keep=["mopBucket"], tris=500),
    "prop_water_cooler":   dict(src="vr_ready_hospital_props.glb",
                                keep=["waterCooler"], tris=550),
    "prop_extinguisher":   dict(src="vr_ready_hospital_props.glb",
                                keep=["fireExtinguisherBox"], tris=200),
    "prop_reception_desk": dict(src="vr_ready_hospital_props.glb",
                                keep=["reseptionDesk"], tris=500),
    # hospital_reception_environment 는 통째로 버렸다 — 의자가 3개씩 한 메시로 뭉쳐 있고
    # 데스크에는 바닥(11.95×8.93m)까지 딸려 온다. 위 VR 팩 데스크가 더 낫다.

    # ── 무기 (원점은 중심. 뷰모델 오프셋은 weapons.js 가 잡는다) ──
    "weapon_pipe":    dict(src="bloody_lead_pipe.glb", size=0.62, axis="max",
                           tris=1500, origin="center", out="weapons"),
    "weapon_pistol":  dict(src="9mm_pistol.glb",       size=0.20, axis="max",
                           tris=5000, origin="center", out="weapons"),
    "weapon_crowbar": dict(src="crowbar.glb",          size=0.76, axis="max",
                           tris=900, origin="center", out="weapons"),
}


def log(msg):
    print(f"  {msg}", flush=True)


def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [o for o in bpy.context.scene.objects]


def unparent_all():
    """메시를 부모에서 떼어내되 월드 변환은 유지한다. **가장 먼저 해야 한다.**

    Sketchfab GLB 는 `Sketchfab_model > *.fbx > RootNode > 메시` 구조이고,
    Y-up→Z-up 변환과 전체 스케일이 그 빈 오브젝트들에 걸려 있다.
    부모를 먼저 지우고 나서 parent_clear 를 부르면 그 변환이 통째로 날아가서
    모델이 눕거나 엉뚱한 크기가 된다 (원본은 멀쩡한데 결과만 이상해진다).
    """
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        return []
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return meshes


def keep_only(meshes, patterns):
    """이름이 patterns 중 하나로 시작하는 메시만 남긴다.
    '포함'이 아니라 '시작'인 이유: morgue_room 의 AutopsyTable1 이
    'AutopsyTable_' 을 포함해서 같이 딸려왔다."""
    keep, drop = [], []
    for o in meshes:
        if patterns and not any(o.name.lower().startswith(p.lower()) for p in patterns):
            drop.append(o)
        else:
            keep.append(o)
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH' or o in drop:
            bpy.data.objects.remove(o, do_unlink=True)
    return keep


def flatten(meshes):
    """남은 메시를 하나로 합친다. 변환은 unparent_all 에서 이미 구웠다."""
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def dims(obj):
    return Vector(obj.dimensions)


def orient(obj, up, yaw):
    """메시 데이터를 직접 돌린다.
    `rotation_euler` + `transform_apply(rotation=True)` 는 백그라운드에서 조용히
    안 먹는 경우가 있다(오퍼레이터가 컨텍스트를 타서, 에러 없이 회전이 무시된다).
    그러면 obj.dimensions 는 그대로라 다음 단계인 크기 맞추기가 엉뚱한 축을 잡는다."""
    m = Matrix.Identity(4)
    if up == 'z':                       # 원본이 Z-up 으로 저장돼 있다 → 세운다
        m = Matrix.Rotation(math.radians(90), 4, 'X') @ m
    if yaw:
        m = Matrix.Rotation(math.radians(yaw), 4, 'Z') @ m
    if m != Matrix.Identity(4):
        obj.data.transform(m)
        obj.data.update()
        # 이걸 빼면 obj.dimensions 가 회전 전 값을 그대로 돌려주고,
        # 다음 단계(rescale)가 엉뚱한 축 길이로 배율을 잡는다.
        bpy.context.view_layer.update()


def rescale(obj, size, axis):
    """Blender 는 Z-up, 게임(glTF)은 Y-up 이다. 명세의 'y'(높이)는 Blender 의 Z 다."""
    d = dims(obj)
    idx = {'x': 0, 'y': 2, 'z': 1}.get(axis)   # y(높이)→Blender Z, z(깊이)→Blender Y
    cur = max(d) if axis == 'max' else d[idx]
    if cur <= 1e-6:
        raise SystemExit(f"크기를 잴 수 없다 (축 {axis} 가 0)")
    s = size / cur
    obj.scale = (s, s, s)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(scale=True)
    return s


def set_origin(obj, mode):
    """원점을 바닥 중앙(또는 중심)으로. 게임에서 바닥 y 좌표만 주면 놓이게 하려는 것."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    if mode == 'bottom':
        # BOUNDS 는 중심에 놓으므로 절반 높이만큼 정점을 올린다
        obj.data.transform(Matrix.Translation((0, 0, obj.dimensions.z / 2)))
        obj.data.update()
    obj.location = (0, 0, 0)


def tri_count(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def decimate(obj, limit):
    n = tri_count(obj)
    if n <= limit:
        return n
    mod = obj.modifiers.new("dec", 'DECIMATE')
    mod.ratio = limit / n
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after = tri_count(obj)
    log(f"데시메이트 {n:,} → {after:,}")
    return after


def clean_materials():
    """이미지가 비어 있는 Image Texture 노드를 지운다.

    이게 남아 있으면 glTF 에 source 없는 텍스처 항목이 하나 생기고,
    three.js GLTFLoader 가 그걸 읽다가 `Cannot read properties of undefined
    (reading 'uri')` 로 파일 전체를 못 읽는다. (prop_bodybag · prop_ivdrip 이 그랬다)
    """
    removed = 0
    for mat in bpy.data.materials:
        if not mat.use_nodes or not mat.node_tree:
            continue
        for node in list(mat.node_tree.nodes):
            if node.type == 'TEX_IMAGE' and node.image is None:
                mat.node_tree.nodes.remove(node)
                removed += 1
    if removed:
        log(f"빈 텍스처 노드 {removed}개 제거")


def normalize_images():
    """8비트(팔레트·그레이) PNG 를 RGBA 로 다시 만든다.

    이런 이미지는 WebP 로 내보내기가 조용히 실패해서, glTF 에 source 없는 텍스처만
    남는다. 그러면 three.js 가 `Cannot read properties of undefined (reading 'uri')`
    로 **파일 전체**를 못 읽는다. body_bag01 의 베이스컬러가 이 경우였다(depth=8).
    """
    remap = {}
    for img in list(bpy.data.images):
        # `has_data` 로 거르면 안 된다 — 팩된 이미지는 한 번 건드리기 전까지 False 다.
        # (그래서 이 함수를 shrink 앞으로 옮겼을 때 전부 건너뛰고 조용히 아무것도 안 했다)
        if img.size[0] == 0:
            continue
        # `img.depth` 도 믿을 수 없다 (scale 후에도 옛 값을 돌려준다). 조건 없이 다시 만든다.
        w, h = img.size
        buf = [0.0] * (w * h * 4)
        img.pixels.foreach_get(buf)
        new = bpy.data.images.new(f"{img.name}_rgba", w, h, alpha=True)
        new.pixels.foreach_set(buf)
        new.colorspace_settings.name = img.colorspace_settings.name
        new.file_format = 'PNG'
        new.pack()
        remap[img] = new
    if not remap:
        return
    for mat in bpy.data.materials:
        if not mat.use_nodes or not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image in remap:
                node.image = remap[node.image]
    log(f"이미지 {len(remap)}장 RGBA 재구성")


def shrink_textures():
    for img in bpy.data.images:
        if not img.has_data or img.size[0] == 0:
            continue
        w, h = img.size
        if max(w, h) <= MAX_TEX:
            continue
        s = MAX_TEX / max(w, h)
        img.scale(max(1, int(w * s)), max(1, int(h * s)))


def render_preview(obj, name):
    """사람 키 막대 옆에 세워 렌더. 축·크기가 틀렸는지는 이걸 봐야 안다."""
    PREVIEW.mkdir(parents=True, exist_ok=True)
    d = dims(obj)
    span = max(max(d), HUMAN)

    # 1.75m 기준 막대 — 모델 왼쪽에
    bpy.ops.mesh.primitive_cube_add(size=1)
    ref = bpy.context.active_object
    ref.scale = (0.18, 0.12, HUMAN / 2)
    ref.location = (-(d.x / 2 + 0.45), 0, HUMAN / 2)
    mat = bpy.data.materials.new("ref")
    mat.use_nodes = False
    mat.diffuse_color = (0.9, 0.25, 0.15, 1)
    ref.data.materials.append(mat)

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = scene.render.resolution_y = 400
    scene.render.film_transparent = False
    # 배경은 world 가 아니라 뷰포트 설정으로 준다.
    # world 로 주면 배치 2번째부터 검게 나온다(장면을 새로 만들 때 world 참조가 끊긴다).
    scene.display.shading.background_type = 'VIEWPORT'
    scene.display.shading.background_color = (0.08, 0.08, 0.09)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = span * 1.9
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    target = Vector((0, 0, d.z / 2))
    cam.location = target + Vector((2.2, -3.4, 1.9)).normalized() * (span * 3)
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam

    scene.render.filepath = str(PREVIEW / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ref, do_unlink=True)


def export(obj, name, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{name}.glb"
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB', use_selection=True,
        export_image_format='WEBP', export_image_quality=TEX_QUALITY,
        export_apply=True, export_animations=False,
    )
    return path


def convert(name, spec):
    log(f"── {name}  ({spec['src']})")
    wipe()
    import_glb(SRC / spec['src'])
    meshes = keep_only(unparent_all(), spec.get('keep'))
    if not meshes:
        raise SystemExit(f"{name}: 남은 메시가 없다 — keep 패턴을 확인하라")

    obj = flatten(meshes)
    before = dims(obj).copy()
    orient(obj, spec.get('up', 'y'), spec.get('yaw', 0))
    # size 가 없으면 원본 크기가 이미 실측값이라는 뜻이다 (팩 모델 다수가 그렇다)
    scale = rescale(obj, spec['size'], spec['axis']) if spec.get('size') else 1.0
    set_origin(obj, spec.get('origin', 'bottom'))
    tris = decimate(obj, spec['tris'])
    clean_materials()
    # 순서 주의: 먼저 RGBA 로 다시 만들어야 축소(img.scale)가 제대로 먹는다.
    # 1바이트/픽셀 이미지는 scale 도 조용히 실패해서 1024 그대로 남는다.
    normalize_images()
    shrink_textures()

    out_dir = OUT_WEAPONS if spec.get('out') == 'weapons' else OUT_PROPS
    path = export(obj, name, out_dir)
    d = dims(obj)
    mb = path.stat().st_size / 1e6
    log(f"크기 {d.x:.2f}×{d.z:.2f}×{d.y:.2f}m (X×높이×Z)  ×{scale:.4f}  "
        f"{tris:,}tri  {mb:.2f}MB")

    render_preview(obj, name)
    return dict(name=name, src=spec['src'], scale=round(scale, 5),
                size=[round(d.x, 3), round(d.z, 3), round(d.y, 3)],
                tris=tris, mb=round(mb, 2),
                src_size=[round(before.x, 2), round(before.z, 2), round(before.y, 2)])


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = args or list(MANIFEST)
    results = []
    for n in names:
        if n not in MANIFEST:
            log(f"!! 명세에 없는 이름: {n}")
            continue
        try:
            results.append(convert(n, MANIFEST[n]))
        except Exception as e:                    # 하나 실패해도 나머지는 계속
            log(f"!! {n} 실패: {e}")
            results.append(dict(name=n, error=str(e)))
    # 한 프로세스에서 여러 개를 렌더하면 미리보기가 깨진다(오프스크린 버퍼가
    # 장면 재생성 사이에 오염된다). 그래서 run_all.sh 는 모델당 프로세스를 새로 띄운다.
    # 결과는 덮어쓰지 않고 이름 기준으로 합친다.
    merged = {}
    path = PREVIEW / "result.json"
    if path.exists():
        merged = {r["name"]: r for r in json.loads(path.read_text(encoding="utf-8"))}
    merged.update({r["name"]: r for r in results})
    order = [n for n in MANIFEST if n in merged]
    PREVIEW.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([merged[n] for n in order], ensure_ascii=False, indent=1),
                    encoding="utf-8")
    ok = [r for r in results if "error" not in r]
    print(f"\n완료 {len(ok)}/{len(names)}  합계 {sum(r['mb'] for r in ok):.1f}MB  "
          f"{sum(r['tris'] for r in ok):,}tri", flush=True)


if __name__ == "__main__":
    main()
