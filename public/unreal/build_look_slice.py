# Ultimate Football - first look slice for Unreal Engine 5.
# Run INSIDE the Unreal editor (Output Log: change the "Cmd" box to "Python", or Tools > Execute Python Script).
# Needs the plugin: Edit > Plugins > "Python Editor Script Plugin" (enable, restart the editor).
# It imports the player + animations, builds a football field, lights it, lines up 22 players, and puts the camera behind the offense.
# FIRST DRAFT, NOT TESTED INSIDE UNREAL. If a step errors, fix that step and re-run (it is safe to run again).
import unreal, os, math

try:                                       # the pack folder is the parent of the folder this script sits in - nothing to edit
    PACK_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
except NameError:
    PACK_DIR = "C:/UE/unreal_pack"       # only used if Unreal does not tell the script where it is: set this to your unreal_pack folder
GAME_DIR = "/Game/Football"
YD = 91.44                                # 1 yard in Unreal centimetres
LOS_X = -20 * YD                          # line of scrimmage, 20 yards short of midfield

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
tools = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary

def log(m): unreal.log("[FB] " + str(m))
def V(x, y, z): return unreal.Vector(x, y, z)
def R(roll=0.0, pitch=0.0, yaw=0.0): return unreal.Rotator(roll=roll, pitch=pitch, yaw=yaw)

def step(name, fn):
    try:
        r = fn(); log("OK   " + name); return r
    except Exception as e:
        log("FAIL " + name + " -> " + repr(e)); return None

# ---------------------------------------------------------------- 1. import the player and animations
def import_fbx(path, dest, skeleton=None):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", path)
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    ui = unreal.FbxImportUI()
    if skeleton is None:
        ui.set_editor_property("import_mesh", True)
        ui.set_editor_property("import_as_skeletal", True)
        ui.set_editor_property("import_animations", True)
        ui.set_editor_property("import_materials", True)
        ui.set_editor_property("import_textures", True)
        ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_SKELETAL_MESH)
    else:
        ui.set_editor_property("import_mesh", False)
        ui.set_editor_property("import_animations", True)
        ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_ANIMATION)
        ui.set_editor_property("skeleton", skeleton)
    task.set_editor_property("options", ui)
    tools.import_asset_tasks([task])
    return list(task.get_editor_property("imported_object_paths"))

def assets_of(folder, cls):
    out = []
    for p in eal.list_assets(folder, recursive=True, include_folder=False):
        a = eal.load_asset(p)
        if a is not None and isinstance(a, cls): out.append(a)
    return out

def do_import():
    import_fbx(PACK_DIR + "/assets/football_player_base.fbx", GAME_DIR + "/Players")
    meshes = assets_of(GAME_DIR + "/Players", unreal.SkeletalMesh)
    log("skeletal meshes: " + ", ".join(m.get_name() for m in meshes))
    if meshes:
        sk = meshes[0].get_editor_property("skeleton")
        clips = PACK_DIR + "/assets/clips_extra"
        if os.path.isdir(clips):
            for f in sorted(os.listdir(clips)):
                if f.lower().endswith(".fbx"): import_fbx(clips + "/" + f, GAME_DIR + "/Animations", sk)
    anims = assets_of(GAME_DIR, unreal.AnimSequence)
    log("animations: " + ", ".join(a.get_name() for a in anims))
step("import player + animations", do_import)

# ---------------------------------------------------------------- 2. materials
def color_material(name, rgb, rough=0.9):
    path = GAME_DIR + "/Materials"; full = path + "/" + name
    if eal.does_asset_exist(full): return eal.load_asset(full)
    mat = tools.create_asset(name, path, unreal.Material, unreal.MaterialFactoryNew())
    c = mel.create_material_expression(mat, unreal.MaterialExpressionConstant3Vector, -300, 0)
    c.set_editor_property("constant", unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1.0))
    mel.connect_material_property(c, "", unreal.MaterialProperty.MP_BASE_COLOR)
    r = mel.create_material_expression(mat, unreal.MaterialExpressionConstant, -300, 200)
    r.set_editor_property("r", rough)
    mel.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(mat)
    return mat

# ---------------------------------------------------------------- 3. the field
def spawn_box(mesh_path, loc, scale, mat, label):
    a = eas.spawn_actor_from_class(unreal.StaticMeshActor, loc, R())
    a.static_mesh_component.set_static_mesh(eal.load_asset(mesh_path))
    a.set_actor_scale3d(scale); a.static_mesh_component.set_material(0, mat); a.set_actor_label(label)
    return a

