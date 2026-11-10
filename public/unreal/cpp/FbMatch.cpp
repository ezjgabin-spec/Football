#include "FbMatch.h"
#include "Components/SceneComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Animation/AnimSequence.h"
#include "Animation/SkeletalMeshActor.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "AssetRegistry/ARFilter.h"
#include "Modules/ModuleManager.h"
#include "EngineUtils.h"
#include "Engine/Engine.h"
#include "Engine/DirectionalLight.h"
#include "Components/LightComponent.h"
#include "GameFramework/HUD.h"
#include "GameFramework/GameModeBase.h"

AFbMatch::AFbMatch()
{
	PrimaryActorTick.bCanEverTick = true;
	Scene = CreateDefaultSubobject<USceneComponent>(TEXT("Scene"));
	RootComponent = Scene;
	for (int32 i = 0; i < FB_N; i++) { CurAnim[i] = EFbAnim::None; Facing[i] = (i < 11) ? 0.f : 180.f; }
	for (int32 k = 0; k < 5; k++) KThrow[k] = false;
	for (int32 i = 0; i < FB_N; i++) AnimLock[i] = 0.f;
}

// ------------------------------------------------------------------------------------------------ setup
void AFbMatch::BeginPlay()
{
	Super::BeginPlay();
	for (TActorIterator<AFbMatch> It(GetWorld()); It; ++It)
		if (*It != this) { UE_LOG(LogTemp, Warning, TEXT("[FB] a second match actor appeared - removing it")); Destroy(); return; }
	PC = GetWorld()->GetFirstPlayerController();
	CleanupLevel();
	LoadAssets();
	SpawnPuppets();
	if (Skel.Num() > 0 && Skel[0])
	{
		HipsBone = NAME_None;
		for (int32 b = 0; b < Skel[0]->GetNumBones(); b++)
			if (Skel[0]->GetBoneName(b).ToString().ToLower().Contains(TEXT("hips"))) { HipsBone = Skel[0]->GetBoneName(b); break; }
		if (HipsBone == NAME_None && Skel[0]->GetNumBones() > 0) HipsBone = Skel[0]->GetBoneName(0);
		AssetInfo += FString::Printf(TEXT("  hips=%s  removed-old-actors=%d"), *HipsBone.ToString(), Destroyed);
	}
	SpawnBall();
	SpawnCamera();
	EnsureField();
	FFbMeta::Get();
	GoMenu();
	const FString Msg = FString::Printf(TEXT("FB: map=%s  gamemode=%s  hud=%s  | %s"), *GetWorld()->GetMapName(),
		GetWorld()->GetAuthGameMode() ? *GetWorld()->GetAuthGameMode()->GetClass()->GetName() : TEXT("none"),
		(PC && PC->GetHUD()) ? *PC->GetHUD()->GetClass()->GetName() : TEXT("none"), *AssetInfo);
	UE_LOG(LogTemp, Log, TEXT("[FB] %s"), *Msg);
	if (GEngine) GEngine->AddOnScreenDebugMessage(7001, 600.f, FColor::Yellow, Msg);
}

