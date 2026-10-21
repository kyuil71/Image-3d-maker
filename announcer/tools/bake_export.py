"""Freya.blend -> announcer GLB.
Bakes Rigify face-control poses into shape keys (morph targets), strips the control rig,
merges separate alpha maps, downsizes textures, exports a skinned GLB with morphs."""
import bpy, mathutils, sys, json, numpy as np

SRC = "/home/claude/blend_src/Blend/Freya.blend"
OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "/home/claude/web/freya.glb"
SHAPES_JSON = sys.argv[sys.argv.index("--shapes") + 1] if "--shapes" in sys.argv else "/home/claude/scripts/shapes.json"

bpy.ops.wm.open_mainfile(filepath=SRC)
rig = bpy.data.objects['rig']
pb = rig.pose.bones
V = mathutils.Vector
M = mathutils.Matrix

def reset_pose():
    for b in pb:
        b.location = (0, 0, 0)
        b.rotation_quaternion = (1, 0, 0, 0)
        b.rotation_euler = (0, 0, 0)
        b.scale = (1, 1, 1)
    bpy.context.view_layer.update()

def mirror_name(n):
    return n.replace('.L', '.__R').replace('.R', '.L').replace('.__R', '.R') if ('.L' in n or '.R' in n) else n

def apply_op(op, mirror=False):
    name = op['bone']
    if mirror: name = mirror_name(name)
    b = pb[name]
    if 'rot' in op:  # rotation about bone head, world axis, radians
        ax, ang = op['rot']
        h = b.matrix.translation.copy()
        b.matrix = M.Translation(h) @ M.Rotation(ang, 4, ax) @ M.Translation(-h) @ b.matrix
    if 'move' in op:  # mm, Blender world: +X = character left, -Y = front, +Z = up
        x, y, z = [c / 1000.0 for c in op['move']]
        if mirror: x = -x
        b.matrix = M.Translation(V((x, y, z))) @ b.matrix
    if 'scale' in op:
        s = op['scale']
        b.matrix = b.matrix @ M.Diagonal(V((s, s, s, 1)))
    bpy.context.view_layer.update()

FACE_MESHES = ['Body', 'Mouth', 'Eyebrows', 'Eyelashes', 'Eyes']

def eval_coords(name):
    o = bpy.data.objects[name]
    e = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = e.to_mesh()
    a = np.empty(len(m.vertices) * 3, dtype=np.float64)
    m.vertices.foreach_get('co', a)
    e.to_mesh_clear()
    return a.reshape(-1, 3)

shapes = json.load(open(SHAPES_JSON))
reset_pose()
rest = {n: eval_coords(n) for n in FACE_MESHES}
deltas = {}  # shape -> mesh -> delta
for sname, spec in shapes.items():
    reset_pose()
    for op in spec['ops']:
        apply_op(op, mirror=spec.get('mirror', False))
    deltas[sname] = {n: eval_coords(n) - rest[n] for n in FACE_MESHES}
    mx = {n: float(np.abs(d).max()) for n, d in deltas[sname].items()}
    print('SHAPE', sname, {k: round(v * 1000, 2) for k, v in mx.items()})
reset_pose()

# --- write shape keys
for n in FACE_MESHES:
    o = bpy.data.objects[n]
    base = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get('co', base); base = base.reshape(-1, 3)
    used = [s for s in shapes if np.abs(deltas[s][n]).max() > 2e-5]
    if not used: continue
    o.shape_key_add(name='Basis', from_mix=False)
    for s in shapes:  # keep same key set on every face mesh for a uniform dictionary
        k = o.shape_key_add(name=s, from_mix=False)
        d = deltas[s][n]; d[np.abs(d) < 2e-6] = 0
        k.data.foreach_set('co', (base + d).ravel())
        k.value = 0.0

# --- strip control rig & widgets, unbind Unity_Rig from it
ur = bpy.data.objects['Unity_Rig']
for b in ur.pose.bones:
    for c in list(b.constraints): b.constraints.remove(c)
for o in list(bpy.data.objects):
    if o.name in ('rig', 'metarig') or o.name.startswith('WGT') or (o.type not in ('MESH', 'ARMATURE')):
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
for b in ur.pose.bones:
    b.location = (0, 0, 0); b.rotation_quaternion = (1, 0, 0, 0); b.rotation_euler = (0, 0, 0); b.scale = (1, 1, 1)
bpy.context.view_layer.update()

