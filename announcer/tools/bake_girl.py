"""cute girl 5.0.blend (Auto-Rig Pro) -> announcer GLB.
- lowers the arms with the IK controls and bakes that pose into the mesh basis
- bakes face-control poses into shape keys (same 15 names as Freya)
- strips control rig, swaps in pre-resized textures, exports skinned GLB with morphs"""
import bpy, mathutils, sys, json, numpy as np

SRC = "/home/claude/girl_src/cute girl/cute girl 5.0.blend"
TEX = "/home/claude/girl_tex/"
OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "/home/claude/web/girl.glb"
SHAPES = json.load(open(sys.argv[sys.argv.index("--shapes") + 1] if "--shapes" in sys.argv else "/home/claude/scripts/shapes_girl.json"))
ARM_ANGLE = 0.45

bpy.ops.wm.open_mainfile(filepath=SRC)
rig = bpy.data.objects['rig']; pb = rig.pose.bones
M = mathutils.Matrix; V = mathutils.Vector
MESHES = [o.name for o in bpy.data.objects if o.type == 'MESH' and o.parent == rig]
upd = lambda: bpy.context.view_layer.update()

def reset_pose():
    for b in pb:
        b.location = (0, 0, 0); b.rotation_euler = (0, 0, 0); b.rotation_quaternion = (1, 0, 0, 0); b.scale = (1, 1, 1)
    upd()

def mirror(n): return n[:-2] + '.r' if n.endswith('.l') else n

def arms_down():
    for side, sgn in (('l', 1), ('r', -1)):
        sh = (pb['c_arm_ik.' + side].matrix).translation.copy()
        R = M.Translation(sh) @ M.Rotation(ARM_ANGLE * sgn, 4, 'Y') @ M.Translation(-sh)
        h = pb['c_hand_ik.' + side]; h.matrix = R @ h.matrix
        upd()

def apply_op(op, mir):
    n = mirror(op['bone']) if mir else op['bone']; b = pb[n]
    if 'loc' in op:
        b.location = op['loc']
    if 'move' in op:
        x, y, z = [c / 1000 for c in op['move']]
        if mir: x = -x
        b.matrix = M.Translation(V((x, y, z))) @ b.matrix
    upd()

def coords(name):
    o = bpy.data.objects[name]; e = o.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = e.to_mesh()
    a = np.empty(len(m.vertices) * 3); m.vertices.foreach_get('co', a); e.to_mesh_clear(); return a.reshape(-1, 3)

# ---- calibrate eyelid closure (upper lid margin meets lower lid margin)
body = bpy.data.objects['body']
def vg(name, thr):
    gi = body.vertex_groups[name].index
    return np.array([v.index for v in body.data.vertices if any(g.group == gi and g.weight > thr for g in v.groups)])
reset_pose(); arms_down(); base = coords('body')
close = {}
for side in ('l', 'r'):
    lt = vg('c_eyelid_top_02.' + side, .5); lb = vg('c_eyelid_bot_02.' + side, .5)
    tm = lt[np.argmin(base[lt, 2])]; bm = lb[np.argmax(base[lb, 2])]
    target = base[bm, 2] + 0.0004
    lo, hi = -0.03, 0.0
    for _ in range(18):
        mid = (lo + hi) / 2; pb['c_eyelid_top.' + side].location = (0, 0, mid); upd()
        z = coords('body')[tm, 2]
        if z > target: hi = mid
        else: lo = mid
    close[side] = (lo + hi) / 2; pb['c_eyelid_top.' + side].location = (0, 0, 0); upd()
print('EYELID CLOSE', close)

# ---- neutral (arms down) + shapes
reset_pose(); arms_down()
neutral = {n: coords(n) for n in MESHES}
# deform-bone pose matrices with arms down -> become the new rest pose
DEF_POSE = {b.name: b.matrix.copy() for b in pb if b.bone.use_deform}
DEF_LEN = {b.name: (b.tail - b.head).length for b in pb if b.bone.use_deform}
deltas = {}
for sname, spec in SHAPES.items():
    reset_pose(); arms_down()
    for op in spec['ops']:
        op = dict(op)
        if op.get('loc') == 'BLINK':
            side = 'r' if spec.get('mirror') else 'l'
            op['loc'] = (0, 0, close[side] * op.get('k', 1.0)); op['bone'] = 'c_eyelid_top.l'
        if op.get('loc') == 'BLINK_R':
            op['loc'] = (0, 0, close['r'] * op.get('k', 1.0))
        if op.get('loc') == 'BLINK_L':
            op['loc'] = (0, 0, close['l'] * op.get('k', 1.0))
        apply_op(op, spec.get('mirror', False))
    deltas[sname] = {n: coords(n) - neutral[n] for n in MESHES}
    print('SHAPE', sname, {n: round(float(np.abs(d).max()) * 1000, 2) for n, d in deltas[sname].items() if np.abs(d).max() > 1e-5})
reset_pose()