void AFbMatch::EnsureField()
{
	// if the level has no football field (wrong map), build a plain one so there is always something to play on
	bool bHas = false;
	for (TActorIterator<AStaticMeshActor> It(GetWorld()); It; ++It)
		if (It->GetActorNameOrLabel().Contains(TEXT("FB_Turf"))) { bHas = true; break; }
	if (bHas) return;
	UStaticMesh* Plane = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Plane.Plane"));
	UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (Plane)
	{
		UStaticMeshComponent* Turf = NewObject<UStaticMeshComponent>(this);
		Turf->SetStaticMesh(Plane);
		Turf->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Turf->RegisterComponent();
		Turf->AttachToComponent(Scene, FAttachmentTransformRules::KeepRelativeTransform);
		Turf->SetWorldLocation(FVector(0.f, 0.f, 0.f));
		Turf->SetWorldScale3D(FVector(130.f * FB_YD / 100.f, 70.f * FB_YD / 100.f, 1.f));
		UMaterialInstanceDynamic* M = Turf->CreateAndSetMaterialInstanceDynamic(0);
		if (M) M->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.03f, 0.25f, 0.05f, 1.f));
	}
	if (Cube)
	{
		for (int32 X = -50; X <= 50; X += 5)
		{
			UStaticMeshComponent* L = NewObject<UStaticMeshComponent>(this);
			L->SetStaticMesh(Cube);
			L->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			L->RegisterComponent();
			L->AttachToComponent(Scene, FAttachmentTransformRules::KeepRelativeTransform);
			L->SetWorldLocation(FVector((float)X * FB_YD, 0.f, 2.f));
			L->SetWorldScale3D(FVector(0.12f, 53.3f * FB_YD / 100.f, 0.02f));
			UMaterialInstanceDynamic* M = L->CreateAndSetMaterialInstanceDynamic(0);
			if (M) M->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.9f, 0.9f, 0.9f, 1.f));
		}
	}
	ADirectionalLight* Sun = GetWorld()->SpawnActor<ADirectionalLight>(FVector(0.f, 0.f, 3000.f), FRotator(-50.f, 30.f, 0.f));
	if (Sun && Sun->GetLightComponent())
	{
		Sun->GetLightComponent()->SetMobility(EComponentMobility::Movable);
		Sun->GetLightComponent()->SetIntensity(8.f);
	}
	UE_LOG(LogTemp, Log, TEXT("[FB] no FB_Turf in this level - built a plain field"));
}

void AFbMatch::CleanupLevel()
{
	// the python test script left 22 standing players and a ball in the level: remove them, this class spawns its own
	TArray<AActor*> Kill;
	for (TActorIterator<ASkeletalMeshActor> It(GetWorld()); It; ++It) Kill.Add(*It);
	for (TActorIterator<AStaticMeshActor> It(GetWorld()); It; ++It)
		if (It->GetActorNameOrLabel().Contains(TEXT("FB_Ball"))) Kill.Add(*It);
	for (AActor* A : Kill) if (A) { A->Destroy(); Destroyed++; }
}

void AFbMatch::LoadAssets()
{
	FAssetRegistryModule& ARM = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
	IAssetRegistry& AR = ARM.Get();
	AR.SearchAllAssets(true);       // finish scanning now (a standalone game starts before the scan is done)

	{
		const TCHAR* Roots[2] = { TEXT("/Game/Football"), TEXT("/Game") };
		for (int32 r = 0; r < 2 && !PlayerMesh; r++)
		{
			FARFilter F;
			F.PackagePaths.Add(FName(Roots[r]));
			F.bRecursivePaths = true;
			F.ClassPaths.Add(USkeletalMesh::StaticClass()->GetClassPathName());
			TArray<FAssetData> Found;
			AR.GetAssets(F, Found);
			for (const FAssetData& D : Found)
			{
				USkeletalMesh* M = Cast<USkeletalMesh>(D.GetAsset());
				if (M) { PlayerMesh = M; break; }
			}
		}
	}
	if (PlayerMesh)
	{
		const float H = (float)PlayerMesh->GetBounds().BoxExtent.Z * 2.f;
		PuppetScale = (H > 10.f) ? 188.f / H : 1.f;
	}
	{
		FARFilter F;
		F.PackagePaths.Add(FName(TEXT("/Game")));
		F.bRecursivePaths = true;
		F.ClassPaths.Add(UAnimSequence::StaticClass()->GetClassPathName());
		TArray<FAssetData> Found;
		AR.GetAssets(F, Found);
		FString Names;
		for (const FAssetData& D : Found)
		{
			const FString N = D.AssetName.ToString().ToLower();
			Names += D.AssetName.ToString() + TEXT(" ");
			UAnimSequence* S = Cast<UAnimSequence>(D.GetAsset());
			if (!S) continue;
			if (N.Contains(TEXT("fastrun"))) AnimRun = S;
			else if (!AnimRun && N.Contains(TEXT("run")) && !N.Contains(TEXT("turn"))) AnimRun = S;
			else if (!AnimPush && N.Contains(TEXT("push"))) AnimPush = S;
			else if (!AnimTackle && N.Contains(TEXT("tackle"))) AnimTackle = S;
			else if (!AnimIdle && (N.Contains(TEXT("idle")) || N.Contains(TEXT("stance")) || N.Contains(TEXT("base")))) AnimIdle = S;
		}
		AssetInfo = FString::Printf(TEXT("mesh=%s scale=%.2f anims: %s"), PlayerMesh ? *PlayerMesh->GetName() : TEXT("NONE (using capsules)"), PuppetScale, *Names);
	}
	bAssetsOk = (PlayerMesh != nullptr);
	UE_LOG(LogTemp, Log, TEXT("[FB] %s"), *AssetInfo);
}

