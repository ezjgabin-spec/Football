#include "FbGameMode.h"
#include "FbHUD.h"
#include "FbPC.h"
#include "FbMatch.h"
#include "Engine/World.h"

AFbGameMode::AFbGameMode()
{
	DefaultPawnClass = nullptr;
	HUDClass = AFbHUD::StaticClass();
	PlayerControllerClass = AFbPC::StaticClass();
}

void AFbGameMode::BeginPlay()
{
	Super::BeginPlay();
	FActorSpawnParameters P;
	P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	GetWorld()->SpawnActor<AFbMatch>(FVector::ZeroVector, FRotator::ZeroRotator, P);
}
