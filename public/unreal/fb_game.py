# Ultimate Football in Unreal Engine - field + a live play simulation, run from inside the editor.
#   1. builds a brand-new EMPTY level (the field was buried under the open-world terrain before)
#   2. field, lights, 22 players (the real player model), football
#   3. runs plays from the web game's playbook with the web game's speeds / gravity, one after another, with a camera that follows the ball
# FIRST DRAFT, not tested inside Unreal. Lines starting [FB] FAIL tell us what to fix. Safe to run again.
# Controls (type in the Python box):  unreal.fb_play("DIVE")  -> run that play next     unreal.fb_stop() -> stop the simulation
import unreal, os, math, json, random

try:
    PACK_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace("\\", "/")
except NameError:
    PACK_DIR = "C:/UE/unreal_pack"
GAME_DIR = "/Game/Football"
MAP_PATH = GAME_DIR + "/Maps/FootballField"
YD = 91.44                     # 1 yard in centimetres
MODEL_YAW = -90.0              # if the players face sideways, change this number (try 0, 90, -90, 180)
PLAYER_CM = 188.0              # how tall to make the players
LOS = -20.0                    # line of scrimmage (yards, field centre = 0)
TS = 0.75                      # the web game moves players at 0.75 of their listed speed
GRAV = 18.0                    # the web game's gravity in yards/s^2

def log(m): unreal.log("[FB] " + str(m))
def V(x, y, z): return unreal.Vector(x, y, z)
def R(roll=0.0, pitch=0.0, yaw=0.0): return unreal.Rotator(roll=roll, pitch=pitch, yaw=yaw)
def step(name, fn):
    try:
        r = fn(); log("OK   " + name); return r
    except Exception as e:
        log("FAIL " + name + " -> " + repr(e)); return None

# =========================================================================================== the game logic (pure Python)
class Ent:
    def __init__(self, role, side, kind, x, z):
        self.role, self.side, self.kind = role, side, kind
        self.x, self.z, self.vx, self.vz = x, z, 0.0, 0.0
        self.x0, self.z0 = x, z
        self.route, self.ri, self.state = [], 0, "idle"
        self.blocked_until = 0.0
        self.rolled = False

SP = {"QB": 5.2, "OL": 6.2, "RB": 9.8, "TE": 9.45, "W": 10.1, "DL": 9.1, "LB": 8.7, "CB": 9.7, "S": 9.3}
RM = {"QB": 1.12, "RB": 1.06, "W1": 1.0, "W2": 0.93, "W3": 1.05, "TE": 0.97}
def top_speed(e):
    return SP.get(e.kind, 8.0) * RM.get(e.role, 1.0) * TS

OFF_OL = {"OL1": -4.4, "OL2": -2.2, "OL3": 0.0, "OL4": 2.2, "OL5": 4.4}
DEFENSE = {"DL1": (1, -4.5), "DL2": (1, -1.5), "DL3": (1, 1.5), "DL4": (1, 4.5), "LB1": (4.5, -5), "LB2": (4.5, 0), "LB3": (4.5, 5),
           "CB1": (6, -15.5), "CB2": (6, 15), "S1": (14, -6), "S2": (14, 6)}
MAN = {"CB1": "W1", "CB2": "W2", "S1": "W3", "LB1": "TE", "LB2": "RB"}

def kind_of(role):
    if role[:2] in ("OL", "DL", "LB", "CB"): return role[:2]
    if role[0] == "S": return "S"
    if role[0] == "W": return "W"
    return role

