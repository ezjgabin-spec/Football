#include "FbWebGame.h"
#include "SWebBrowser.h"
#include "ProceduralMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "Engine/GameViewportClient.h"
#include "Engine/Texture2D.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/DirectionalLight.h"
#include "Components/LightComponent.h"
#include "Animation/SkeletalMeshActor.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/Base64.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "ImageUtils.h"
#include "Async/ParallelFor.h"
#include "EngineUtils.h"
#include "HAL/PlatformTime.h"
#include "Framework/Application/SlateApplication.h"
#include "Framework/Application/IInputProcessor.h"
#include "Input/Events.h"

static const float FBW_YD = 91.44f;      // the game works in yards, Unreal in centimetres

static float FbwLin(float C) { return FMath::Pow(FMath::Clamp(C, 0.f, 1.f), 2.2f); }      // the page's colours are display (sRGB) values

// ------------------------------------------------------------------------------------------------ keyboard
// Unreal reads every key itself (before any widget) and hands it to the game page, so moving works no matter what has the focus.
class FFbKeyTap : public IInputProcessor
{
public:
	TArray<FString> Pending;
	bool bTyping = false;        // a text box in the page has the focus: leave the keyboard to the browser
	virtual void Tick(const float DeltaTime, FSlateApplication& SlateApp, TSharedRef<ICursor> Cursor) override {}
	virtual const TCHAR* GetDebugName() const override { return TEXT("FbKeyTap"); }
	bool Take(const FKeyEvent& E, int32 Down)
	{
		const int32 Code = (int32)E.GetKeyCode();
		if (bTyping || E.IsAltDown() || Code == 122 || Code == 0) return false;        // typing, Alt+F4, F11: not ours
		Pending.Add(FString::Printf(TEXT("window.__fbue&&window.__fbue.key(%d,%d,%d,%d,%d,%d);"), Down, Code, E.IsShiftDown() ? 1 : 0, E.IsControlDown() ? 1 : 0, 0, E.IsRepeat() ? 1 : 0));
		return true;
	}
	virtual bool HandleKeyDownEvent(FSlateApplication& SlateApp, const FKeyEvent& InKeyEvent) override { return Take(InKeyEvent, 1); }
	virtual bool HandleKeyUpEvent(FSlateApplication& SlateApp, const FKeyEvent& InKeyEvent) override { return Take(InKeyEvent, 0); }
};

// ------------------------------------------------------------------------------------------------ bridge object
void UFbBridge::Report(FString Msg) { UE_LOG(LogTemp, Log, TEXT("[FB] page: %s"), *Msg); }
void UFbBridge::Asset(FString Data) { if (Owner) Owner->OnAsset(Data); }
void UFbBridge::Frame(FString Data) { if (Owner) Owner->OnFrame(Data); }
void UFbBridge::Typing(FString On) { if (Owner) Owner->SetTyping(On == TEXT("1")); }
void UFbBridge::Quit() { if (Owner) Owner->QuitGame(); }

// ------------------------------------------------------------------------------------------------ actor
AFbWebGame::AFbWebGame()
{
	PrimaryActorTick.bCanEverTick = true;
	Scene = CreateDefaultSubobject<USceneComponent>(TEXT("Scene"));
	RootComponent = Scene;
}

void AFbWebGame::SetTyping(bool bOn) { if (KeyTap.IsValid()) KeyTap->bTyping = bOn; }

void AFbWebGame::QuitGame()
{
	if (APlayerController* PC = GetWorld()->GetFirstPlayerController()) PC->ConsoleCommand(TEXT("quit"));
}

void AFbWebGame::PrepareLevel()
{
	// the test level has an old placeholder field and 22 standing players: remove them, the real game's scene replaces them. Lights and sky stay.
	TArray<AActor*> Kill;
	for (TActorIterator<ASkeletalMeshActor> It(GetWorld()); It; ++It) Kill.Add(*It);
	for (TActorIterator<AStaticMeshActor> It(GetWorld()); It; ++It)
		if (It->GetActorNameOrLabel().StartsWith(TEXT("FB_"))) Kill.Add(*It);
	for (AActor* A : Kill) if (A) A->Destroy();

	bool bHasSun = false;
	for (TActorIterator<ADirectionalLight> It(GetWorld()); It; ++It) { bHasSun = true; break; }
	if (!bHasSun)
	{
		ADirectionalLight* Sun = GetWorld()->SpawnActor<ADirectionalLight>(FVector(0.f, 0.f, 3000.f), FRotator(-50.f, 30.f, 0.f));
		if (Sun && Sun->GetLightComponent())
		{
			Sun->GetLightComponent()->SetMobility(EComponentMobility::Movable);
			Sun->GetLightComponent()->SetIntensity(8.f);
		}
	}
	UE_LOG(LogTemp, Log, TEXT("[FB] level prepared: removed %d placeholder actors, sun %s"), Kill.Num(), bHasSun ? TEXT("found") : TEXT("added"));
}