void AFbMatch::SpawnPuppets()
{
	UStaticMesh* Cyl = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	Skel.SetNum(FB_N);
	Fallback.SetNum(FB_N);
	for (int32 i = 0; i < FB_N; i++)
	{
		Skel[i] = nullptr; Fallback[i] = nullptr;
		if (PlayerMesh)
		{
			USkeletalMeshComponent* C = NewObject<USkeletalMeshComponent>(this);
			C->SetSkeletalMeshAsset(PlayerMesh);
			C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			C->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
			C->RegisterComponent();
			C->AttachToComponent(Scene, FAttachmentTransformRules::KeepRelativeTransform);
			C->SetWorldScale3D(FVector(PuppetScale));
			C->SetAnimationMode(EAnimationMode::AnimationSingleNode);
			Skel[i] = C;
		}
		else if (Cyl)
		{
			UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(this);
			C->SetStaticMesh(Cyl);
			C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			C->RegisterComponent();
			C->AttachToComponent(Scene, FAttachmentTransformRules::KeepRelativeTransform);
			C->SetWorldScale3D(FVector(0.5f, 0.5f, 1.88f));
			Fallback[i] = C;
		}
	}
}

void AFbMatch::SpawnBall()
{
	UStaticMesh* Sph = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	BallComp = NewObject<UStaticMeshComponent>(this);
	if (Sph) BallComp->SetStaticMesh(Sph);
	BallComp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	BallComp->RegisterComponent();
	BallComp->AttachToComponent(Scene, FAttachmentTransformRules::KeepRelativeTransform);
	BallComp->SetWorldScale3D(FVector(0.34f, 0.21f, 0.21f));
	UMaterialInstanceDynamic* M = BallComp->CreateAndSetMaterialInstanceDynamic(0);
	if (M) M->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.35f, 0.13f, 0.04f, 1.f));
}

void AFbMatch::SpawnCamera()
{
	Cam = GetWorld()->SpawnActor<ACameraActor>(FVector(0.f, 0.f, 600.f), FRotator::ZeroRotator);
	if (Cam && Cam->GetCameraComponent())
	{
		Cam->GetCameraComponent()->bConstrainAspectRatio = false;
		Cam->GetCameraComponent()->SetFieldOfView(72.f);
	}
}

// ------------------------------------------------------------------------------------------------ input
bool AFbMatch::Edge(const FKey& K)
{
	const bool bDown = PC ? PC->IsInputKeyDown(K) : false;
	bool& bPrev = Prev.FindOrAdd(K);
	const bool bEdge = bDown && !bPrev;
	bPrev = bDown;
	return bEdge;
}
void AFbMatch::UpdateInput()
{
	if (!PC) PC = GetWorld()->GetFirstPlayerController();
	if (!PC) return;
	bClick = Edge(EKeys::LeftMouseButton);
	float mx = 0.f, my = 0.f;
	if (PC->GetMousePosition(mx, my)) { MouseX = mx; MouseY = my; }
	KThrow[0] = Edge(EKeys::One); KThrow[1] = Edge(EKeys::Two); KThrow[2] = Edge(EKeys::Three);
	KThrow[3] = Edge(EKeys::Four); KThrow[4] = Edge(EKeys::Five);
	bJuke = Edge(EKeys::SpaceBar);
	bBack = Edge(EKeys::BackSpace);
	bSwitch = Edge(EKeys::Q);
	bTimeoutKey = Edge(EKeys::T);
	if (Cam && PC->GetViewTarget() != Cam) PC->SetViewTarget(Cam);
}