class Sim:
    def __init__(self, data, place, set_anim, set_ball, say):
        self.data, self.place, self.set_anim, self.set_ball, self.say = data, place, set_anim, set_ball, say
        self.all = {}
        self.queue = []
        self.force = None
        self.cam = [LOS - 22.0, 0.0]
        self.t, self.phase, self.dead_t = 0.0, "dead", 99.0
        self.msg = ""

    # ---------------------------------------------------------------- set up one play
    def pick_play(self):
        P = self.data["plays"]
        if self.force:
            for kind in ("pass", "run"):
                for p in P[kind]:
                    if p["n"].lower() == self.force.lower(): self.force = None; return kind, p
            self.say("no play called " + str(self.force)); self.force = None
        if not self.queue:
            self.queue = [("pass", p) for p in P["pass"]] + [("run", p) for p in P["run"] if not p.get("sneak")]
            random.shuffle(self.queue)
        return self.queue.pop()

    def setup(self):
        self.kind, self.play = self.pick_play()
        F = self.data["formations"]["shot" if self.kind == "pass" else "ifm"]
        self.all = {}
        for role, (dx, z) in F.items():
            e = Ent(role, "O", kind_of(role), LOS + dx, z); self.all[role] = e
        for role, z in OFF_OL.items(): self.all[role] = Ent(role, "O", "OL", LOS - 0.9, z)
        for role, (dx, z) in DEFENSE.items(): self.all[role] = Ent(role, "D", kind_of(role), LOS + dx, z)
        for role, e in self.all.items():
            e.vx = e.vz = 0.0; e.state = "idle"
            self.place(role, e.x, e.z, 0.0 if e.side == "O" else 180.0)
            self.set_anim(role, "idle")
        if self.kind == "pass":
            for role, pts in self.play.get("ro", {}).items():
                e = self.all.get(role)
                if e: e.route = [(LOS + dx, e.z0 + dz) for dx, dz in pts]
        else:
            rb = self.all["RB"]; rb.route = [(LOS + dx, dz) for dx, dz in self.play["run"]]
        self.qb = self.all["QB"]; self.ball_by = self.qb; self.carrier = None
        self.bx, self.bz, self.by, self.bvx, self.bvz, self.bvy = self.qb.x, self.qb.z, 1.4, 0.0, 0.0, 0.0
        self.flying, self.target, self.land_t = False, None, 0.0
        self.t, self.phase = 0.0, "pre"
        self.msg = ""
        self.say("PLAY: %s  (%s)" % (self.play["n"], self.kind))

    # ---------------------------------------------------------------- movement helper
    def go(self, e, tx, tz, speed, dt):
        dx, dz = tx - e.x, tz - e.z; d = math.hypot(dx, dz)
        if d < 1e-4: e.vx = e.vz = 0.0; return d
        s = min(speed, d / max(dt, 1e-4))
        e.vx, e.vz = dx / d * s, dz / d * s
        e.x += e.vx * dt; e.z += e.vz * dt
        return d

    def end(self, text):
        self.phase, self.dead_t, self.msg = "dead", 0.0, text
        self.say("RESULT: " + text)
        for e in self.all.values(): e.vx = e.vz = 0.0

    # ---------------------------------------------------------------- one frame
    def tick(self, dt):
        dt = min(dt, 0.1)
        if self.phase == "dead":
            self.dead_t += dt
            if self.dead_t > 2.6: self.setup()
        elif self.phase == "pre":
            self.t += dt
            if self.t > 1.2: self.phase, self.t = "live", 0.0
        else:
            self.t += dt
            if self.kind == "pass": self.live_pass(dt)
            else: self.live_run(dt)
        self.finish_frame(dt)

    def route_step(self, e, dt):
        if not e.route or e.ri >= len(e.route): e.vx = e.vz = 0.0; return
        tx, tz = e.route[e.ri]
        if self.go(e, tx, tz, top_speed(e), dt) < 0.25: e.ri += 1

    def defense_step(self, dt, pursue):
        for role, e in self.all.items():
            if e.side != "D": continue
            sp = top_speed(e)
            if pursue is None and self.kind == "run": e.vx = e.vz = 0.0; continue      # on a run the front holds until the play develops
            if pursue is not None:
                if e.kind == "DL" and self.kind == "pass" and self.carrier is None: continue
                slow = 0.25 if (e.kind == "DL" and self.t < e.blocked_until) else 1.0
                self.go(e, pursue.x + pursue.vx * 0.25, pursue.z + pursue.vz * 0.25, sp * (0.93 if self.kind == "pass" else 0.88) * slow, dt)
                continue
            if e.kind == "DL":                               # pass rush: heads for the QB unless an OL has him
                sp2 = sp * (0.25 if self.t < e.blocked_until else 1.0)
                self.go(e, self.qb.x, self.qb.z, sp2 * 0.95, dt)
            elif role in MAN and self.t > 0.3:                # man coverage: stay on his man
                r = self.all.get(MAN[role])
                if r: self.go(e, r.x + 0.9, r.z, sp * 0.97, dt)
            elif role == "S2":
                far = max([o.x for o in self.all.values() if o.side == "O" and o.kind in ("W", "TE")] + [LOS + 12])
                self.go(e, far + 6, 0.0, sp * 0.9, dt)
            elif role == "LB3":
                self.go(e, LOS + 6.5, self.qb.z, sp * 0.8, dt)

    def ol_dl_contact(self):
        for role, e in self.all.items():
            if e.kind == "DL" and not e.rolled and self.t >= e.blocked_until and self.t < 6:
                for o in self.all.values():
                    if o.kind == "OL" and math.hypot(o.x - e.x, o.z - e.z) < 1.3 and self.t > 0.2:
                        e.rolled = True; e.blocked_until = self.t + ((random.uniform(1.8, 3.0) if random.random() < 0.965 else 0.2) if self.kind == "pass" else random.uniform(2.0, 3.4)); break

    def live_pass(self, dt):
        if self.carrier is None and not self.flying: self.ol_dl_contact()
        for role, e in self.all.items():
            if e.side == "O" and e.kind in ("W", "TE", "RB") and self.t > 0.15 and e is not self.carrier: self.route_step(e, dt)
        if self.carrier is None:
            if not self.flying:
                q = self.qb
                self.go(q, q.x0 - 2.0, q.z0, top_speed(q), dt)
                if self.t >= 1.75: self.throw()
            self.defense_step(dt, None)
            q = self.qb
            if not self.flying:
                for e in self.all.values():
                    if e.kind == "DL" and math.hypot(e.x - q.x, e.z - q.z) < 1.1: self.end("SACK  for %d yd loss" % max(0, round(LOS - q.x))); return
            else:
                self.ball_step(dt)
        else:
            c = self.carrier
            c.state = "run"; self.go(c, c.x + 10, c.z * 0.9, top_speed(c) * 0.8, dt)
            self.defense_step(dt, c)
            self.check_tackle(c)

    def route_at(self, e, secs):                     # where this receiver will be after `secs`, following his route
        x, z, left, i = e.x, e.z, top_speed(e) * secs, e.ri
        while i < len(e.route) and left > 0:
            tx, tz = e.route[i]; d = math.hypot(tx - x, tz - z)
            if d <= left: x, z, left, i = tx, tz, left - d, i + 1
            else: x, z, left = x + (tx - x) / d * left, z + (tz - z) / d * left, 0
        return x, z

    def throw(self):
        q = self.qb
        cands = [e for e in self.all.values() if e.side == "O" and e.kind in ("W", "TE") and e.route]
        if not cands: cands = [self.all.get("W1") or self.all.get("TE")]
        def openness(e):
            ax, az = self.route_at(e, 1.2)
            return min(math.hypot(d.x - ax, d.z - az) for d in self.all.values() if d.side == "D") + random.uniform(0, 1.2)
        rec = max(cands, key=openness)
        d = math.hypot(rec.x - q.x, rec.z - q.z); tf = 0.8 + 0.045 * d
        for _ in range(4):
            ax, az = self.route_at(rec, tf)
            d = math.hypot(ax - q.x, az - q.z); tf = 0.8 + 0.045 * d
        self.bx, self.bz, self.by = q.x, q.z, 2.1
        self.bvx, self.bvz = (ax - self.bx) / tf, (az - self.bz) / tf
        self.bvy = (0.45 - self.by + 0.5 * GRAV * tf * tf) / tf
        self.flying, self.target, self.land_t = True, rec, self.t + tf
        self.say("THROW to %s  (%.0f yd, %.1f s in the air)" % (rec.role, d, tf))

    def ball_step(self, dt):
        self.bx += self.bvx * dt; self.bz += self.bvz * dt; self.by += self.bvy * dt; self.bvy -= GRAV * dt
        if self.t >= self.land_t: self.resolve_catch()

    def resolve_catch(self):
        self.flying = False
        offs = [e for e in self.all.values() if e.side == "O" and e.kind in ("W", "TE", "RB")]
        r = min(offs, key=lambda e: math.hypot(e.x - self.bx, e.z - self.bz))
        dr = math.hypot(r.x - self.bx, r.z - self.bz)
        dd = min(math.hypot(e.x - r.x, e.z - r.z) for e in self.all.values() if e.side == "D")
        if dr > 1.8: self.end("INCOMPLETE  (ball landed %.1f yd from the nearest receiver)" % dr); return
        if dd < 1.1 and random.random() < 0.4: self.end("INCOMPLETE  (broken up)"); return
        self.carrier = r; self.ball_by = r
        self.say("CATCH by %s at the %d" % (r.role, round(r.x - LOS)))

    def live_run(self, dt):
        if self.carrier is None and self.t >= 0.55:
            self.carrier = self.all["RB"]; self.ball_by = self.carrier; self.say("HANDOFF to RB")
        rb = self.all["RB"]
        if self.carrier is None:
            self.go(rb, rb.route[0][0] if rb.route else rb.x + 1, rb.route[0][1] if rb.route else rb.z, top_speed(rb) * 0.6, dt)
            return
        c = self.carrier; c.state = "run"
        if c.route and c.ri < len(c.route):
            if self.go(c, c.route[c.ri][0], c.route[c.ri][1], top_speed(c), dt) < 0.3: c.ri += 1
        else: self.go(c, c.x + 10, c.z, top_speed(c), dt)
        for e in self.all.values():                          # linemen drive their man
            if e.kind == "OL":
                tgt = min([d for d in self.all.values() if d.kind == "DL"], key=lambda d: math.hypot(d.x - e.x, d.z - e.z))
                self.go(e, tgt.x - 0.6, tgt.z, 3.0, dt)
        self.ol_dl_contact()
        self.defense_step(dt, c if self.t > 1.05 else None)
        self.check_tackle(c)

    def check_tackle(self, c):
        if c.x - LOS > 49.0: self.end("TOUCHDOWN!"); return
        for e in self.all.values():
            if e.side == "D" and math.hypot(e.x - c.x, e.z - c.z) < 1.0:
                self.end("TACKLED by %s after %+d yards" % (e.role, round(c.x - LOS))); return

    # ---------------------------------------------------------------- push positions out to Unreal
    def finish_frame(self, dt):
        for role, e in self.all.items():
            sp = math.hypot(e.vx, e.vz)
            yaw = math.degrees(math.atan2(e.vz, e.vx)) if sp > 0.3 else (0.0 if e.side == "O" else 180.0)
            if self.phase == "live" and sp < 0.3 and e.kind in ("OL", "DL"): yaw = 0.0 if e.side == "O" else 180.0
            st = "run" if sp > 1.2 else "idle"
            if st != e.state: e.state = st; self.set_anim(role, st)
            self.place(role, e.x, e.z, yaw)
        b = self.ball_by
        if not self.flying:
            self.bx, self.bz, self.by = b.x + 0.25, b.z, 1.3
        self.set_ball(self.bx, self.bz, self.by)
        fx = (self.carrier.x if self.carrier is not None else (self.bx if self.flying else self.qb.x))
        self.cam[0] += ((fx - 22.0) - self.cam[0]) * min(1.0, dt * 2.5)
        self.cam[1] += ((self.qb.z * 0.3) - self.cam[1]) * min(1.0, dt * 2.0)