# ---- natural chest volume: shrink forward projection of the bust (same warp on every mesh keeps clothes on)
BUST = dict(cx=0.09, cz=1.30, rx=0.15, rz=0.15, wall=-0.125, keep=0.28)
def bust_warp(a):
    a = a.copy()
    for sx in (1, -1):
        dx = (a[:, 0] * sx - BUST['cx']) / BUST['rx']; dz = (a[:, 2] - BUST['cz']) / BUST['rz']
        d = np.sqrt(dx * dx + dz * dz)
        t = np.clip((1.0 - d) / 0.5, 0, 1); w = t * t * (3 - 2 * t)        # 1 inside, smooth to 0 at the rim
        f = BUST['wall'] - a[:, 1]                                            # depth in front of chest wall
        m = (f > 0) & (w > 0)
        a[m, 1] += f[m] * w[m] * (1 - BUST['keep'])                           # pull toward the wall
        g = np.clip(f[m] / 0.04, 0, 1)
        a[m, 2] += (BUST['cz'] + 0.02 - a[m, 2]) * w[m] * 0.10 * g                 # slight lift / tighten
        a[m, 0] += (BUST['cx'] * sx - a[m, 0]) * w[m] * 0.34 * g                    # narrower side bulge
    return a
NO_BUST = '--no-bust' in sys.argv
for n in MESHES:
    if n in ('body', 'shirt', 'hair') and not NO_BUST:
        before = neutral[n][:, 1].min(); neutral[n] = bust_warp(neutral[n])
        print('BUST', n, 'front y', round(before, 3), '->', round(neutral[n][:, 1].min(), 3))

# ---- write basis (arms down) + shape keys
for n in MESHES:
    o = bpy.data.objects[n]
    if o.data.shape_keys: o.shape_key_clear()
    o.data.vertices.foreach_set('co', neutral[n].ravel()); o.data.update()
    used = [s for s in SHAPES if np.abs(deltas[s][n]).max() > 5e-5]
    if not used: continue
    o.shape_key_add(name='Basis', from_mix=False)
    for s in SHAPES:
        k = o.shape_key_add(name=s, from_mix=False); d = deltas[s][n].copy(); d[np.abs(d) < 2e-6] = 0
        k.data.foreach_set('co', (neutral[n] + d).ravel()); k.value = 0.0

# ---- strip control rig
if rig.animation_data:
    for d in list(rig.animation_data.drivers): rig.animation_data.drivers.remove(d)
    rig.animation_data_clear()
for b in pb:
    for c in list(b.constraints): b.constraints.remove(c)
keep = set(MESHES) | {'rig'}
for o in list(bpy.data.objects):
    if o.name not in keep: bpy.data.objects.remove(o, do_unlink=True)
reset_pose()

# ---- rebuild a proper FK hierarchy of deform bones on the arms-down rest pose
vl0 = {o.name for o in bpy.context.view_layer.objects}
if 'rig' not in vl0: bpy.context.scene.collection.objects.link(rig)
for lc in bpy.context.view_layer.layer_collection.children: lc.exclude = False
upd()
bpy.context.view_layer.objects.active = rig; rig.hide_set(False); rig.hide_viewport = False
rig.data.collections_all and [setattr(c, 'is_visible', True) for c in rig.data.collections_all]
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
for n, mtx in DEF_POSE.items():
    if n in eb:
        eb[n].matrix = mtx.normalized(); eb[n].length = max(DEF_LEN[n], 1e-4)
defs = [b for b in eb if b.use_deform]
EXPLICIT = {'spine_01.x': 'root.x', 'spine_02.x': 'spine_01.x', 'spine_03.x': 'spine_02.x', 'spine_04.x': 'spine_03.x',
            'spine_05.x': 'spine_04.x', 'thigh_twist.l': 'root.x', 'thigh_twist.r': 'root.x', 'root.x': None,
            'arm_stretch.l': 'arm_twist_2.l', 'arm_stretch.r': 'arm_twist_2.r', 'thigh_stretch.l': 'thigh_twist_2.l', 'thigh_stretch.r': 'thigh_twist_2.r'}
def seg_dist(p, a, b):
    ab = b - a; t = max(0, min(1, (p - a).dot(ab) / max(ab.length_squared, 1e-12))); return (a + ab * t - p).length
orig = {}
for b in defs:
    p = b.parent
    while p and not p.use_deform: p = p.parent
    orig[b.name] = p.name if p else None
newpar = {}
for b in defs:
    n = b.name
    if n in EXPLICIT: newpar[n] = EXPLICIT[n]; continue
    best = None; bd = 0.006
    for o in defs:
        if o is b: continue
        d = (o.tail - b.head).length
        if d < bd: bd = d; best = o.name
    if best is None and orig[n]: best = orig[n]
    if best is None:
        bd = 1e9
        for o in defs:
            if o is b: continue
            d = seg_dist(b.head, o.head, o.tail)
            if d < bd: bd = d; best = o.name
    newpar[n] = best
# avoid cycles
def anc(n, seen):
    while n:
        if n in seen: return True
        seen.add(n); n = newpar.get(n)
    return False
