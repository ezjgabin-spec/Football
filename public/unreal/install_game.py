# Ultimate Football for Unreal - installs the playable game (C++) into this project.
# Run it inside the Unreal editor's Python box. Then CLOSE Unreal, re-open the project, click YES to build, press Play.
import unreal, os, re, urllib.request

BASE = "https://raw.githubusercontent.com/ezjgabin-spec/Football/main/public/unreal/cpp/"
FILES = ["FbData.h", "FbSim.h", "FbSim.cpp", "FbMatch.h", "FbMatch.cpp", "FbHUD.h", "FbHUD.cpp", "FbPC.h", "FbPC.cpp", "FbGameMode.h", "FbGameMode.cpp"]
MAP = "/Game/Football/Maps/FootballField"

proj_file = unreal.Paths.convert_relative_path_to_full(unreal.Paths.get_project_file_path()).replace("\\", "/")
proj_dir = os.path.dirname(proj_file)
NAME = os.path.splitext(os.path.basename(proj_file))[0]
API = NAME.upper() + "_API"
src = proj_dir + "/Source/" + NAME
print("[FB] project:", proj_file, "| module:", NAME)

def fetch(name):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=60).read().decode("utf-8")

ok = True
if not os.path.isdir(src):
    print("[FB] FAIL no Source/" + NAME + " folder. Run install_cpp.py first (the empty C++ module).")
    ok = False
if ok:
    for f in FILES:
        try:
            text = fetch(f).replace("FBGAME_API", API)
            with open(src + "/" + f, "w", newline="\n") as fh: fh.write(text)
            print("[FB] OK   wrote", f, "(%d bytes)" % len(text))
        except Exception as e:
            print("[FB] FAIL", f, "->", repr(e)); ok = False
if ok:
    build_cs = '''using UnrealBuildTool;

public class %s : ModuleRules
{
	public %s(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "AssetRegistry" });
	}
}
''' % (NAME, NAME)
    with open(src + "/" + NAME + ".Build.cs", "w", newline="\n") as fh: fh.write(build_cs)
    print("[FB] OK   Build.cs now lists AssetRegistry")

    # make this game the project's default (game mode + start level)
    ini = proj_dir + "/Config/DefaultEngine.ini"
    text = open(ini, encoding="utf-8").read() if os.path.exists(ini) else ""
    sec = "[/Script/EngineSettings.GameMapsSettings]"
    want = {
        "GlobalDefaultGameMode": "/Script/%s.FbGameMode" % NAME,
        "GameDefaultMap": MAP + ".FootballField",
        "EditorStartupMap": MAP + ".FootballField",
    }
    lines = text.splitlines()
    if sec not in [l.strip() for l in lines]:
        lines += ["", sec]
    out, insec, done = [], False, False
    for l in lines:
        s = l.strip()
        if s.startswith("["):
            insec = (s == sec)
            out.append(l)
            if insec:
                for k, v in want.items(): out.append("%s=%s" % (k, v))
                done = True
            continue
        if insec and any(s.startswith(k + "=") for k in want): continue
        out.append(l)
    with open(ini, "w", encoding="utf-8", newline="\n") as fh: fh.write("\n".join(out) + "\n")
    print("[FB] OK   DefaultEngine.ini: game mode = FbGameMode, start level = FootballField")
    if not unreal.EditorAssetLibrary.does_asset_exist(MAP):
        print("[FB] WARNING the level", MAP, "does not exist yet - run the fb_game.py script once first (it builds the field).")
    print("[FB] DONE. Now CLOSE Unreal completely, double-click", NAME + ".uproject", "again, click YES when it asks to build, then press the green PLAY button.")
else:
    print("[FB] Something failed above - send me the [FB] lines.")
