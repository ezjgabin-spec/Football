# Adds the C++ part (an empty game module) to this Unreal project, WITHOUT the "New C++ Class" dialog.
# Run it inside the Unreal editor's Python box. Then close Unreal and re-open the project: it will offer to build the module.
import unreal, os, json, shutil

proj_file = unreal.Paths.convert_relative_path_to_full(unreal.Paths.get_project_file_path()).replace("\\", "/")
proj_dir = os.path.dirname(proj_file)
NAME = os.path.splitext(os.path.basename(proj_file))[0]          # e.g. MyProject2
src = proj_dir + "/Source"
print("[FB] project:", proj_file, "| module name:", NAME)

FILES = {
 "Source/%s.Target.cs" % NAME: """using UnrealBuildTool;
using System.Collections.Generic;

public class %(N)sTarget : TargetRules
{
	public %(N)sTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("%(N)s");
	}
}
""",
 "Source/%sEditor.Target.cs" % NAME: """using UnrealBuildTool;
using System.Collections.Generic;

public class %(N)sEditorTarget : TargetRules
{
	public %(N)sEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("%(N)s");
	}
}
""",
 "Source/%s/%s.Build.cs" % (NAME, NAME): """using UnrealBuildTool;

public class %(N)s : ModuleRules
{
	public %(N)s(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore" });
	}
}
""",
 "Source/%s/%s.h" % (NAME, NAME): """#pragma once

#include "CoreMinimal.h"
""",
 "Source/%s/%s.cpp" % (NAME, NAME): """#include "%(N)s.h"
#include "Modules/ModuleManager.h"

IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, %(N)s, "%(N)s");
""",
}

if os.path.isdir(src) and os.listdir(src):
    print("[FB] Source folder already exists, nothing to add:", os.listdir(src))
else:
    for rel, text in FILES.items():
        path = proj_dir + "/" + rel
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", newline="\n") as f: f.write(text % {"N": NAME})
        print("[FB] wrote", rel)
    shutil.copyfile(proj_file, proj_file + ".bak")
    with open(proj_file, "r", encoding="utf-8") as f: data = json.load(f)
    mods = data.get("Modules", [])
    if not any(m.get("Name") == NAME for m in mods):
        mods.append({"Name": NAME, "Type": "Runtime", "LoadingPhase": "Default", "AdditionalDependencies": ["Engine"]})
    data["Modules"] = mods
    with open(proj_file, "w", encoding="utf-8") as f: json.dump(data, f, indent="\t")
    print("[FB] updated the .uproject (a backup is next to it as .uproject.bak)")
print("[FB] DONE. Now CLOSE Unreal completely, then double-click", NAME + ".uproject", "in the folder", proj_dir, "- when it asks to build the missing module, click YES.")