# =========================================================================================== Unreal side
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
tools = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary

def assets_of(folder, cls):
    out = []
    for p in eal.list_assets(folder, recursive=True, include_folder=False):
        a = eal.load_asset(p)
        if a is not None and isinstance(a, cls): out.append(a)
    return out

def import_fbx(path, dest, skeleton=None):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", path); task.set_editor_property("destination_path", dest)
    task.set_editor_property("automated", True); task.set_editor_property("replace_existing", True); task.set_editor_property("save", True)
    ui = unreal.FbxImportUI()
    if skeleton is None:
        ui.set_editor_property("import_mesh", True); ui.set_editor_property("import_as_skeletal", True); ui.set_editor_property("import_animations", True)
        ui.set_editor_property("import_materials", True); ui.set_editor_property("import_textures", True)
        ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_SKELETAL_MESH)
    else:
        ui.set_editor_property("import_mesh", False); ui.set_editor_property("import_animations", True)
        ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_ANIMATION); ui.set_editor_property("skeleton", skeleton)
    task.set_editor_property("options", ui)
    tools.import_asset_tasks([task])

def ensure_assets():
    if not assets_of(GAME_DIR + "/Players", unreal.SkeletalMesh):
        import_fbx(PACK_DIR + "/assets/football_player_base.fbx", GAME_DIR + "/Players")
    meshes = assets_of(GAME_DIR + "/Players", unreal.SkeletalMesh)
    if meshes and not assets_of(GAME_DIR + "/Animations", unreal.AnimSequence):
        sk = meshes[0].get_editor_property("skeleton"); clips = PACK_DIR + "/assets/clips_extra"
        if os.path.isdir(clips):
            for f in sorted(os.listdir(clips)):
                if f.lower().endswith(".fbx"): import_fbx(clips + "/" + f, GAME_DIR + "/Animations", sk)
    log("meshes: %s | animations: %s" % ([m.get_name() for m in meshes], [a.get_name() for a in assets_of(GAME_DIR, unreal.AnimSequence)]))