# --- skirt: bake subdivision (no shape keys on it)
sk = bpy.data.objects['Skirt']
arm = [m for m in sk.modifiers if m.type == 'ARMATURE'][0]
arm.show_viewport = False
bpy.context.view_layer.update()
e = sk.evaluated_get(bpy.context.evaluated_depsgraph_get())
newm = bpy.data.meshes.new_from_object(e, preserve_all_data_layers=True, depsgraph=bpy.context.evaluated_depsgraph_get())
old = sk.data; sk.data = newm
for m in list(sk.modifiers):
    if m.type == 'SUBSURF': sk.modifiers.remove(m)
arm.show_viewport = True

# --- materials: simplify node graphs so the glTF exporter maps them cleanly
def tex_nodes(mat):
    return {n.image.name: n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}

def merge_alpha(mat, color_name, alpha_name):
    nt = mat.node_tree
    tn = tex_nodes(mat)
    c = bpy.data.images[color_name]; a = bpy.data.images[alpha_name]
    w, h = c.size
    if tuple(a.size) != (w, h): a.scale(w, h)
    cp = np.array(c.pixels[:]).reshape(-1, 4); ap = np.array(a.pixels[:]).reshape(-1, 4)
    cp[:, 3] = ap[:, 0]
    img = bpy.data.images.new(mat.name + '_BaseAlpha', w, h, alpha=True)
    img.pixels[:] = cp.ravel(); img.pack()
    node = tn[color_name]; node.image = img
    bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
    for l in list(bsdf.inputs['Alpha'].links): nt.links.remove(l)
    nt.links.new(node.outputs['Alpha'], bsdf.inputs['Alpha'])
    nt.nodes.remove(tn[alpha_name])

merge_alpha(bpy.data.materials['Hair'], 'Hair_09F39A_BaseColor.png', 'Hair-Alpha.png')
merge_alpha(bpy.data.materials['Cap'], 'Cap_09F39A_BaseColor.png', 'Cap-Alpha.png')
merge_alpha(bpy.data.materials['Stockings'], 'Stockings_7A61E1_BaseColor.png', 'Stockings_7A61E1_Alpha.png')

for mn in ('Eyebrows', 'Eyelashes'):
    mat = bpy.data.materials[mn]; nt = mat.node_tree
    bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
    col = [n for n in nt.nodes if n.type == 'TEX_IMAGE' and 'BaseColor' in n.image.name][0]
    for l in list(bsdf.inputs['Alpha'].links): nt.links.remove(l)
    nt.links.new(col.outputs['Alpha'], bsdf.inputs['Alpha'])

# Body: drop the micro-detail normal blend, feed the baked normal map straight in
mat = bpy.data.materials['Body']; nt = mat.node_tree
bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
nn = [n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image.name.startswith('Body_') and 'Normal' in n.image.name][0]
nmap = [n for n in nt.nodes if n.type == 'NORMAL_MAP' and n.inputs['Color'].links and n.inputs['Color'].links[0].from_node == nn][0]
for l in list(bsdf.inputs['Normal'].links): nt.links.remove(l)
nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
for n in list(nt.nodes):
    if n.type in ('VECT_MATH', 'MAPPING', 'TEX_COORD') or (n.type == 'TEX_IMAGE' and n.image and 'SkinMicro' in n.image.name):
        nt.nodes.remove(n)
for n in list(nt.nodes):
    if n.type == 'NORMAL_MAP' and n != nmap: nt.nodes.remove(n)

# --- texture budget for phones
LIMIT = {'Body_09F39A_BaseColor.png': 2048, 'Body_09F39A_Normal.png': 2048, 'Mouth_D39F27_BaseColor.png': 1024,
         'Eyes_AE6E9B_BaseColor.png': 1024}
for img in bpy.data.images:
    if img.size[0] == 0: continue
    lim = LIMIT.get(img.name, 1024)
    if 'Roughness' in img.name or 'Normal' in img.name and not img.name.startswith('Body_'): lim = min(lim, 1024)
    if img.size[0] > lim:
        img.scale(lim, lim)

# --- export
vl_names = {o.name for o in bpy.context.view_layer.objects}
for o in bpy.data.objects:
    if o.name not in vl_names:
        bpy.context.scene.collection.objects.link(o)
for lc in bpy.context.view_layer.layer_collection.children:
    lc.exclude = False
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    o.hide_set(False); o.hide_viewport = False; o.select_set(True)
print('EXPORT OBJECTS', [o.name for o in bpy.context.selected_objects])
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
                          export_morph=True, export_morph_normal=True, export_skins=True,
                          export_animations=False, export_def_bones=True, export_apply=False,
                          export_image_format='WEBP', export_image_quality=82,
                          export_yup=True, export_extras=False)
print('EXPORTED', OUT)