// ------------------------------------------------------------------------------------------------ screens / flow
FFbRatings AFbMatch::MakeRatings(bool bUserOff) const
{
	FFbMeta& M = FFbMeta::Get();
	FFbRatings R = M.Ratings();                      // your lineup: speeds of your offence, the quarterback's accuracy
	const float OppMul = FMath::Clamp(1.f + ((float)Game.OppRating - 80.f) * 0.004f, 0.94f, 1.08f);
	if (bUserOff)
	{
		R.DefMul = OppMul;
	}
	else
	{
		for (int32 k = 0; k < 6; k++) R.OffMul[k] = OppMul;
		R.QbAcc = FMath::Clamp(0.70f + ((float)Game.OppRating - 74.f) * 0.012f, 0.6f, 0.93f);
		R.DefMul = FMath::Clamp(1.f + (M.DefAvg() - 85.f) * 0.004f, 0.94f, 1.06f);
	}
	return R;
}

void AFbMatch::Preview(float Los)
{
	const bool bOff = (Stage == EFbStage::Menu || Stage == EFbStage::UltTeam || Stage == EFbStage::Season || Stage == EFbStage::Final) ? true : Game.UserBall;
	bMirror = !bOff;
	Sim.Setup(0, Los, MakeRatings(bOff), bOff, EFbCall::Man);
	for (int32 i = 0; i < FB_N; i++) { CurAnim[i] = EFbAnim::None; AnimLock[i] = 0.f; Facing[i] = (i < 11) ? 0.f : 180.f; }
	CamX = (bMirror ? -Los : Los) - 21.f; CamZ = 0.f;
}

void AFbMatch::GoMenu() { Stage = EFbStage::Menu; Note = FString(); Preview(-20.f); }
void AFbMatch::GoUltTeam() { Stage = EFbStage::UltTeam; Note = FString(); }
void AFbMatch::GoSeason() { Stage = EFbStage::Season; Note = FString(); }
void AFbMatch::QuitGame() { if (PC) PC->ConsoleCommand(TEXT("quit")); }

void AFbMatch::NewSeason()
{
	FFbMeta& M = FFbMeta::Get();
	M.Week = 1; M.Wins = 0; M.Losses = 0; M.Ties = 0;
}

void AFbMatch::ShowBanner(const FString& Title, const FString& Sub, float Secs)
{
	BannerTitle = Title; BannerSub = Sub; BannerT = Secs;
	Stage = EFbStage::Banner;
}

void AFbMatch::StartGame(bool bSeason)
{
	FFbMeta& M = FFbMeta::Get();
	bSeasonGame = bSeason;
	FString Opp; int32 Rating;
	if (bSeason) { Opp = FString(FFbMeta::OppName(M.Week - 1)); Rating = FFbMeta::OppRatingOf(M.Week - 1); }
	else { const int32 K = FMath::RoundToInt(FMath::FRand() * 7.f); Opp = FString(FFbMeta::OppName(K)); Rating = 80; }
	Game.Reset(Opp, Rating);
	Game.bYouReceivedFirst = true;
	PlayClock = 40.f;
	Preview(Game.Los());
	ShowBanner(FString::Printf(TEXT("YOU  vs  %s"), *Opp),
		bSeason ? FString::Printf(TEXT("SEASON  -  WEEK %d   (opponent rating %d)"), M.Week, Rating) : FString::Printf(TEXT("EXHIBITION   (opponent rating %d)"), Rating), 2.4f);
}