void AFbWebGame::BeginPlay()
{
	Super::BeginPlay();
	PrepareLevel();

	BaseLit = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Football/Web/M_FbLit.M_FbLit"));
	BaseUnlit = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Football/Web/M_FbUnlit.M_FbUnlit"));
	BaseMasked = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Football/Web/M_FbMasked.M_FbMasked"));
	BaseTrans = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Football/Web/M_FbTrans.M_FbTrans"));
	BaseAdd = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Football/Web/M_FbAdd.M_FbAdd"));
	BaseFallback = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	bCustomMats = (BaseLit != nullptr);
	if (!BaseUnlit) BaseUnlit = BaseLit;
	if (!BaseMasked) BaseMasked = BaseLit;
	if (!BaseTrans) BaseTrans = BaseUnlit;
	if (!BaseAdd) BaseAdd = BaseTrans;
	UE_LOG(LogTemp, Log, TEXT("[FB] materials: %s"), bCustomMats ? TEXT("game materials found") : TEXT("NOT found - plain colours only"));

	Cam = GetWorld()->SpawnActor<ACameraActor>(FVector(-3000.f, 0.f, 800.f), FRotator(-12.f, 0.f, 0.f));
	if (Cam && Cam->GetCameraComponent())
	{
		Cam->GetCameraComponent()->bConstrainAspectRatio = false;
		Cam->GetCameraComponent()->SetFieldOfView(80.f);
	}

	Bridge = NewObject<UFbBridge>(this);
	Bridge->Owner = this;

	Url = TEXT("https://football.ezjgabin.workers.dev/?ue=1");
	FString FromFile;
	if (FFileHelper::LoadFileToString(FromFile, *(FPaths::ProjectDir() / TEXT("FbUrl.txt"))))
	{
		FromFile.TrimStartAndEndInline();
		if (FromFile.Len() > 8) Url = FromFile;
	}
	if (!FFileHelper::LoadFileToString(BridgeJs, *(FPaths::ProjectDir() / TEXT("FbWeb/ue_bridge.js"))))
		UE_LOG(LogTemp, Error, TEXT("[FB] FbWeb/ue_bridge.js is missing: the page will draw its own graphics"));
	UE_LOG(LogTemp, Log, TEXT("[FB] web game: opening %s (bridge script %d chars)"), *Url, BridgeJs.Len());

	if (GEngine && GEngine->GameViewport)
	{
		SAssignNew(Browser, SWebBrowser)
			.InitialURL(Url)
			.ShowControls(false)
			.ShowAddressBar(false)
			.ShowErrorMessage(true)
			.SupportsTransparency(true)
			.BrowserFrameRate(60)
			.OnLoadCompleted_UObject(this, &AFbWebGame::HandleLoaded)
			.OnLoadError_UObject(this, &AFbWebGame::HandleLoadError)
			.OnConsoleMessage_UObject(this, &AFbWebGame::HandleConsole);
		Browser->BindUObject(TEXT("fb"), Bridge, true);
		GEngine->GameViewport->AddViewportWidgetContent(Browser.ToSharedRef(), 10);
	}
	else UE_LOG(LogTemp, Error, TEXT("[FB] web game: no game viewport"));

	if (FSlateApplication::IsInitialized())
	{
		KeyTap = MakeShared<FFbKeyTap>();
		FSlateApplication::Get().RegisterInputPreProcessor(KeyTap);
	}
}

void AFbWebGame::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (KeyTap.IsValid() && FSlateApplication::IsInitialized()) FSlateApplication::Get().UnregisterInputPreProcessor(KeyTap);
	KeyTap.Reset();
	if (Browser.IsValid() && GEngine && GEngine->GameViewport) GEngine->GameViewport->RemoveViewportWidgetContent(Browser.ToSharedRef());
	Browser.Reset();
	Super::EndPlay(EndPlayReason);
}

void AFbWebGame::HandleLoaded()
{
	UE_LOG(LogTemp, Log, TEXT("[FB] web game: page loaded"));
	if (Browser.IsValid() && BridgeJs.Len() > 0) Browser->ExecuteJavascript(BridgeJs);
}

void AFbWebGame::HandleLoadError()
{
	UE_LOG(LogTemp, Error, TEXT("[FB] web game: the page failed to load (%s)"), *Url);
}