def build_field():
    for a in eas.get_all_level_actors():
        if a.get_actor_label().startswith("FB_"): eas.destroy_actor(a)
    grass = color_material("M_Grass", (0.04, 0.22, 0.05)); grass2 = color_material("M_Grass2", (0.05, 0.26, 0.06))
    white = color_material("M_White", (0.9, 0.9, 0.9)); blue = color_material("M_EndBlue", (0.05, 0.12, 0.45)); red = color_material("M_EndRed", (0.5, 0.06, 0.06))
    PLANE, CUBE = "/Engine/BasicShapes/Plane", "/Engine/BasicShapes/Cube"
    W = 53.333 * YD
    spawn_box(PLANE, V(0, 0, 0), V(100 * YD / 100, W / 100 + 0.5, 1), grass, "FB_Turf")              # 100 yd of field (+ run-off)
    for i in range(20):                                                                                  # mowing stripes every 5 yd
        if i % 2 == 0: spawn_box(PLANE, V((-47.5 + i * 5) * YD, 0, 0.5), V(5 * YD / 100, W / 100, 1), grass2, "FB_Stripe%d" % i)
    spawn_box(PLANE, V(55 * YD, 0, 0.6), V(10 * YD / 100, W / 100, 1), red, "FB_EndZoneA")
    spawn_box(PLANE, V(-55 * YD, 0, 0.6), V(10 * YD / 100, W / 100, 1), blue, "FB_EndZoneB")
    for x in range(-50, 51, 5):                                                                          # yard lines every 5 yd
        spawn_box(CUBE, V(x * YD, 0, 2), V(0.12, W / 100, 0.02), white, "FB_Line%d" % x)
    for sgn in (-1, 1): spawn_box(CUBE, V(0, sgn * W / 2, 2), V(100 * YD / 100, 0.12, 0.02), white, "FB_Sideline%d" % sgn)   # sidelines
    for x in range(-45, 46, 1):                                                                          # hash marks
        if x % 5 != 0:
            for sgn in (-1, 1): spawn_box(CUBE, V(x * YD, sgn * 3.083 * YD, 2), V(0.04, 0.5, 0.02), white, "FB_Hash%d_%d" % (x, sgn))
step("build field", build_field)

# ---------------------------------------------------------------- 4. lights, sky, fog
def build_lights():
    for a in eas.get_all_level_actors():
        if a.get_actor_label().startswith("FB_Light"): eas.destroy_actor(a)
    def sp(cls, loc, rot, label):
        a = eas.spawn_actor_from_class(cls, loc, rot); a.set_actor_label(label); return a
    sun = sp(unreal.DirectionalLight, V(0, 0, 3000), R(0, -48, 35), "FB_Light_Sun")
    sp(unreal.SkyAtmosphere, V(0, 0, 0), R(), "FB_Light_Atmosphere")
    sp(unreal.SkyLight, V(0, 0, 500), R(), "FB_Light_Sky")
    sp(unreal.ExponentialHeightFog, V(0, 0, 0), R(), "FB_Light_Fog")
    ppv = sp(unreal.PostProcessVolume, V(0, 0, 0), R(), "FB_Light_PostProcess")
    ppv.set_editor_property("unbound", True)
step("lights and sky", build_lights)

# ---------------------------------------------------------------- 5. 22 players
# (x = yards from the line of scrimmage, downfield is +, z = yards across the field). Approximate for the look test; the real positions come from the game data later.
OFFENSE = {"QB": (-5, 0), "RB": (-5, 2.4), "TE": (-0.9, 6.4), "W1": (-0.6, -15.5), "W2": (-0.6, 15), "W3": (-1.2, -8.5),
           "LT": (-0.9, -4.4), "LG": (-0.9, -2.2), "C": (-0.9, 0), "RG": (-0.9, 2.2), "RT": (-0.9, 4.4)}
DEFENSE = {"DE1": (1, -4.5), "DT1": (1, -1.5), "DT2": (1, 1.5), "DE2": (1, 4.5), "LB1": (4.5, -5), "LB2": (4.5, 0), "LB3": (4.5, 5),
           "CB1": (6, -15.5), "CB2": (6, 15), "S1": (14, -6), "S2": (14, 6)}

def pick_anim(anims, words):
    for w in words:
        for a in anims:
            if w in a.get_name().lower(): return a
    return anims[0] if anims else None

def build_players():
    for a in eas.get_all_level_actors():
        if a.get_actor_label().startswith("FB_P_"): eas.destroy_actor(a)
    meshes = assets_of(GAME_DIR + "/Players", unreal.SkeletalMesh)
    if not meshes: raise RuntimeError("no skeletal mesh was imported - run the import step first and check the Output Log")
    mesh = meshes[0]
    anims = assets_of(GAME_DIR, unreal.AnimSequence)
    idle = pick_anim(anims, ["stance", "offenseidle", "idle"])
    def place(role, pos, yaw):
        loc = V(LOS_X + pos[0] * YD, pos[1] * YD, 0)
        a = eas.spawn_actor_from_class(unreal.SkeletalMeshActor, loc, R(0, 0, yaw))
        a.set_actor_label("FB_P_" + role)
        comp = a.skeletal_mesh_component
        try: comp.set_skeletal_mesh_asset(mesh)
        except Exception: comp.set_skeletal_mesh(mesh)
        if idle:
            comp.set_animation_mode(unreal.AnimationMode.ANIMATION_SINGLE_NODE)
            comp.set_animation(idle); comp.play(True)
    for role, pos in OFFENSE.items(): place(role, pos, 0)       # offense faces downfield (+X)
    for role, pos in DEFENSE.items(): place(role, pos, 180)     # defense faces the offense
    log("players placed: %d (animation used: %s)" % (len(OFFENSE) + len(DEFENSE), idle.get_name() if idle else "none"))
step("22 players", build_players)

# ---------------------------------------------------------------- 6. camera and save
def camera():
    unreal.EditorLevelLibrary.set_level_viewport_camera_info(V(LOS_X - 24 * YD, 0, 7.5 * YD), R(0, -17, 0))
step("viewport camera behind the offense", camera)
step("save", lambda: unreal.EditorLevelLibrary.save_current_level())
log("DONE. Press Play (Alt+P) or fly around the viewport. Send Claude a screenshot and any lines above that start with FAIL.")