// decides what comes next: your play call, a 4th-down choice, the CPU's turn on offence (you defend), or the final screen
void AFbMatch::NextState()
{
	if (Game.bOver) { FinishGame(); return; }
	PlayClock = 40.f;
	Note = FString();
	if (!Game.UserBall && Game.Down == 4 && Game.CpuFourth() != 0)
	{
		Preview(Game.Los());
		const int32 Ch = Game.CpuFourth();
		FString Out = (Ch == 2) ? Game.FieldGoal((float)Game.OppRating) : Game.Punt();
		const FString Q = Game.CheckQuarterEnd();
		ShowBanner(Out, Q.Len() ? Q : Game.DownText(), 3.4f);
		return;
	}
	Stage = EFbStage::PlayCall;     // so Preview() draws the right side of the ball
	Preview(Game.Los());
	if (Game.UserBall) Stage = (Game.Down == 4) ? EFbStage::FourthDown : EFbStage::PlayCall;
	else Stage = EFbStage::DefCall;
}

void AFbMatch::AfterBannerDone()
{
	NextState();
}

void AFbMatch::StartPlay(int32 PlayIdx)
{
	Sim.Setup(PlayIdx, Game.Los(), MakeRatings(true), true, EFbCall::Man);
	// the CPU defence mixes up its calls
	const float Roll = FMath::FRand();
	Sim.DefCall = (Roll < 0.55f) ? EFbCall::Man : ((Roll < 0.85f) ? EFbCall::Zone : EFbCall::Blitz);
	bMirror = false;
	for (int32 i = 0; i < FB_N; i++) { CurAnim[i] = EFbAnim::None; AnimLock[i] = 0.f; Facing[i] = (i < 11) ? 0.f : 180.f; }
	CamX = Game.Los() - 21.f;
	Stage = EFbStage::Playing;
}

// the CPU has the ball: it calls a play, you pick your coverage and steer one defender
void AFbMatch::ChooseDef(int32 Call)
{
	// run 40% of the time on short yardage, 35% otherwise
	const bool bRunCall = FMath::FRand() < ((Game.ToGo <= 3.f) ? 0.6f : 0.35f);
	int32 Idx = 0;
	for (int32 tries = 0; tries < 30; tries++)
	{
		Idx = FMath::RoundToInt(FMath::FRand() * (float)(Sim.Playbook.Num() - 1));
		if (Sim.Playbook[Idx].bRun == bRunCall) break;
	}
	Sim.Setup(Idx, Game.Los(), MakeRatings(false), false, (Call == 1) ? EFbCall::Zone : ((Call == 2) ? EFbCall::Blitz : EFbCall::Man));
	bMirror = true;
	for (int32 i = 0; i < FB_N; i++) { CurAnim[i] = EFbAnim::None; AnimLock[i] = 0.f; Facing[i] = (i < 11) ? 0.f : 180.f; }
	CamX = -Game.Los() - 21.f;
	Stage = EFbStage::Playing;
}

void AFbMatch::Choose4th(int32 Which)
{
	if (Which == 0) { Stage = EFbStage::PlayCall; return; }
	if (Which == 1)
	{
		const FString Out = Game.Punt();
		const FString Q = Game.CheckQuarterEnd();
		ShowBanner(Out, Q.Len() ? Q : FString(TEXT("They take over")), 3.2f);
		return;
	}
	if (Game.FieldGoalDistance() > FB_FG_MAX) { Note = FString(TEXT("Out of range for a field goal.")); return; }
	const FString Out = Game.FieldGoal(FFbMeta::Get().KickerOvr());
	const FString Q = Game.CheckQuarterEnd();
	ShowBanner(Out, Q.Len() ? Q : FString(), 3.2f);
}