step("player + animations (imports only if missing)", ensure_assets)

def new_level():
    try:
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    except Exception:
        unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).new_level(MAP_PATH)
step("brand-new empty level", new_level)

def color_material(name, rgb, rough=0.9):
    path = GAME_DIR + "/Materials"; full = path + "/" + name
    if eal.does_asset_exist(full): return eal.load_asset(full)
    mat = tools.create_asset(name, path, unreal.Material, unreal.MaterialFactoryNew())
    c = mel.create_material_expression(mat, unreal.MaterialExpressionConstant3Vector, -300, 0)
    c.set_editor_property("constant", unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1.0))
    mel.connect_material_property(c, "", unreal.MaterialProperty.MP_BASE_COLOR)
    r = mel.create_material_expression(mat, unreal.MaterialExpressionConstant, -300, 200); r.set_editor_property("r", rough)
    mel.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(mat); return mat

def spawn_box(mesh_path, loc, scale, mat, label):
    a = eas.spawn_actor_from_class(unreal.StaticMeshActor, loc, R())
    a.static_mesh_component.set_static_mesh(eal.load_asset(mesh_path)); a.set_actor_scale3d(scale)
    a.static_mesh_component.set_material(0, mat); a.set_actor_label(label); return a

def build_field():
    grass = color_material("M_Grass", (0.04, 0.22, 0.05)); grass2 = color_material("M_Grass2", (0.05, 0.27, 0.06))
    white = color_material("M_White", (0.9, 0.9, 0.9)); blue = color_material("M_EndBlue", (0.05, 0.12, 0.45)); red = color_material("M_EndRed", (0.5, 0.06, 0.06))
    PLANE, CUBE = "/Engine/BasicShapes/Plane", "/Engine/BasicShapes/Cube"; W = 53.333 * YD
    spawn_box(PLANE, V(0, 0, 0), V(130 * YD / 100, (W + 20 * YD) / 100, 1), color_material("M_Dirt", (0.03, 0.1, 0.03)), "FB_Surround")
    spawn_box(PLANE, V(0, 0, 1), V(100 * YD / 100, W / 100, 1), grass, "FB_Turf")
    for i in range(20):
        if i % 2 == 0: spawn_box(PLANE, V((-47.5 + i * 5) * YD, 0, 1.5), V(5 * YD / 100, W / 100, 1), grass2, "FB_Stripe%d" % i)
    spawn_box(PLANE, V(55 * YD, 0, 2), V(10 * YD / 100, W / 100, 1), red, "FB_EndZoneA")
    spawn_box(PLANE, V(-55 * YD, 0, 2), V(10 * YD / 100, W / 100, 1), blue, "FB_EndZoneB")
    for x in range(-50, 51, 5): spawn_box(CUBE, V(x * YD, 0, 3), V(0.12, W / 100, 0.02), white, "FB_Line%d" % x)
    for s in (-1, 1): spawn_box(CUBE, V(0, s * W / 2, 3), V(100 * YD / 100, 0.12, 0.02), white, "FB_Side%d" % s)
