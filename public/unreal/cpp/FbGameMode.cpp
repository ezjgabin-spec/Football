#include "FbGameMode.h"
#include "FbPC.h"
#include "FbWebGame.h"
#include "Engine/World.h"

AFbGameMode::AFbGameMode()
{
	DefaultPawnClass = nullptr;
	PlayerControllerClass = AFbPC::StaticClass();
}

void AFbGameMode::BeginPlay()
{
	Super::BeginPlay();
	FActorSpawnParameters P;
	P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	GetWorld()->SpawnActor<AFbWebGame>(FVector::ZeroVector, FRotator::ZeroRotator, P);
}
