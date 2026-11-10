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

AFbMatch::AFbMatch()
{
	PrimaryActorTick.bCanEverTick = true;
	Scene = CreateDefaultSubobject<USceneComponent>(TEXT("Scene"));
	RootComponent = Scene;
	for (int32 i = 0; i < FB_N; i++) { CurAnim[i] = EFbAnim::None; Facing[i] = (i < 11) ? 0.f : 180.f; }
	for (int32 k = 0; k < 5; k++) KThrow[k] = false;
}

// ------------------------------------------------------------------------------------------------ setup
void AFbMatch::BeginPlay()
{
	Super::BeginPlay();
	PC = GetWorld()->GetFirstPlayerController();
	CleanupLevel();
	LoadAssets();
	SpawnPuppets();
	SpawnBall();
	SpawnCamera();
	FFbMeta::Get();
	GoMenu();
}

void AFbMatch::CleanupLevel()
{
	// the python test script left 22 standing players and a ball in the level: remove them, this class spawns its own
	TArray<AActor*> Kill;
	for (TActorIterator<ASkeletalMeshActor> It(GetWorld()); It; ++It) Kill.Add(*It);
	for (TActorIterator<AStaticMeshActor> It(GetWorld()); It; ++It)
		if (It->GetActorNameOrLabel().Contains(TEXT("FB_Ball"))) Kill.Add(*It);
	for (AActor* A : Kill) if (A) A->Destroy();
}