step("field (above the ground this time)", build_field)

def build_lights():
    def sp(cls, loc, rot, label):
        a = eas.spawn_actor_from_class(cls, loc, rot); a.set_actor_label(label); return a
    sp(unreal.DirectionalLight, V(0, 0, 3000), R(0, -48, 35), "FB_Sun")
    sp(unreal.SkyAtmosphere, V(0, 0, 0), R(), "FB_Atmosphere"); sp(unreal.SkyLight, V(0, 0, 500), R(), "FB_SkyLight")
    sp(unreal.ExponentialHeightFog, V(0, 0, 0), R(), "FB_Fog")
    sp(unreal.PostProcessVolume, V(0, 0, 0), R(), "FB_PostProcess").set_editor_property("unbound", True)
step("lights and sky", build_lights)

PUPPETS, BALL, ANIMS = {}, [None], {}
def pick_anim(anims, words):
    for w in words:
        for a in anims:
            if w in a.get_name().lower(): return a
    return anims[0] if anims else None

def make_puppets():
    meshes = assets_of(GAME_DIR + "/Players", unreal.SkeletalMesh)
    if not meshes: raise RuntimeError("no skeletal mesh found in " + GAME_DIR + "/Players")
    mesh = meshes[0]; scale = 1.0
    try:
        h = mesh.get_bounds().box_extent.z * 2.0
        if h > 10: scale = PLAYER_CM / h
    except Exception as e:
        log("could not measure the model, using scale 1 (" + repr(e) + ")")
    anims = assets_of(GAME_DIR, unreal.AnimSequence)
    ANIMS["idle"] = pick_anim(anims, ["stance", "offenseidle", "idle"]); ANIMS["run"] = pick_anim(anims, ["fastrun", "run", "jog"])
    log("model scale %.2f, idle=%s, run=%s" % (scale, ANIMS["idle"].get_name() if ANIMS["idle"] else None, ANIMS["run"].get_name() if ANIMS["run"] else None))
    roles = ["QB", "RB", "TE", "W1", "W2", "W3"] + list(OFF_OL) + list(DEFENSE)
    for role in roles:
        a = eas.spawn_actor_from_class(unreal.SkeletalMeshActor, V(0, 0, 0), R()); a.set_actor_label("FB_P_" + role)
        comp = a.skeletal_mesh_component
        try: comp.set_skeletal_mesh_asset(mesh)
        except Exception: comp.set_skeletal_mesh(mesh)
        a.set_actor_scale3d(V(scale, scale, scale))
        comp.set_animation_mode(unreal.AnimationMode.ANIMATION_SINGLE_NODE)
        PUPPETS[role] = a
    b = eas.spawn_actor_from_class(unreal.StaticMeshActor, V(0, 0, 100), R()); b.set_actor_label("FB_Ball")
    b.static_mesh_component.set_static_mesh(eal.load_asset("/Engine/BasicShapes/Sphere")); b.set_actor_scale3d(V(0.32, 0.2, 0.2))
    b.static_mesh_component.set_material(0, color_material("M_Ball", (0.25, 0.09, 0.03))); BALL[0] = b
