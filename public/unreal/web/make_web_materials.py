# Ultimate Football for Unreal - creates the 4 materials the live game scene is drawn with. Run by run_game.ps1 (no need to open the editor).
import unreal
def log(m): unreal.log("[FBM] " + str(m))
try:
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    PATH = "/Game/Football/Web"
    WHITE = unreal.load_asset("/Engine/EngineResources/WhiteSquareTexture")
    MP = unreal.MaterialProperty

    def make(name, blend, unlit):
        full = PATH + "/" + name
        if eal.does_asset_exist(full):
            eal.delete_asset(full)
        mat = tools.create_asset(name, PATH, unreal.Material, unreal.MaterialFactoryNew())
        mat.set_editor_property("two_sided", True)
        if blend == "masked": mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
        if blend == "trans": mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
        if blend == "add": mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
        if unlit: mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)

        tex = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, -1000, 0)
        tex.set_editor_property("parameter_name", "Tex")
        if WHITE: tex.set_editor_property("texture", WHITE)
        try:
            # texture scale + offset (scrolling ad boards, tiled textures): UV * UVS.rg + UVO.rg
            tc = mel.create_material_expression(mat, unreal.MaterialExpressionTextureCoordinate, -1900, 0)
            uvs = mel.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, -1900, 150)
            uvs.set_editor_property("parameter_name", "UVS")
            uvs.set_editor_property("default_value", unreal.LinearColor(1.0, 1.0, 0.0, 0.0))
            uvo = mel.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, -1900, 400)
            uvo.set_editor_property("parameter_name", "UVO")
            uvo.set_editor_property("default_value", unreal.LinearColor(0.0, 0.0, 0.0, 0.0))
            ms = mel.create_material_expression(mat, unreal.MaterialExpressionComponentMask, -1650, 150)
            mo = mel.create_material_expression(mat, unreal.MaterialExpressionComponentMask, -1650, 400)
            for mk in (ms, mo):
                mk.set_editor_property("r", True); mk.set_editor_property("g", True); mk.set_editor_property("b", False); mk.set_editor_property("a", False)
            mel.connect_material_expressions(uvs, "", ms, "")
            mel.connect_material_expressions(uvo, "", mo, "")
            mu = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -1450, 50)
            mel.connect_material_expressions(tc, "", mu, "A")
            mel.connect_material_expressions(ms, "", mu, "B")
            ad = mel.create_material_expression(mat, unreal.MaterialExpressionAdd, -1250, 100)
            mel.connect_material_expressions(mu, "", ad, "A")
            mel.connect_material_expressions(mo, "", ad, "B")
            mel.connect_material_expressions(ad, "", tex, "UVs")
        except Exception as e2:
            log("WARN uv transform not added to " + name + ": " + repr(e2))
        tint = mel.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, -1000, 260)
        tint.set_editor_property("parameter_name", "Tint")
        tint.set_editor_property("default_value", unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
        usevc = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -1000, 480)
        usevc.set_editor_property("parameter_name", "UseVC")
        usevc.set_editor_property("default_value", 0.0)
        vc = mel.create_material_expression(mat, unreal.MaterialExpressionVertexColor, -1000, 600)
        one = mel.create_material_expression(mat, unreal.MaterialExpressionConstant3Vector, -1000, 760)
        one.set_editor_property("constant", unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
        lerp = mel.create_material_expression(mat, unreal.MaterialExpressionLinearInterpolate, -700, 600)
        mel.connect_material_expressions(one, "", lerp, "A")
        mel.connect_material_expressions(vc, "", lerp, "B")
        mel.connect_material_expressions(usevc, "", lerp, "Alpha")
        m1 = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -700, 100)
        mel.connect_material_expressions(tex, "RGB", m1, "A")
        mel.connect_material_expressions(tint, "", m1, "B")
        m2 = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -450, 200)
        mel.connect_material_expressions(m1, "", m2, "A")
        mel.connect_material_expressions(lerp, "", m2, "B")

        opa = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -1000, 900)
        opa.set_editor_property("parameter_name", "Opacity")
        opa.set_editor_property("default_value", 1.0)
        ma = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -700, 900)
        mel.connect_material_expressions(tex, "A", ma, "A")
        mel.connect_material_expressions(opa, "", ma, "B")

        emis = mel.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, -1000, 1100)
        emis.set_editor_property("parameter_name", "Emis")
        emis.set_editor_property("default_value", unreal.LinearColor(0.0, 0.0, 0.0, 1.0))
        rough = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -1000, 1300)
        rough.set_editor_property("parameter_name", "Rough")
        rough.set_editor_property("default_value", 0.9)
        metal = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -1000, 1400)
        metal.set_editor_property("parameter_name", "Metal")
        metal.set_editor_property("default_value", 0.0)

        if unlit:
            mel.connect_material_property(m2, "", MP.MP_EMISSIVE_COLOR)
        else:
            mel.connect_material_property(m2, "", MP.MP_BASE_COLOR)
            mel.connect_material_property(emis, "", MP.MP_EMISSIVE_COLOR)
            mel.connect_material_property(rough, "", MP.MP_ROUGHNESS)
            mel.connect_material_property(metal, "", MP.MP_METALLIC)
        if blend == "masked": mel.connect_material_property(ma, "", MP.MP_OPACITY_MASK)
        if blend in ("trans", "add"): mel.connect_material_property(ma, "", MP.MP_OPACITY)
        mel.recompile_material(mat)
        eal.save_asset(full, only_if_is_dirty=False)
        log("OK " + name)

    make("M_FbLit", "opaque", False)
    make("M_FbUnlit", "opaque", True)
    make("M_FbMasked", "masked", False)
    make("M_FbTrans", "trans", True)
    make("M_FbAdd", "add", True)
    log("DONE")
except Exception as e:
    log("FAIL " + repr(e))