void AFbMatch::CallTimeout()
{
	if (Stage != EFbStage::PlayCall && Stage != EFbStage::FourthDown) return;
	if (Game.CallTimeout()) { PlayClock = 40.f; Note = FString::Printf(TEXT("TIMEOUT  -  %d left"), Game.ToYou); }
	else Note = FString(TEXT("No timeouts left."));
}

void AFbMatch::ResolvePlay()
{
	FString Out;
	const bool bWasUser = Game.UserBall;
	const EFbDrive D = Game.ApplyPlay(Sim, Out);
	const FString Q = Game.CheckQuarterEnd();
	(void)bWasUser;
	if (D == EFbDrive::Continue && Q.Len() == 0)
	{
		Note = Out;
		NextState();
		return;
	}
	ShowBanner(Out, Q.Len() ? Q : Game.DownText(), D == EFbDrive::Continue ? 3.0f : 3.6f);
}

void AFbMatch::FinishGame()
{
	FFbMeta& M = FFbMeta::Get();
	const bool bWin = Game.YouScore > Game.CpuScore;
	const bool bTie = Game.YouScore == Game.CpuScore;
	FinalText = FString::Printf(TEXT("%s   YOU %d  -  %d %s"), bWin ? TEXT("VICTORY") : (bTie ? TEXT("TIE GAME") : TEXT("DEFEAT")), Game.YouScore, Game.CpuScore, *Game.Opp);
	if (bSeasonGame)
	{
		if (bWin) M.Wins++; else if (bTie) M.Ties++; else M.Losses++;
		M.Week++;
	}
	Stage = EFbStage::Final;
	Preview(-20.f);
}

// ------------------------------------------------------------------------------------------------ per frame
void AFbMatch::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.1f);
	CleanT += Dt;
	if (CleanT < 5.f) { CleanAcc += Dt; if (CleanAcc > 0.5f) { CleanAcc = 0.f; CleanupLevel(); } }
	UpdateInput();

	if (Stage == EFbStage::Playing)
	{
		const float s = bMirror ? -1.f : 1.f;           // the view is turned around when you defend
		if (PC)
		{
			float mx = 0.f, mz = 0.f;
			if (PC->IsInputKeyDown(EKeys::W) || PC->IsInputKeyDown(EKeys::Up)) mx += 1.f;
			if (PC->IsInputKeyDown(EKeys::S) || PC->IsInputKeyDown(EKeys::Down)) mx -= 1.f;
			if (PC->IsInputKeyDown(EKeys::D) || PC->IsInputKeyDown(EKeys::Right)) mz += 1.f;
			if (PC->IsInputKeyDown(EKeys::A) || PC->IsInputKeyDown(EKeys::Left)) mz -= 1.f;
			Sim.Move = FVector2D(s * mx, s * mz);
			Sim.bSprint = PC->IsInputKeyDown(EKeys::LeftShift) || PC->IsInputKeyDown(EKeys::RightShift);
		}
		for (int32 k = 0; k < 5; k++) if (KThrow[k]) Sim.Throw(k);
		if (bJuke) { if (Sim.bUserOff) Sim.Juke(); else Sim.Dive(); }
		if (bSwitch) Sim.SwitchDefender();
		float Rem = Dt; int32 N = 0;
		while (Rem > 0.0001f && N < 8) { const float St = FMath::Min(Rem, 1.f / 60.f); Sim.Tick(St); Rem -= St; N++; }
		if (Sim.Phase == EFbPhase::Dead && Sim.DeadT > 2.2f) ResolvePlay();
		if (bBack) GoMenu();
	}
	else if (Stage == EFbStage::Banner)
	{
		BannerT -= Dt;
		if (BannerT <= 0.f || bClick) AfterBannerDone();
	}
	else if (Stage == EFbStage::PlayCall || Stage == EFbStage::FourthDown)
	{
		PlayClock -= Dt;
		if (bTimeoutKey) CallTimeout();
		if (PlayClock <= 0.f)
		{
			// the only penalty in the game: delay of game, 5 yards back
			Game.Ball = FMath::Max(1.f, Game.Ball - 5.f);
			Game.ToGo = Game.LineToGain - Game.Ball;
			PlayClock = 40.f;
			Note = FString(TEXT("DELAY OF GAME  -  5 yards"));
			Preview(Game.Los());
			if (Game.UserBall) Stage = (Game.Down == 4) ? EFbStage::FourthDown : EFbStage::PlayCall;
		}
	}
	else if (Stage == EFbStage::DefCall)
	{
		PlayClock -= Dt;
		if (PlayClock <= 0.f) ChooseDef(0);
	}

	UpdatePuppets(Dt);
	UpdateCamera(Dt);
}

