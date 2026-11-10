#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "UObject/Object.h"
#include "IWebBrowserWindow.h"
#include "FbWebGame.generated.h"

class SWebBrowser;
class FJsonObject;
class FFbKeyTap;
class AFbWebGame;
class UProceduralMeshComponent;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UTexture2D;
class ACameraActor;
class USceneComponent;

// The web game talks to Unreal through this object: in the page it is window.ue.fb
UCLASS()
class FBGAME_API UFbBridge : public UObject
{
	GENERATED_BODY()
public:
	UFUNCTION() void Report(FString Msg);        // window.ue.fb.report("text")  -> written to the Unreal log as [FB] ...
	UFUNCTION() void Asset(FString Data);        // window.ue.fb.asset(json)     -> a mesh, a texture or a material (sent once)
	UFUNCTION() void Frame(FString Data);        // window.ue.fb.frame(json)     -> this frame: camera, what is visible, where everything is, every player's bones
	UFUNCTION() void Typing(FString On);         // window.ue.fb.typing("1")   -> a text box has the focus: let the browser have the keyboard
	UFUNCTION() void Quit();                     // window.ue.fb.quit()         -> close the game
	UPROPERTY() AFbWebGame* Owner = nullptr;
};

struct FFbGeom
{
	int32 N = 0;
	TArray<FVector> Pos;
	TArray<FVector> Nrm;
	TArray<FVector2D> UV;
	TArray<FLinearColor> Col;
	TArray<int32> Idx;
	TArray<FIntVector> Groups;       // start, count, material slot
	bool bSkinned = false;
	TArray<uint16> SI;
	TArray<float> SW;
	int32 Rev = 0;
};

struct FFbMat
{
	FLinearColor Tint = FLinearColor::White;
	FLinearColor Emis = FLinearColor::Black;
	float Opacity = 1.f, AlphaTest = 0.f, Rough = 0.9f, Metal = 0.f;
	bool bTrans = false, bLit = true, bVC = false, bAdd = false;
	int32 Tex = 0;
	FLinearColor UvS = FLinearColor(1.f, 1.f, 0.f, 0.f);
	FLinearColor UvO = FLinearColor(0.f, 0.f, 0.f, 0.f);
};

struct FFbObj
{
	int32 Geom = 0, BuiltRev = -1;
	TArray<int32> MatIds;
	bool bShadow = false, bSkinned = false, bForceVC = false, bDirty = true, bXfDirty = true;
	float M[12] = { 1,0,0,0, 0,1,0,0, 0,0,1,0 };
	TArray<FVector> SkinPos;
	TArray<FVector> SkinNrm;
	TArray<float> Pose;            // last skeleton pose received for this mesh (bone matrices in Unreal's axes)
};

// Runs the real Ultimate Football game (the same code as the web version) inside Unreal, and draws its 3D scene with Unreal.
UCLASS()
class FBGAME_API AFbWebGame : public AActor
{
	GENERATED_BODY()
public:
	AFbWebGame();
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void Tick(float DeltaSeconds) override;

	void OnAsset(const FString& Data);
	void OnAssetObj(const TSharedPtr<FJsonObject>& O);
	void OnFrame(const FString& Data);
	void SetTyping(bool bOn);
	void QuitGame();

private:
	UPROPERTY() UFbBridge* Bridge = nullptr;
	UPROPERTY() USceneComponent* Scene = nullptr;
	UPROPERTY() ACameraActor* Cam = nullptr;
	UPROPERTY() TMap<int32, UTexture2D*> Textures;
	UPROPERTY() TMap<int32, UMaterialInstanceDynamic*> Mids;
	UPROPERTY() TMap<int32, UProceduralMeshComponent*> Comps;
	UPROPERTY() UMaterialInterface* BaseLit = nullptr;
	UPROPERTY() UMaterialInterface* BaseUnlit = nullptr;
	UPROPERTY() UMaterialInterface* BaseMasked = nullptr;
	UPROPERTY() UMaterialInterface* BaseTrans = nullptr;
	UPROPERTY() UMaterialInterface* BaseAdd = nullptr;
	UPROPERTY() UMaterialInterface* BaseFallback = nullptr;

	TSharedPtr<SWebBrowser> Browser;
	TSharedPtr<FFbKeyTap> KeyTap;
	TMap<int32, FFbGeom> Geoms;
	TMap<int32, FFbMat> Mats;
	TMap<int32, FFbObj> Objs;
	TSet<int32> Visible;
	TSet<int32> PoseDirty;
	FString Url, BridgeJs;
	bool bInputSet = false, bCustomMats = false;
	float Age = 0.f, NextLog = 5.f, FpsT = 0.f, LastFps = 0.f;
	int32 FpsN = 0, Quality = 0;
	int32 FrameCount = 0, AssetCount = 0, SkinnedVerts = 0;
	double SkinMs = 0.0, ParseMs = 0.0;

	void HandleLoaded();
	void HandleLoadError();
	void HandleConsole(const FString& Message, const FString& Source, int32 Line, EWebBrowserConsoleLogSeverity Severity);
	void PrepareLevel();
	void ResetScene();
	UMaterialInstanceDynamic* GetMid(int32 MatId, bool bForceVC);
	void ApplyMat(UMaterialInstanceDynamic* Mid, const FFbMat& M, bool bForceVC);
	void BuildObj(int32 Id, FFbObj& O);
	void ApplyXf(int32 Id, FFbObj& O);
};
