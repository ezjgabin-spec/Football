#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "InputCoreTypes.h"
#include "FbSim.h"
#include "FbMatch.generated.h"

class USkeletalMesh;
class USkeletalMeshComponent;
class UStaticMeshComponent;
class UAnimSequence;
class ACameraActor;
class APlayerController;
class USceneComponent;

enum class EFbStage : uint8 { Menu, UltTeam, Season, PlayCall, FourthDown, Playing, Banner, Final };
enum class EFbAnim : uint8 { None, Idle, Run, Push, Tackle };

// The whole game lives in this one actor: menus, the 22 players, the ball, the camera and the rules.
UCLASS()
class FBGAME_API AFbMatch : public AActor
{
	GENERATED_BODY()
public:
	AFbMatch();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	// ---- state the HUD reads / buttons the HUD presses
	EFbStage Stage = EFbStage::Menu;
	FFbSim Sim;
	FFbGame Game;
	bool bSeasonGame = false;
	FString BannerTitle, BannerSub;
	float BannerT = 0.f;
	FString FinalText;
	FString Note;                 // small message line (e.g. "no kicker range")
	float MouseX = 0.f, MouseY = 0.f;
	bool bClick = false;
	bool bAssetsOk = false;
	FString AssetInfo;

	void GoMenu();
	void GoUltTeam();
	void GoSeason();
	void StartGame(bool bSeason);
	void StartPlay(int32 PlayIdx);
	void Choose4th(int32 Which);   // 0 go for it, 1 punt, 2 field goal
	void FinishGame();
	void QuitGame();
	void NewSeason();
	FVector WorldOf(float X, float Z, float H) const { return FVector(X * FB_YD, Z * FB_YD, H * FB_YD); }

private:
	UPROPERTY() USceneComponent* Scene = nullptr;
	UPROPERTY() USkeletalMesh* PlayerMesh = nullptr;
	UPROPERTY() TArray<USkeletalMeshComponent*> Skel;
	UPROPERTY() TArray<UStaticMeshComponent*> Fallback;
	UPROPERTY() UStaticMeshComponent* BallComp = nullptr;
	UPROPERTY() ACameraActor* Cam = nullptr;
	UPROPERTY() UAnimSequence* AnimIdle = nullptr;
	UPROPERTY() UAnimSequence* AnimRun = nullptr;
	UPROPERTY() UAnimSequence* AnimPush = nullptr;
	UPROPERTY() UAnimSequence* AnimTackle = nullptr;
	UPROPERTY() APlayerController* PC = nullptr;

	EFbAnim CurAnim[FB_N];
	float Facing[FB_N];
	float PuppetScale = 1.f;
	float ModelYaw = -90.f;
	float CamX = -40.f, CamZ = 0.f, OrbitT = 0.f;
	EFbStage AfterBanner = EFbStage::PlayCall;
	bool bNextIsFinal = false;
	TMap<FKey, bool> Prev;
	bool KThrow[5];
	bool bJuke = false;
	bool bBack = false;

	bool Edge(const FKey& K);
	void UpdateInput();
	void CleanupLevel();
	void LoadAssets();
	void SpawnPuppets();
	void SpawnBall();
	void SpawnCamera();
	void Preview(float Los);
	void UpdatePuppets(float Dt);
	void UpdateCamera(float Dt);
	void SetAnim(int32 I, EFbAnim A);
	void ResolvePlay();
	void EndUserDrive(const FString& Headline);
	void AfterBannerDone();
};