void AFbWebGame::HandleConsole(const FString& Message, const FString& Source, int32 Line, EWebBrowserConsoleLogSeverity Severity)
{
	const bool bBad = (Severity == EWebBrowserConsoleLogSeverity::Error || Severity == EWebBrowserConsoleLogSeverity::Fatal);
	if (bBad || Message.StartsWith(TEXT("FB"))) UE_LOG(LogTemp, Log, TEXT("[FB] js%s: %s  (line %d)"), bBad ? TEXT(" ERROR") : TEXT(""), *Message.Left(300), Line);
}

void AFbWebGame::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	Age += DeltaSeconds;
	APlayerController* PC = GetWorld()->GetFirstPlayerController();
	if (PC)
	{
		if (!bInputSet)
		{
			FInputModeUIOnly Mode;
			Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
			PC->SetInputMode(Mode);
			PC->bShowMouseCursor = true;
			bInputSet = true;
		}
		if (Cam && PC->GetViewTarget() != Cam) PC->SetViewTarget(Cam);
	}
	if (KeyTap.IsValid() && KeyTap->Pending.Num() > 0)
	{
		if (Browser.IsValid()) Browser->ExecuteJavascript(FString::Join(KeyTap->Pending, TEXT("")));
		KeyTap->Pending.Reset();
	}
	if (Age > NextLog)
	{
		NextLog += 15.f;
		UE_LOG(LogTemp, Log, TEXT("[FB] web game: %.0f s, frames %d, assets %d (meshes %d, textures %d, materials %d), objects %d (visible %d), skinned verts %d, skin %.1f ms, parse %.1f ms"),
			Age, FrameCount, AssetCount, Geoms.Num(), Textures.Num(), Mats.Num(), Objs.Num(), Visible.Num(), SkinnedVerts, SkinMs, ParseMs);
	}
}

// ------------------------------------------------------------------------------------------------ helpers
static bool FbwB64(const TSharedPtr<FJsonObject>& O, const TCHAR* Field, TArray<uint8>& Out)
{
	FString S;
	if (!O->TryGetStringField(Field, S) || S.Len() == 0) return false;
	return FBase64::Decode(S, Out);
}

void AFbWebGame::ResetScene()
{
	for (auto& KV : Comps) if (KV.Value) KV.Value->DestroyComponent();
	Comps.Empty(); Objs.Empty(); Geoms.Empty(); Mats.Empty(); Mids.Empty(); Textures.Empty(); Visible.Empty();
	UE_LOG(LogTemp, Log, TEXT("[FB] scene reset (the page started over)"));
}

void AFbWebGame::ApplyMat(UMaterialInstanceDynamic* Mid, const FFbMat& M, bool bForceVC)
{
	if (!Mid) return;
	if (!bCustomMats)
	{
		Mid->SetVectorParameterValue(TEXT("Color"), M.Tint);
		return;
	}
	Mid->SetVectorParameterValue(TEXT("Tint"), M.Tint);
	Mid->SetVectorParameterValue(TEXT("Emis"), M.Emis);
	Mid->SetScalarParameterValue(TEXT("Opacity"), M.Opacity);
	Mid->SetScalarParameterValue(TEXT("Rough"), M.Rough);
	Mid->SetScalarParameterValue(TEXT("Metal"), M.Metal);
	Mid->SetScalarParameterValue(TEXT("UseVC"), (M.bVC || bForceVC) ? 1.f : 0.f);
	Mid->SetVectorParameterValue(TEXT("UVS"), M.UvS);
	Mid->SetVectorParameterValue(TEXT("UVO"), M.UvO);
	UTexture2D** T = Textures.Find(M.Tex);
	if (M.Tex != 0 && T && *T) Mid->SetTextureParameterValue(TEXT("Tex"), *T);
}

UMaterialInstanceDynamic* AFbWebGame::GetMid(int32 MatId, bool bForceVC)
{
	const int32 Key = MatId * 2 + (bForceVC ? 1 : 0);
	if (UMaterialInstanceDynamic** Found = Mids.Find(Key)) return *Found;
	const FFbMat* M = Mats.Find(MatId);
	if (!M) return nullptr;
	UMaterialInterface* Base = BaseFallback;
	if (bCustomMats)
	{
		if (M->bAdd) Base = BaseAdd;
		else if (M->bTrans) Base = BaseTrans;
		else if (!M->bLit) Base = BaseUnlit;
		else if (M->AlphaTest > 0.f) Base = BaseMasked;
		else Base = BaseLit;
	}
	if (!Base) return nullptr;
	UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Base, this);
	ApplyMat(Mid, *M, bForceVC);
	Mids.Add(Key, Mid);
	return Mid;
}