void AFbMatch::SetAnim(int32 I, EFbAnim A)
{
	if (CurAnim[I] == A) return;
	if (A != EFbAnim::Tackle && AnimLock[I] > 0.f && CurAnim[I] != EFbAnim::None) return;
	CurAnim[I] = A;
	AnimLock[I] = 0.25f;
	if (!Skel.IsValidIndex(I) || !Skel[I]) return;
	UAnimSequence* S = nullptr;
	switch (A)
	{
	case EFbAnim::Idle: S = AnimIdle; break;
	case EFbAnim::Run: S = AnimRun; break;
	case EFbAnim::Push: S = AnimPush; break;
	case EFbAnim::Tackle: S = AnimTackle; break;
	default: break;
	}
	if (!S) S = AnimIdle;
	if (S) { Skel[I]->PlayAnimation(S, A != EFbAnim::Tackle); Skel[I]->SetPlayRate(1.f); }
}

void AFbMatch::UpdatePuppets(float Dt)
{
	const bool bLive = (Stage == EFbStage::Playing);
	const float Flip = bMirror ? 180.f : 0.f;
	for (int32 i = 0; i < FB_N; i++)
	{
		const FFbEnt& e = Sim.E[i];
		const float Spd = FMath::Sqrt(e.VX * e.VX + e.VZ * e.VZ);
		const float Home = e.bOff ? 0.f : 180.f;
		float Target = Home;
		if (Spd > 0.3f) Target = FMath::RadiansToDegrees(FMath::Atan2(e.VZ, e.VX));
		const float Delta = FMath::FindDeltaAngleDegrees(Facing[i], Target);
		const float MaxTurn = 600.f * Dt;
		Facing[i] += FMath::Clamp(Delta, -MaxTurn, MaxTurn);

		const FVector Loc = WorldOf(e.X, e.Z, 0.02f);
		const FRotator Rot(0.f, Facing[i] + Flip + ModelYaw, 0.f);
		if (AnimLock[i] > 0.f) AnimLock[i] -= Dt;
		if (Skel.IsValidIndex(i) && Skel[i])
		{
			USkeletalMeshComponent* C = Skel[i];
			C->SetWorldLocationAndRotation(Loc, Rot);
			if (HipsBone != NAME_None)
			{
				// the clips move the hips away from the spot the player is drawn on (that looked like a second, running copy): hold them in place
				FVector Drift = C->GetBoneLocation(HipsBone, EBoneSpaces::WorldSpace) - Loc;
				Drift.Z = 0.f;
				if (Drift.Size() < 600.f) C->SetWorldLocation(Loc - Drift);
			}
		}
		if (Fallback.IsValidIndex(i) && Fallback[i]) Fallback[i]->SetWorldLocationAndRotation(Loc + FVector(0.f, 0.f, 94.f), Rot);

		EFbAnim A = EFbAnim::Idle;
		if (bLive && Sim.bEnded && Sim.Tackler == i && Sim.Result != EFbResult::Incomplete) A = EFbAnim::Tackle;
		else if (Spd > ((CurAnim[i] == EFbAnim::Run) ? 0.9f : 1.7f)) A = EFbAnim::Run;
		else if (bLive && Sim.Phase == EFbPhase::Live && (e.Kind == EFbKind::OL || e.Kind == EFbKind::DL))
		{
			const int32 A0 = (e.Kind == EFbKind::OL) ? FbRole::DL1 : FbRole::OL1;
			for (int32 j = A0; j < A0 + 4 + ((e.Kind == EFbKind::DL) ? 1 : 0); j++)
			{
				const float dx = Sim.E[j].X - e.X, dz = Sim.E[j].Z - e.Z;
				if (dx * dx + dz * dz < 2.9f) { A = EFbAnim::Push; break; }
			}
		}
		SetAnim(i, A);
		if (CurAnim[i] == EFbAnim::Run && Skel.IsValidIndex(i) && Skel[i]) Skel[i]->SetPlayRate(FMath::Clamp(Spd / 6.0f, 0.6f, 1.5f));
	}

	if (BallComp)
	{
		const float s = bMirror ? -1.f : 1.f;
		FRotator BR(0.f, Facing[FbRole::QB] + Flip + ModelYaw + 90.f, 0.f);
		if (Sim.bFlying)
		{
			const float H = FMath::Sqrt(Sim.Bvx * Sim.Bvx + Sim.Bvz * Sim.Bvz);
			BR = FRotator(FMath::RadiansToDegrees(FMath::Atan2(Sim.Bvy, H)), FMath::RadiansToDegrees(FMath::Atan2(s * Sim.Bvz, s * Sim.Bvx)), 0.f);
		}
		BallComp->SetWorldLocationAndRotation(WorldOf(Sim.Bx, Sim.Bz, Sim.By), BR);
	}
}