for n in list(newpar):
    if anc(n, set()): newpar[n] = orig[n] or 'root.x'
for b in defs:
    b.use_connect = False; b.parent = None
for b in defs:
    b.parent = eb[newpar[b.name]] if newpar[b.name] else None
for b in [b for b in eb if not b.use_deform]: eb.remove(b)
bpy.ops.object.mode_set(mode='OBJECT')
print('NEWPAR', {k: newpar[k] for k in ['arm_stretch.l','arm_twist_2.l','c_arm_twist_offset.l','thigh_stretch.l','thigh_twist_2.l']})
for n in ['arm_stretch.l', 'thigh_stretch.l', 'head.x', 'neck.x', 'spine_05.x', 'forearm_stretch.l', 'hand.l', 'c_index1_base.l', 'foot.l', 'leg_stretch.l', 'c_eye.l']:
    bb = rig.data.bones.get(n); print('HIER', n, '<-', bb.parent.name if bb and bb.parent else None, tuple(round(x, 3) for x in bb.head_local) if bb else None)
reset_pose()

# ---- materials
def img(path):
    i = bpy.data.images.load(TEX + path, check_existing=True); return i
def bsdf(mat): return [n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'][0]
def simplify_normal(mat, main_img_prefix):
    nt = mat.node_tree; p = bsdf(mat)
    tex = [n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith(main_img_prefix)][0]
    nmap = [n for n in nt.nodes if n.type == 'NORMAL_MAP' and n.inputs['Color'].links and n.inputs['Color'].links[0].from_node == tex][0]
    for l in list(p.inputs['Normal'].links): nt.links.remove(l)
    nt.links.new(nmap.outputs['Normal'], p.inputs['Normal'])
    for n in list(nt.nodes):
        if n.type in ('VECT_MATH', 'MAPPING', 'TEX_COORD') or (n.type == 'NORMAL_MAP' and n != nmap) or \
           (n.type == 'TEX_IMAGE' and n.image and ('SkinMicro' in n.image.name or 'ACVI' in n.image.name)):
            nt.nodes.remove(n)
    return nt

swap = {'body_basecolor-2.png': 'body_basecolor-2.png', 'body_normal': 'body_normal.png', 'body_roughness.png': 'body_roughness.png',
        'Eye_BaseColor.tga.001': 'Eye_BaseColor.png', 'jean_basecolor.png': 'jean_basecolor.png', 'jean_normal.png': 'jean_normal.png',
        'shirt_basecolor.png': 'shirt_basecolor.png', 'shirt_normal.png': 'shirt_normal.png',
        'Mouth_Base_Color.png': 'Mouth_Base_Color.png', 'Mouth_Normal.png': 'Mouth_Normal.png', 'Mouth_Roughness.png': 'Mouth_Roughness.png',
        'Mouth_Base_Color.png.001': 'Mouth_Base_Color.png', 'Mouth_Normal.png.001': 'Mouth_Normal.png', 'Mouth_Roughness.png.001': 'Mouth_Roughness.png'}
for m in bpy.data.materials:
    if not m.node_tree: continue
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and n.image.name in swap:
            cs = n.image.colorspace_settings.name
            n.image = img(swap[n.image.name]); n.image.colorspace_settings.name = cs

simplify_normal(bpy.data.materials['body'], 'body_normal')
simplify_normal(bpy.data.materials['jean'], 'jean_normal')
simplify_normal(bpy.data.materials['shirt'], 'shirt_normal')
for mn in ('teeth', 'teeth.001'):
    nt = bpy.data.materials[mn].node_tree
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE' and n.image and ('Specular' in n.image.name or 'SSS' in n.image.name): nt.nodes.remove(n)
# hair: constant tint + strand alpha merged into one RGBA texture
hm = bpy.data.materials['hair']; nt = hm.node_tree; p = bsdf(hm)
for n in list(nt.nodes):
    if n.type in ('MIX', 'TEX_IMAGE'): nt.nodes.remove(n)
t = nt.nodes.new('ShaderNodeTexImage'); t.image = img('hair_rgba.png')
nt.links.new(t.outputs['Color'], p.inputs['Base Color']); nt.links.new(t.outputs['Alpha'], p.inputs['Alpha'])
p.inputs['Roughness'].default_value = 0.55

# ---- export
vl = {o.name for o in bpy.context.view_layer.objects}
for o in bpy.data.objects:
    if o.name not in vl: bpy.context.scene.collection.objects.link(o)
for lc in bpy.context.view_layer.layer_collection.children: lc.exclude = False
upd()
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects: o.hide_set(False); o.hide_viewport = False; o.select_set(True)
print('EXPORT OBJECTS', [o.name for o in bpy.context.selected_objects])
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
                          export_morph=True, export_morph_normal=True, export_skins=True,
                          export_animations=False, export_def_bones=True, export_apply=False,
                          export_image_format='WEBP', export_image_quality=82, export_yup=True, export_extras=False)
print('EXPORTED', OUT)
