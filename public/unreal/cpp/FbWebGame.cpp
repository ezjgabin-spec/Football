#include "FbWebGame.h"
#include "SWebBrowser.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "Engine/GameViewportClient.h"
#include "GameFramework/PlayerController.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

void UFbBridge::Report(FString Msg)
{
	UE_LOG(LogTemp, Log, TEXT("[FB] page: %s"), *Msg);
}

void UFbBridge::Frame(FString Data)
{
	LastFrame = MoveTemp(Data);
	FrameCount++;
}

AFbWebGame::AFbWebGame()
{
	PrimaryActorTick.bCanEverTick = true;
}

void AFbWebGame::BeginPlay()
{
	Super::BeginPlay();
	Bridge = NewObject<UFbBridge>(this);

	// the address of the game; put a different one in <project>/FbUrl.txt to override it
	Url = TEXT("https://football.ezjgabin.workers.dev/?ue=1");
	FString FromFile;
	if (FFileHelper::LoadFileToString(FromFile, *(FPaths::ProjectDir() / TEXT("FbUrl.txt"))))
	{
		FromFile.TrimStartAndEndInline();
		if (FromFile.Len() > 8) Url = FromFile;
	}
	UE_LOG(LogTemp, Log, TEXT("[FB] web game: opening %s"), *Url);

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
		UE_LOG(LogTemp, Log, TEXT("[FB] web game: browser created"));
	}
	else
	{
		UE_LOG(LogTemp, Error, TEXT("[FB] web game: no game viewport"));
	}
}

void AFbWebGame::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (Browser.IsValid() && GEngine && GEngine->GameViewport) GEngine->GameViewport->RemoveViewportWidgetContent(Browser.ToSharedRef());
	Browser.Reset();
	Super::EndPlay(EndPlayReason);
}

void AFbWebGame::HandleLoaded()
{
	UE_LOG(LogTemp, Log, TEXT("[FB] web game: page loaded"));
	if (!Browser.IsValid()) return;
	// ask the page what it can do (is 3D available inside Unreal's browser? how big is the window?)
	Browser->ExecuteJavascript(TEXT(
		"(function(){try{var c=document.createElement('canvas');var g=c.getContext('webgl2');var g1=g||c.getContext('webgl');"
		"var d=g1?g1.getExtension('WEBGL_debug_renderer_info'):null;"
		"var msg='webgl2='+(!!g)+' webgl='+(!!g1)+' gpu='+(d?g1.getParameter(d.UNMASKED_RENDERER_WEBGL):'?')+' size='+innerWidth+'x'+innerHeight+' title='+document.title+' ua='+navigator.userAgent;"
		"if(window.ue&&window.ue.fb){window.ue.fb.report(msg);}else{console.log('FBPROBE no bridge '+msg);}}catch(e){console.log('FBPROBE error '+e);}})();"));
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
	if (!bInputSet)
	{
		APlayerController* PC = GetWorld()->GetFirstPlayerController();
		if (PC)
		{
			FInputModeUIOnly Mode;
			Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
			PC->SetInputMode(Mode);
			PC->bShowMouseCursor = true;
			bInputSet = true;
		}
	}
	if (Age > NextLog)
	{
		NextLog += 15.f;
		UE_LOG(LogTemp, Log, TEXT("[FB] web game: running %.0f s, frames from the page: %d"), Age, Bridge ? Bridge->FrameCount : -1);
	}
}