void AFbMatch::UpdateCamera(float Dt)
{
	if (!Cam) return;
	FVector Loc, Look;
	const bool bMenuView = (Stage == EFbStage::Menu || Stage == EFbStage::UltTeam || Stage == EFbStage::Season || Stage == EFbStage::Final);
	if (bMenuView)
	{
		OrbitT += Dt * 0.25f;
		const float Ang = 3.14159f + 0.55f * FMath::Sin(OrbitT);
		Look = WorldOf(Sim.Los + 1.f, 0.f, 1.2f);
		Loc = Look + FVector(FMath::Cos(Ang) * 17.f * FB_YD, FMath::Sin(Ang) * 17.f * FB_YD, 4.2f * FB_YD);
	}
	else
	{
		const float s = bMirror ? -1.f : 1.f;
		float Fx = Sim.Los, Fz = 0.f;
		if (Stage == EFbStage::Playing)
		{
			if (Sim.bFlying) { Fx = Sim.Bx; Fz = Sim.Bz * 0.6f; }
			else if (Sim.Carrier >= 0) { Fx = Sim.E[Sim.Carrier].X; Fz = Sim.E[Sim.Carrier].Z; }
			else { Fx = Sim.E[FbRole::QB].X; Fz = Sim.E[FbRole::QB].Z; }
			if (Sim.bEnded && Sim.Tackler >= 0 && Sim.Result != EFbResult::Incomplete) { Fx = Sim.E[Sim.Tackler].X; Fz = Sim.E[Sim.Tackler].Z; }
			if (!Sim.bUserOff && Sim.Ctl >= 0 && Sim.Carrier < 0 && !Sim.bFlying) { Fx = 0.5f * (Fx + Sim.E[Sim.Ctl].X); }
		}
		const float K = FMath::Min(1.f, Dt * 3.0f);
		CamX += ((s * Fx - 21.f) - CamX) * K;               // CamX / CamZ are in "view" yards: always looking toward +X
		CamZ += (s * Fz * 0.5f - CamZ) * FMath::Min(1.f, Dt * 2.5f);
		Loc = FVector(CamX * FB_YD, CamZ * FB_YD, 5.8f * FB_YD);
		Look = FVector((CamX + 24.f) * FB_YD, CamZ * 0.8f * FB_YD, 0.9f * FB_YD);
	}
	Cam->SetActorLocationAndRotation(Loc, FRotationMatrix::MakeFromX(Look - Loc).Rotator());
}
