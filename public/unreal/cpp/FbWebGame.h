#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "UObject/Object.h"
#include "IWebBrowserWindow.h"
#include "FbWebGame.generated.h"

class SWebBrowser;

// The web game talks to Unreal through this object: in the page it is window.ue.fb
UCLASS()
class FBGAME_API UFbBridge : public UObject
{
	GENERATED_BODY()
public:
	UFUNCTION() void Report(FString Msg);        // window.ue.fb.report("text")  -> written to the Unreal log as [FB] ...
	UFUNCTION() void Frame(FString Data);        // window.ue.fb.frame(json)     -> the game state of this frame (players, ball, camera)
	FString LastFrame;
	int32 FrameCount = 0;
};

// Runs the real Ultimate Football game (the same code as the web version) inside the Unreal window.
UCLASS()
class FBGAME_API AFbWebGame : public AActor
{
	GENERATED_BODY()
public:
	AFbWebGame();
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void Tick(float DeltaSeconds) override;

private:
	UPROPERTY() UFbBridge* Bridge = nullptr;
	TSharedPtr<SWebBrowser> Browser;
	FString Url;
	bool bInputSet = false;
	float Age = 0.f, NextLog = 5.f;

	void HandleLoaded();
	void HandleLoadError();
	void HandleConsole(const FString& Message, const FString& Source, int32 Line, EWebBrowserConsoleLogSeverity Severity);
};
