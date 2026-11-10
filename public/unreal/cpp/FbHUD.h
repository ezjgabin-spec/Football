#pragma once
#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "FbHUD.generated.h"

class AFbMatch;

// Draws every menu and every on-screen element with plain canvas calls (no UMG assets needed).
UCLASS()
class FBGAME_API AFbHUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void DrawHUD() override;

private:
	UPROPERTY() AFbMatch* Match = nullptr;
	float W = 1920.f, H = 1080.f, S = 1.f;

	void Txt(const FString& Text, float X, float Y, float Scale, const FLinearColor& Col, bool bCenter = false);
	bool Btn(const FString& Label, float X, float Y, float BW, float BH, const FLinearColor& Col, float Scale = 1.6f);
	void Frame(float X, float Y, float BW, float BH, float Th, const FLinearColor& Col);
	void DrawScoreboard();
	void DrawMenu();
	void DrawUltTeam();
	void DrawSeason();
	void DrawPlayCall();
	void DrawFourth();
	void DrawDefCall();
	void DrawPlaying();
	void DrawBanner();
	void DrawFinal();
	void DrawMarkers();
};
