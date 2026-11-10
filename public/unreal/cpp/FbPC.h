#pragma once
#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "FbPC.generated.h"

UCLASS()
class FBGAME_API AFbPC : public APlayerController
{
	GENERATED_BODY()
public:
	AFbPC();
	virtual void BeginPlay() override;
};