// ------------------------------------------------------------------------------------------------ assets (sent once)
void AFbWebGame::OnAsset(const FString& Data)
{
	TSharedPtr<FJsonObject> O;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Data);
	if (!FJsonSerializer::Deserialize(Reader, O) || !O.IsValid()) return;
	AssetCount++;
	const FString Type = O->GetStringField(TEXT("t"));
	if (Type == TEXT("reset")) { ResetScene(); return; }
	const int32 Id = (int32)O->GetNumberField(TEXT("id"));

	if (Type == TEXT("geom"))
	{
		FFbGeom& G = Geoms.FindOrAdd(Id);
		const int32 Rev = G.Rev + 1;
		G = FFbGeom();
		G.Rev = Rev;
		G.N = (int32)O->GetNumberField(TEXT("n"));
		TArray<uint8> B;
		if (!FbwB64(O, TEXT("p"), B) || B.Num() < G.N * 12) { Geoms.Remove(Id); return; }
		const float* P = (const float*)B.GetData();
		G.Pos.SetNumUninitialized(G.N);
		for (int32 i = 0; i < G.N; i++) G.Pos[i] = FVector(P[i * 3] * FBW_YD, P[i * 3 + 2] * FBW_YD, P[i * 3 + 1] * FBW_YD);      // game (x, y up, z) -> Unreal (X, Y, Z up)
		TArray<uint8> BN;
		G.Nrm.SetNumUninitialized(G.N);
		if (FbwB64(O, TEXT("nr"), BN) && BN.Num() >= G.N * 12)
		{
			const float* Nn = (const float*)BN.GetData();
			for (int32 i = 0; i < G.N; i++) G.Nrm[i] = FVector(Nn[i * 3], Nn[i * 3 + 2], Nn[i * 3 + 1]);
		}
		else for (int32 i = 0; i < G.N; i++) G.Nrm[i] = FVector(0.f, 0.f, 1.f);
		TArray<uint8> BU;
		if (FbwB64(O, TEXT("uv"), BU) && BU.Num() >= G.N * 8)
		{
			const float* Uv = (const float*)BU.GetData();
			G.UV.SetNumUninitialized(G.N);
			for (int32 i = 0; i < G.N; i++) G.UV[i] = FVector2D(Uv[i * 2], Uv[i * 2 + 1]);
		}
		TArray<uint8> BC;
		if (FbwB64(O, TEXT("c"), BC) && BC.Num() >= G.N * 12)
		{
			const float* Cc = (const float*)BC.GetData();
			G.Col.SetNumUninitialized(G.N);
			for (int32 i = 0; i < G.N; i++) G.Col[i] = FLinearColor(FbwLin(Cc[i * 3]), FbwLin(Cc[i * 3 + 1]), FbwLin(Cc[i * 3 + 2]), 1.f);
		}
		TArray<uint8> BI;
		if (FbwB64(O, TEXT("i"), BI))
		{
			const uint32* Ix = (const uint32*)BI.GetData();
			const int32 Ni = (BI.Num() / 4) / 3 * 3;
			G.Idx.SetNumUninitialized(Ni);
			for (int32 i = 0; i + 2 < Ni; i += 3)
			{
				// swapping two axes mirrors the mesh, so the triangle order is reversed to keep it facing outward
				G.Idx[i] = (int32)Ix[i]; G.Idx[i + 1] = (int32)Ix[i + 2]; G.Idx[i + 2] = (int32)Ix[i + 1];
			}
			for (int32 i = 0; i < Ni; i++) if (G.Idx[i] < 0 || G.Idx[i] >= G.N) G.Idx[i] = 0;
		}
		const TArray<TSharedPtr<FJsonValue>>* Gr = nullptr;
		if (O->TryGetArrayField(TEXT("gr"), Gr) && Gr)
		{
			for (const TSharedPtr<FJsonValue>& V : *Gr)
			{
				const TArray<TSharedPtr<FJsonValue>>& A = V->AsArray();
				if (A.Num() >= 3) G.Groups.Add(FIntVector((int32)A[0]->AsNumber(), (int32)A[1]->AsNumber(), (int32)A[2]->AsNumber()));
			}
		}
		TArray<uint8> BS, BW;
		if (FbwB64(O, TEXT("si"), BS) && FbwB64(O, TEXT("sw"), BW) && BS.Num() >= G.N * 8 && BW.Num() >= G.N * 16)
		{
			G.bSkinned = true;
			G.SI.SetNumUninitialized(G.N * 4);
			FMemory::Memcpy(G.SI.GetData(), BS.GetData(), G.N * 8);
			G.SW.SetNumUninitialized(G.N * 4);
			FMemory::Memcpy(G.SW.GetData(), BW.GetData(), G.N * 16);
		}
		for (auto& KV : Objs) if (KV.Value.Geom == Id) KV.Value.bDirty = true;
		return;
	}

	if (Type == TEXT("tex"))
	{
		TArray<uint8> B;
		if (!FbwB64(O, TEXT("d"), B)) return;
		UTexture2D* T = FImageUtils::ImportBufferAsTexture2D(B);
		if (!T) { UE_LOG(LogTemp, Warning, TEXT("[FB] texture %d could not be decoded (%d bytes)"), Id, B.Num()); return; }
		Textures.Add(Id, T);
		for (auto& KV : Mids)
		{
			const FFbMat* M = Mats.Find(KV.Key / 2);
			if (M && M->Tex == Id && KV.Value && bCustomMats) KV.Value->SetTextureParameterValue(TEXT("Tex"), T);
		}
		return;
	}

	if (Type == TEXT("mat"))
	{
		FFbMat M;
		const TArray<TSharedPtr<FJsonValue>>* C = nullptr;
		if (O->TryGetArrayField(TEXT("c"), C) && C && C->Num() >= 3)
			M.Tint = FLinearColor(FbwLin((float)(*C)[0]->AsNumber()), FbwLin((float)(*C)[1]->AsNumber()), FbwLin((float)(*C)[2]->AsNumber()), 1.f);
		const TArray<TSharedPtr<FJsonValue>>* E = nullptr;
		if (O->TryGetArrayField(TEXT("e"), E) && E && E->Num() >= 3)
			M.Emis = FLinearColor(FbwLin((float)(*E)[0]->AsNumber()), FbwLin((float)(*E)[1]->AsNumber()), FbwLin((float)(*E)[2]->AsNumber()), 1.f);
		M.Opacity = (float)O->GetNumberField(TEXT("o"));
		M.AlphaTest = (float)O->GetNumberField(TEXT("at"));
		M.Rough = (float)O->GetNumberField(TEXT("ro"));
		M.Metal = (float)O->GetNumberField(TEXT("me"));
		M.bTrans = O->GetNumberField(TEXT("tr")) > 0.5;
		M.bLit = O->GetNumberField(TEXT("lit")) > 0.5;
		M.bVC = O->GetNumberField(TEXT("vc")) > 0.5;
		M.bAdd = O->GetNumberField(TEXT("add")) > 0.5;
		M.Tex = (int32)O->GetNumberField(TEXT("map"));
		const TArray<TSharedPtr<FJsonValue>>* Us = nullptr;
		const TArray<TSharedPtr<FJsonValue>>* Uo = nullptr;
		if (O->TryGetArrayField(TEXT("uvs"), Us) && Us && Us->Num() >= 2 && O->TryGetArrayField(TEXT("uvo"), Uo) && Uo && Uo->Num() >= 2)
		{
			M.UvS = FLinearColor((float)(*Us)[0]->AsNumber(), (float)(*Us)[1]->AsNumber(), 0.f, 0.f);
			M.UvO = FLinearColor((float)(*Uo)[0]->AsNumber(), (float)(*Uo)[1]->AsNumber(), 0.f, 0.f);
		}
		const FFbMat* Old = Mats.Find(Id);
		const bool bKindChanged = Old && (Old->bTrans != M.bTrans || Old->bAdd != M.bAdd || Old->bLit != M.bLit || (Old->AlphaTest > 0.f) != (M.AlphaTest > 0.f));
		Mats.Add(Id, M);
		if (bKindChanged)
		{
			// a different kind of material (e.g. it became see-through): make new instances and rebuild whoever uses it
			Mids.Remove(Id * 2); Mids.Remove(Id * 2 + 1);
			for (auto& KV : Objs) if (KV.Value.MatIds.Contains(Id)) KV.Value.bDirty = true;
		}
		else
		{
			if (UMaterialInstanceDynamic** A = Mids.Find(Id * 2)) ApplyMat(*A, M, false);
			if (UMaterialInstanceDynamic** B2 = Mids.Find(Id * 2 + 1)) ApplyMat(*B2, M, true);
		}
		return;
	}
}