step("22 players + football", make_puppets)

def place(role, x, z, yaw):
    a = PUPPETS.get(role)
    if a: a.set_actor_location_and_rotation(V(x * YD, z * YD, 2), R(0, 0, yaw + MODEL_YAW), False, True)
def set_anim(role, st):
    a = PUPPETS.get(role); an = ANIMS.get(st) or ANIMS.get("idle")
    if a and an:
        try: a.skeletal_mesh_component.play_animation(an, True)
        except Exception: pass
def set_ball(x, z, y):
    if BALL[0]: BALL[0].set_actor_location(V(x * YD, z * YD, y * YD), False, True)

SIM = [None]; HANDLE = [None]
def start_sim():
    data = json.load(open(PACK_DIR + "/data/plays.json"))
    if HANDLE[0] is not None:
        try: unreal.unregister_slate_post_tick_callback(HANDLE[0])
        except Exception: pass
    sim = Sim(data, place, set_anim, set_ball, log); SIM[0] = sim; sim.setup()
    def on_tick(dt):
        try:
            sim.tick(dt)
            unreal.EditorLevelLibrary.set_level_viewport_camera_info(V(sim.cam[0] * YD, sim.cam[1] * YD, 6.5 * YD), R(0, -13, 0))
        except Exception as e:
            log("FAIL in the play loop -> " + repr(e)); stop()
    HANDLE[0] = unreal.register_slate_post_tick_callback(on_tick)
def stop():
    if HANDLE[0] is not None:
        try: unreal.unregister_slate_post_tick_callback(HANDLE[0])
        except Exception: pass
        HANDLE[0] = None; log("simulation stopped")
def fb_play(name):
    if SIM[0]: SIM[0].force = name; SIM[0].phase, SIM[0].dead_t = "dead", 99.0; log("next play: " + str(name))
unreal.fb_stop = stop; unreal.fb_play = fb_play
step("start the live play simulation", start_sim)
step("save the level", lambda: unreal.EditorLoadingAndSavingUtils.save_map(unreal.EditorLevelLibrary.get_editor_world(), MAP_PATH))
log("DONE. Plays now run by themselves: watch the viewport (click it so it is active). unreal.fb_play(\"DIVE\") picks a play, unreal.fb_stop() stops. Send Claude a screenshot and any FAIL lines.")
