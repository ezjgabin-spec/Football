#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "FbGameMode.generated.h"

// Set as the project's default game mode: pressing Play starts the Ultimate Football menu.
UCLASS()
class FBGAME_API AFbGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	AFbGameMode();
	virtual void BeginPlay() override;
};