// ------------------------------------------------------------------------------------------------ building one object
void AFbWebGame::ApplyXf(int32 Id, FFbObj& O)
{
	UProceduralMeshComponent** CP = Comps.Find(Id);
	if (!CP || !*CP) return;
	O.bXfDirty = false;
	if (O.bSkinned) { (*CP)->SetWorldTransform(FTransform::Identity); return; }
	// O.M = the page's 3x4 world matrix (rows). Re-express it in Unreal's axes (y and z swapped) and centimetres.
	const float* m = O.M;
	FMatrix X = FMatrix::Identity;
	X.M[0][0] = m[0];  X.M[0][1] = m[8];  X.M[0][2] = m[4];       // where the X axis goes
	X.M[1][0] = m[2];  X.M[1][1] = m[10]; X.M[1][2] = m[6];       // where the Y axis goes (the page's z)
	X.M[2][0] = m[1];  X.M[2][1] = m[9];  X.M[2][2] = m[5];       // where the Z axis goes (the page's y)
	X.M[3][0] = m[3] * FBW_YD; X.M[3][1] = m[11] * FBW_YD; X.M[3][2] = m[7] * FBW_YD;
	(*CP)->SetWorldTransform(FTransform(X));
}

void AFbWebGame::BuildObj(int32 Id, FFbObj& O)
{
	const FFbGeom* G = Geoms.Find(O.Geom);
	if (!G || G->N < 3 || G->Idx.Num() < 3) return;
	UProceduralMeshComponent* C = nullptr;
	if (UProceduralMeshComponent** CP = Comps.Find(Id)) C = *CP;
	if (!C)
	{
		C = NewObject<UProceduralMeshComponent>(this);
		C->bUseAsyncCooking = false;
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->RegisterComponent();
		C->AttachToComponent(Scene, FAttachmentTransformRules::KeepRelativeTransform);
		Comps.Add(Id, C);
	}
	C->ClearAllMeshSections();
	const TArray<FProcMeshTangent> NoTan;
	const TArray<FLinearColor> NoCol;
	const bool bHasCol = (G->Col.Num() == G->N);
	if (G->Groups.Num() > 1 && !G->bSkinned)
	{
		int32 Sec = 0;
		for (const FIntVector& Gr : G->Groups)
		{
			TArray<int32> Sub;
			const int32 A = FMath::Clamp(Gr.X, 0, G->Idx.Num()), B = FMath::Clamp(Gr.X + Gr.Y, 0, G->Idx.Num());
			if (B - A < 3) continue;
			Sub.Append(G->Idx.GetData() + A, (B - A) / 3 * 3);
			C->CreateMeshSection_LinearColor(Sec, G->Pos, Sub, G->Nrm, G->UV, bHasCol ? G->Col : NoCol, NoTan, false, false);
			const int32 Mi = O.MatIds.IsValidIndex(Gr.Z) ? O.MatIds[Gr.Z] : (O.MatIds.Num() ? O.MatIds[0] : 0);
			if (UMaterialInstanceDynamic* Mid = GetMid(Mi, O.bForceVC && bHasCol)) C->SetMaterial(Sec, Mid);
			Sec++;
		}
	}
	else
	{
		C->CreateMeshSection_LinearColor(0, G->Pos, G->Idx, G->Nrm, G->UV, bHasCol ? G->Col : NoCol, NoTan, false, false);
		if (O.MatIds.Num())
			if (UMaterialInstanceDynamic* Mid = GetMid(O.MatIds[0], O.bForceVC && bHasCol)) C->SetMaterial(0, Mid);
	}
	C->SetCastShadow(O.bShadow);
	O.BuiltRev = G->Rev;
	O.bDirty = false;
	O.bXfDirty = true;
}