void AFbMatch::LoadAssets()
{
	FAssetRegistryModule& ARM = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
	IAssetRegistry& AR = ARM.Get();

	{
		FARFilter F;
		F.PackagePaths.Add(FName(TEXT("/Game/Football")));
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
	if (PlayerMesh)
	{
		const float H = (float)PlayerMesh->GetBounds().BoxExtent.Z * 2.f;
		PuppetScale = (H > 10.f) ? 188.f / H : 1.f;
	}
	{
		FARFilter F;
		F.PackagePaths.Add(FName(TEXT("/Game/Football")));
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
	if (Cam && PC->GetViewTarget() != Cam) PC->SetViewTarget(Cam);
}

// ------------------------------------------------------------------------------------------------ screens / flow
void AFbMatch::Preview(float Los)
{
	Sim.Setup(0, Los, FFbMeta::Get().Ratings());
	for (int32 i = 0; i < FB_N; i++) { CurAnim[i] = EFbAnim::None; Facing[i] = (i < 11) ? 0.f : 180.f; }
	CamX = Los - 21.f; CamZ = 0.f;
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

void AFbMatch::StartGame(bool bSeason)
{
	FFbMeta& M = FFbMeta::Get();
	bSeasonGame = bSeason;
	FString Opp; int32 Rating;
	if (bSeason)
	{
		Opp = FString(FFbMeta::OppName(M.Week - 1)); Rating = FFbMeta::OppRatingOf(M.Week - 1);
	}
	else
	{
		const int32 K = FMath::RoundToInt(FMath::FRand() * 7.f);
		Opp = FString(FFbMeta::OppName(K)); Rating = 80;
	}
	Game.Reset(Opp, Rating);
	bNextIsFinal = false;
	BannerTitle = FString::Printf(TEXT("YOU  vs  %s"), *Opp);
	BannerSub = bSeason ? FString::Printf(TEXT("SEASON  -  WEEK %d   (opponent rating %d)"), M.Week, Rating) : FString::Printf(TEXT("EXHIBITION   (opponent rating %d)"), Rating);
	BannerT = 2.4f;
	Stage = EFbStage::Banner;
	AfterBanner = EFbStage::PlayCall;
	Preview(Game.Los());
}

void AFbMatch::AfterBannerDone()
{
	if (bNextIsFinal || Game.bOver) { FinishGame(); return; }
	Preview(Game.Los());
	Stage = (Game.Down == 4) ? EFbStage::FourthDown : EFbStage::PlayCall;
}

void AFbMatch::StartPlay(int32 PlayIdx)
{
	FFbMeta& M = FFbMeta::Get();
	FFbRatings R = M.Ratings();
	R.DefMul = FMath::Clamp(1.f + ((float)Game.OppRating - 80.f) * 0.004f, 0.94f, 1.08f);
	Sim.Setup(PlayIdx, Game.Los(), R);
	for (int32 i = 0; i < FB_N; i++) { CurAnim[i] = EFbAnim::None; Facing[i] = (i < 11) ? 0.f : 180.f; }
	CamX = Game.Los() - 21.f;
	Stage = EFbStage::Playing;
}

void AFbMatch::Choose4th(int32 Which)
{
	if (Which == 0) { Stage = EFbStage::PlayCall; return; }
	if (Which == 1)
	{
		Game.CpuBonus = -0.04f;
		EndUserDrive(TEXT("PUNT   (net 40 yards)"));
		return;
	}
	if (Game.FieldGoalDistance() > 60) { Note = FString(TEXT("Out of range for a field goal.")); return; }
	const bool bGood = Game.KickFieldGoal(FFbMeta::Get().KickerOvr());
	EndUserDrive(bGood ? FString::Printf(TEXT("%d-YARD FIELD GOAL IS GOOD!  +3"), Game.FieldGoalDistance())
	                   : FString::Printf(TEXT("%d-YARD FIELD GOAL MISSED"), Game.FieldGoalDistance()));
}

void AFbMatch::EndUserDrive(const FString& Headline)
{
	const FString Cpu = Game.CpuDrive(FFbMeta::Get().DefAvg());
	Game.AfterCpuDrive();
	BannerTitle = Headline;
	BannerSub = Cpu;
	BannerT = 4.2f;
	bNextIsFinal = Game.bOver;
	Stage = EFbStage::Banner;
}

void AFbMatch::ResolvePlay()
{
	const EFbDrive D = Game.ApplyPlay(Sim);
	switch (D)
	{
	case EFbDrive::Continue:
		Note = Sim.ResultText;
		Preview(Game.Los());
		Stage = (Game.Down == 4) ? EFbStage::FourthDown : EFbStage::PlayCall;
		break;
	case EFbDrive::Score: EndUserDrive(FString(TEXT("TOUCHDOWN!   +7"))); break;
	case EFbDrive::Turnover: EndUserDrive(Sim.ResultText + FString(TEXT("   - TURNOVER"))); break;
	case EFbDrive::Downs: EndUserDrive(FString(TEXT("TURNED IT OVER ON DOWNS"))); break;
	}
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
}

// ------------------------------------------------------------------------------------------------ per frame
void AFbMatch::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.1f);
	UpdateInput();

	if (Stage == EFbStage::Playing)
	{
		if (PC)
		{
			float mx = 0.f, mz = 0.f;
			if (PC->IsInputKeyDown(EKeys::W) || PC->IsInputKeyDown(EKeys::Up)) mx += 1.f;
			if (PC->IsInputKeyDown(EKeys::S) || PC->IsInputKeyDown(EKeys::Down)) mx -= 1.f;
			if (PC->IsInputKeyDown(EKeys::D) || PC->IsInputKeyDown(EKeys::Right)) mz += 1.f;
			if (PC->IsInputKeyDown(EKeys::A) || PC->IsInputKeyDown(EKeys::Left)) mz -= 1.f;
			Sim.Move = FVector2D(mx, mz);
			Sim.bSprint = PC->IsInputKeyDown(EKeys::LeftShift) || PC->IsInputKeyDown(EKeys::RightShift);
		}
		for (int32 k = 0; k < 5; k++) if (KThrow[k]) Sim.Throw(k);
		if (bJuke) Sim.Juke();
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

	UpdatePuppets(Dt);
	UpdateCamera(Dt);
}

void AFbMatch::SetAnim(int32 I, EFbAnim A)
{
	if (CurAnim[I] == A) return;
	CurAnim[I] = A;
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
	if (S) Skel[I]->PlayAnimation(S, A != EFbAnim::Tackle);
}

void AFbMatch::UpdatePuppets(float Dt)
{
	const bool bLive = (Stage == EFbStage::Playing);
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

		const FVector Loc(e.X * FB_YD, e.Z * FB_YD, 2.f);
		const FRotator Rot(0.f, Facing[i] + ModelYaw, 0.f);
		if (Skel.IsValidIndex(i) && Skel[i]) Skel[i]->SetWorldLocationAndRotation(Loc, Rot);
		if (Fallback.IsValidIndex(i) && Fallback[i]) Fallback[i]->SetWorldLocationAndRotation(Loc + FVector(0.f, 0.f, 94.f), Rot);

		EFbAnim A = EFbAnim::Idle;
		if (bLive && Sim.bEnded && Sim.Tackler == i && Sim.Result != EFbResult::Incomplete) A = EFbAnim::Tackle;
		else if (CurAnim[i] == EFbAnim::Tackle && bLive && Sim.bEnded && Sim.Tackler == i) A = EFbAnim::Tackle;
		else if (Spd > 1.2f) A = EFbAnim::Run;
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
	}

	if (BallComp)
	{
		FRotator BR(0.f, Facing[FbRole::QB] + ModelYaw + 90.f, 0.f);
		if (Sim.bFlying)
		{
			const float H = FMath::Sqrt(Sim.Bvx * Sim.Bvx + Sim.Bvz * Sim.Bvz);
			BR = FRotator(FMath::RadiansToDegrees(FMath::Atan2(Sim.Bvy, H)), FMath::RadiansToDegrees(FMath::Atan2(Sim.Bvz, Sim.Bvx)), 0.f);
		}
		BallComp->SetWorldLocationAndRotation(FVector(Sim.Bx * FB_YD, Sim.Bz * FB_YD, Sim.By * FB_YD), BR);
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
		float Fx = Sim.Los, Fz = 0.f;
		if (Stage == EFbStage::Playing)
		{
			if (Sim.bFlying) { Fx = Sim.Bx; Fz = Sim.Bz * 0.6f; }
			else if (Sim.Carrier >= 0) { Fx = Sim.E[Sim.Carrier].X; Fz = Sim.E[Sim.Carrier].Z; }
			else { Fx = Sim.E[FbRole::QB].X; Fz = Sim.E[FbRole::QB].Z; }
			if (Sim.bEnded && Sim.Tackler >= 0 && Sim.Result != EFbResult::Incomplete) { Fx = Sim.E[Sim.Tackler].X; Fz = Sim.E[Sim.Tackler].Z; }
		}
		const float K = FMath::Min(1.f, Dt * 3.0f);
		CamX += ((Fx - 21.f) - CamX) * K;
		CamZ += (Fz * 0.5f - CamZ) * FMath::Min(1.f, Dt * 2.5f);
		Loc = WorldOf(CamX, CamZ, 5.8f);
		Look = WorldOf(CamX + 24.f, CamZ * 0.8f, 0.9f);
	}
	Cam->SetActorLocationAndRotation(Loc, FRotationMatrix::MakeFromX(Look - Loc).Rotator());
}