// ------------------------------------------------------------------------------------------------ every frame
void AFbWebGame::OnFrame(const FString& Data)
{
	const double T0 = FPlatformTime::Seconds();
	TSharedPtr<FJsonObject> O;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Data);
	if (!FJsonSerializer::Deserialize(Reader, O) || !O.IsValid()) return;
	FrameCount++;

	// camera: position, forward, up, vertical field of view, aspect
	const TArray<TSharedPtr<FJsonValue>>* CamA = nullptr;
	if (Cam && O->TryGetArrayField(TEXT("cam"), CamA) && CamA && CamA->Num() >= 11)
	{
		auto F = [CamA](int32 i) { return (float)(*CamA)[i]->AsNumber(); };
		const FVector Loc(F(0) * FBW_YD, F(2) * FBW_YD, F(1) * FBW_YD);
		const FVector Fwd(F(3), F(5), F(4));
		const FVector Up(F(6), F(8), F(7));
		if (!Fwd.IsNearlyZero() && !Up.IsNearlyZero())
			Cam->SetActorLocationAndRotation(Loc, FRotationMatrix::MakeFromXZ(Fwd, Up).Rotator());
		const float VFov = F(9), Aspect = FMath::Max(0.1f, F(10));
		const float HFov = FMath::RadiansToDegrees(2.f * FMath::Atan(FMath::Tan(FMath::DegreesToRadians(VFov) * 0.5f) * Aspect));
		if (Cam->GetCameraComponent())
		{
			Cam->GetCameraComponent()->SetFieldOfView(FMath::Clamp(HFov, 5.f, 170.f));
			Cam->GetCameraComponent()->SetAspectRatio(Aspect);            // same 16:9 frame as the game page, so a click lands on the same spot of the field
			Cam->GetCameraComponent()->SetConstraintAspectRatio(true);
		}
	}

	// new or changed objects
	const TArray<TSharedPtr<FJsonValue>>* ObjA = nullptr;
	if (O->TryGetArrayField(TEXT("objs"), ObjA) && ObjA)
	{
		for (const TSharedPtr<FJsonValue>& V : *ObjA)
		{
			const TArray<TSharedPtr<FJsonValue>>& A = V->AsArray();
			if (A.Num() < 6) continue;
			const int32 Id = (int32)A[0]->AsNumber();
			FFbObj& Ob = Objs.FindOrAdd(Id);
			const int32 NewGeom = (int32)A[1]->AsNumber();
			TArray<int32> NewMats;
			for (const TSharedPtr<FJsonValue>& Mv : A[2]->AsArray()) NewMats.Add((int32)Mv->AsNumber());
			const bool bShadow = A[3]->AsNumber() > 0.5, bSk = A[4]->AsNumber() > 0.5, bInst = A[5]->AsNumber() > 0.5;
			if (NewGeom != Ob.Geom || NewMats != Ob.MatIds || bSk != Ob.bSkinned || bInst != Ob.bForceVC) Ob.bDirty = true;
			if (bShadow != Ob.bShadow) { Ob.bShadow = bShadow; if (UProceduralMeshComponent** CP = Comps.Find(Id)) if (*CP) (*CP)->SetCastShadow(bShadow); }
			Ob.Geom = NewGeom; Ob.MatIds = NewMats; Ob.bSkinned = bSk; Ob.bForceVC = bInst;
		}
	}

	// objects that moved: ids + 3x4 world matrices
	TArray<uint8> XiB, XmB;
	if (FbwB64(O, TEXT("xi"), XiB) && FbwB64(O, TEXT("xm"), XmB))
	{
		const uint32* Xi = (const uint32*)XiB.GetData();
		const float* Xm = (const float*)XmB.GetData();
		const int32 Nx = FMath::Min(XiB.Num() / 4, XmB.Num() / 48);
		for (int32 i = 0; i < Nx; i++)
		{
			FFbObj& Ob = Objs.FindOrAdd((int32)Xi[i]);
			FMemory::Memcpy(Ob.M, Xm + i * 12, 48);
			Ob.bXfDirty = true;
		}
	}

	// what is visible this frame
	TArray<uint8> VisB;
	Visible.Reset();
	if (FbwB64(O, TEXT("vis"), VisB))
	{
		const uint32* Vi = (const uint32*)VisB.GetData();
		const int32 Nv = VisB.Num() / 4;
		Visible.Reserve(Nv);
		for (int32 i = 0; i < Nv; i++) Visible.Add((int32)Vi[i]);
	}
	for (auto& KV : Objs)
	{
		FFbObj& Ob = KV.Value;
		const bool bShow = Visible.Contains(KV.Key);
		if (bShow)
		{
			const FFbGeom* G = Geoms.Find(Ob.Geom);
			if (G && (Ob.bDirty || Ob.BuiltRev != G->Rev)) BuildObj(KV.Key, Ob);
			if (Ob.bXfDirty) ApplyXf(KV.Key, Ob);
		}
		if (UProceduralMeshComponent** CP = Comps.Find(KV.Key))
			if (*CP && (*CP)->IsVisible() != bShow) (*CP)->SetVisibility(bShow);
	}

	// players: move every vertex with its bones (the same maths the page's graphics card would do), then hand the new shape to Unreal
	const TArray<TSharedPtr<FJsonValue>>* SkM = nullptr;
	TArray<uint8> SkB;
	if (O->TryGetArrayField(TEXT("skm"), SkM) && SkM && SkM->Num() >= 2 && FbwB64(O, TEXT("sk"), SkB))
	{
		const double S0 = FPlatformTime::Seconds();
		const float* Bones = (const float*)SkB.GetData();
		const int32 TotalBones = SkB.Num() / 48;
		struct FJob { int32 Id; int32 First; int32 Count; FFbObj* Ob; const FFbGeom* G; };
		TArray<FJob> Jobs;
		// "skc" = bone count of every skeleton in the blob (in order); "skm" = pairs (mesh id, skeleton index)
		TArray<int32> SkFirst, SkCount;
		const TArray<TSharedPtr<FJsonValue>>* SkC = nullptr;
		if (O->TryGetArrayField(TEXT("skc"), SkC) && SkC)
		{
			int32 Off = 0;
			for (const TSharedPtr<FJsonValue>& V : *SkC) { const int32 Nb = (int32)V->AsNumber(); SkFirst.Add(Off); SkCount.Add(Nb); Off += Nb; }
		}
		for (int32 i = 0; i + 1 < SkM->Num(); i += 2)
		{
			const int32 Id = (int32)(*SkM)[i]->AsNumber(), Si = (int32)(*SkM)[i + 1]->AsNumber();
			if (!SkFirst.IsValidIndex(Si)) continue;
			FFbObj* Ob = Objs.Find(Id);
			const FFbGeom* G = Ob ? Geoms.Find(Ob->Geom) : nullptr;
			if (Ob && G && G->bSkinned && Ob->BuiltRev == G->Rev && SkFirst[Si] + SkCount[Si] <= TotalBones && Comps.Contains(Id)) Jobs.Add({ Id, SkFirst[Si], SkCount[Si], Ob, G });
		}
		ParallelFor(Jobs.Num(), [&Jobs, Bones](int32 j)
		{
			const FJob& J = Jobs[j];
			const FFbGeom& G = *J.G;
			const int32 N = G.N;
			// bone matrices re-expressed in Unreal's axes: rows for X, Y, Z
			TArray<float> A;
			A.SetNumUninitialized(J.Count * 12);
			for (int32 b = 0; b < J.Count; b++)
			{
				const float* m = Bones + (J.First + b) * 12;
				float* a = A.GetData() + b * 12;
				a[0] = m[0]; a[1] = m[2];  a[2] = m[1];  a[3] = m[3] * FBW_YD;
				a[4] = m[8]; a[5] = m[10]; a[6] = m[9];  a[7] = m[11] * FBW_YD;
				a[8] = m[4]; a[9] = m[6];  a[10] = m[5]; a[11] = m[7] * FBW_YD;
			}
			J.Ob->SkinPos.SetNumUninitialized(N);
			J.Ob->SkinNrm.SetNumUninitialized(N);
			for (int32 v = 0; v < N; v++)
			{
				const FVector& P = G.Pos[v];
				const FVector& Nn = G.Nrm[v];
				const float px = (float)P.X, py = (float)P.Y, pz = (float)P.Z, nx = (float)Nn.X, ny = (float)Nn.Y, nz = (float)Nn.Z;
				float ox = 0.f, oy = 0.f, oz = 0.f, mx = 0.f, my = 0.f, mz = 0.f;
				for (int32 k = 0; k < 4; k++)
				{
					const float w = G.SW[v * 4 + k];
					if (w <= 0.f) continue;
					const int32 bi = G.SI[v * 4 + k];
					if (bi >= J.Count) continue;
					const float* a = A.GetData() + bi * 12;
					ox += w * (a[0] * px + a[1] * py + a[2] * pz + a[3]);
					oy += w * (a[4] * px + a[5] * py + a[6] * pz + a[7]);
					oz += w * (a[8] * px + a[9] * py + a[10] * pz + a[11]);
					mx += w * (a[0] * nx + a[1] * ny + a[2] * nz);
					my += w * (a[4] * nx + a[5] * ny + a[6] * nz);
					mz += w * (a[8] * nx + a[9] * ny + a[10] * nz);
				}
				J.Ob->SkinPos[v] = FVector(ox, oy, oz);
				const float L = FMath::Sqrt(mx * mx + my * my + mz * mz);
				J.Ob->SkinNrm[v] = (L > 1e-6f) ? FVector(mx / L, my / L, mz / L) : FVector(0.f, 0.f, 1.f);
			}
		});
		const TArray<FVector2D> NoUV;
		const TArray<FLinearColor> NoCol;
		const TArray<FProcMeshTangent> NoTan;
		SkinnedVerts = 0;
		for (const FJob& J : Jobs)
		{
			if (!Visible.Contains(J.Id)) continue;
			UProceduralMeshComponent** CP = Comps.Find(J.Id);
			if (!CP || !*CP) continue;
			(*CP)->UpdateMeshSection_LinearColor(0, J.Ob->SkinPos, J.Ob->SkinNrm, NoUV, NoCol, NoTan, false);
			SkinnedVerts += J.G->N;
		}
		SkinMs = (FPlatformTime::Seconds() - S0) * 1000.0;
	}
	ParseMs = (FPlatformTime::Seconds() - T0) * 1000.0 - SkinMs;
}
