#include "FbHUD.h"
#include "FbMatch.h"
#include "Engine/Canvas.h"
#include "Engine/World.h"
#include "EngineUtils.h"

static const FLinearColor C_GOLD(1.f, 0.82f, 0.25f, 1.f);
static const FLinearColor C_WHITE(1.f, 1.f, 1.f, 1.f);
static const FLinearColor C_GREY(0.75f, 0.78f, 0.85f, 1.f);
static const FLinearColor C_DIM(0.f, 0.f, 0.f, 0.62f);

void AFbHUD::Txt(const FString& Text, float X, float Y, float Scale, const FLinearColor& Col, bool bCenter)
{
	float TW = 0.f, TH = 0.f;
	GetTextSize(Text, TW, TH, nullptr, Scale * S);
	DrawText(Text, Col, bCenter ? X - TW * 0.5f : X, Y, nullptr, Scale * S, false);
}

void AFbHUD::Frame(float X, float Y, float BW, float BH, float Th, const FLinearColor& Col)
{
	DrawRect(Col, X, Y, BW, Th);
	DrawRect(Col, X, Y + BH - Th, BW, Th);
	DrawRect(Col, X, Y, Th, BH);
	DrawRect(Col, X + BW - Th, Y, Th, BH);
}

bool AFbHUD::Btn(const FString& Label, float X, float Y, float BW, float BH, const FLinearColor& Col, float Scale)
{
	const bool bHover = Match->MouseX >= X && Match->MouseX <= X + BW && Match->MouseY >= Y && Match->MouseY <= Y + BH;
	FLinearColor C = Col;
	if (bHover) { C.R = FMath::Min(1.f, C.R + 0.18f); C.G = FMath::Min(1.f, C.G + 0.18f); C.B = FMath::Min(1.f, C.B + 0.18f); }
	DrawRect(C, X, Y, BW, BH);
	Frame(X, Y, BW, BH, 2.f * S, bHover ? C_GOLD : FLinearColor(1.f, 1.f, 1.f, 0.35f));
	float TW = 0.f, TH = 0.f;
	GetTextSize(Label, TW, TH, nullptr, Scale * S);
	DrawText(Label, C_WHITE, X + (BW - TW) * 0.5f, Y + (BH - TH) * 0.5f, nullptr, Scale * S, false);
	if (bHover && Match->bClick) { Match->bClick = false; return true; }
	return false;
}

void AFbHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas) return;
	if (!Match)
	{
		for (TActorIterator<AFbMatch> It(GetWorld()); It; ++It) { Match = *It; break; }
		if (!Match) return;
	}
	W = (float)Canvas->SizeX; H = (float)Canvas->SizeY; S = H / 1080.f;
	Txt(Match->AssetInfo.Left(160), 8.f * S, H - 22.f * S, 0.9f, FLinearColor(1.f, 1.f, 0.4f, 1.f));

	switch (Match->Stage)
	{
	case EFbStage::Menu: DrawMenu(); break;
	case EFbStage::UltTeam: DrawUltTeam(); break;
	case EFbStage::Season: DrawSeason(); break;
	case EFbStage::PlayCall: DrawScoreboard(); DrawPlayCall(); break;
	case EFbStage::FourthDown: DrawScoreboard(); DrawFourth(); break;
	case EFbStage::DefCall: DrawScoreboard(); DrawDefCall(); break;
	case EFbStage::Playing: DrawScoreboard(); DrawMarkers(); DrawPlaying(); break;
	case EFbStage::Banner: DrawScoreboard(); DrawBanner(); break;
	case EFbStage::Final: DrawFinal(); break;
	}
}

// ------------------------------------------------------------------------------------------------ scoreboard
void AFbHUD::DrawScoreboard()
{
	const FFbGame& G = Match->Game;
	DrawRect(FLinearColor(0.02f, 0.03f, 0.08f, 0.88f), 0.f, 0.f, W, 80.f * S);
	const FLinearColor YouCol(0.55f, 0.8f, 1.f, 1.f), CpuCol(1.f, 0.55f, 0.5f, 1.f);
	Txt(FString::Printf(TEXT("YOU  %d"), G.YouScore), 30.f * S, 12.f * S, 3.4f, YouCol);
	Txt(FString::Printf(TEXT("%s  %d"), *G.Opp, G.CpuScore), W - 30.f * S - 250.f * S, 12.f * S, 3.4f, CpuCol);
	Txt(FString::Printf(TEXT("%s   %s"), *G.QText(), *G.ClockText()), W * 0.5f, 4.f * S, 2.2f, C_WHITE, true);
	Txt(FString::Printf(TEXT("%s has the ball   -   %s"), G.UserBall ? TEXT("YOU") : *G.Opp, *G.DownText()), W * 0.5f, 36.f * S, 1.5f, G.UserBall ? YouCol : CpuCol, true);
	Txt(FString::Printf(TEXT("TIMEOUTS %d"), G.ToYou), 30.f * S, 60.f * S, 1.0f, C_GREY);
	if (Match->Stage == EFbStage::PlayCall || Match->Stage == EFbStage::FourthDown || Match->Stage == EFbStage::DefCall)
		Txt(FString::Printf(TEXT("PLAY CLOCK %d"), FMath::Max(0, (int32)Match->PlayClock)), W * 0.5f, 60.f * S, 1.2f, Match->PlayClock < 8.f ? FLinearColor(1.f, 0.4f, 0.3f, 1.f) : C_GREY, true);
}

// ------------------------------------------------------------------------------------------------ main menu
void AFbHUD::DrawMenu()
{
	DrawRect(C_DIM, 0.f, 0.f, W * 0.44f, H);
	const float X = W * 0.05f;
	Txt(TEXT("ULTIMATE"), X, H * 0.10f, 7.f, C_WHITE);
	Txt(TEXT("FOOTBALL"), X, H * 0.10f + 105.f * S, 7.f, C_GOLD);
	Txt(TEXT("UNREAL EDITION  -  STAGE 1"), X, H * 0.10f + 225.f * S, 1.5f, C_GREY);
	const float BW = W * 0.31f, BH = 74.f * S;
	float Y = H * 0.45f;
	if (Btn(TEXT("PLAY NOW"), X, Y, BW, BH, FLinearColor(0.1f, 0.35f, 0.15f, 0.95f), 2.2f)) Match->StartGame(false);
	Y += BH + 18.f * S;
	if (Btn(TEXT("ULTIMATE TEAM"), X, Y, BW, BH, FLinearColor(0.35f, 0.2f, 0.5f, 0.95f), 2.2f)) Match->GoUltTeam();
	Y += BH + 18.f * S;
	if (Btn(TEXT("SEASON"), X, Y, BW, BH, FLinearColor(0.1f, 0.25f, 0.5f, 0.95f), 2.2f)) Match->GoSeason();
	Y += BH + 18.f * S;
	if (Btn(TEXT("QUIT"), X, Y, BW, BH, FLinearColor(0.35f, 0.1f, 0.1f, 0.95f), 2.2f)) Match->QuitGame();
	Txt(TEXT("Click once inside the game window so the keyboard works."), X, H - 70.f * S, 1.2f, C_GREY);
	if (!Match->bAssetsOk) Txt(TEXT("Player model not found in /Game/Football - using placeholder capsules."), X, H - 44.f * S, 1.2f, FLinearColor(1.f, 0.5f, 0.4f, 1.f));
}

// ------------------------------------------------------------------------------------------------ ultimate team
static FLinearColor FbTierColor(const FString& Tier)
{
	if (Tier == FString(TEXT("LEGEND"))) return FLinearColor(0.50f, 0.36f, 0.04f, 0.95f);
	return FLinearColor(0.30f, 0.10f, 0.45f, 0.95f);
}

void AFbHUD::DrawUltTeam()
{
	FFbMeta& M = FFbMeta::Get();
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.72f), 0.f, 0.f, W, H);
	Txt(TEXT("ULTIMATE TEAM"), 40.f * S, 22.f * S, 4.f, C_GOLD);
	Txt(TEXT("Click a card to put him in your lineup (WR cards rotate through WR 1 / 2 / 3). Your lineup changes your players' speed, the QB's accuracy and your defence."), 40.f * S, 100.f * S, 1.2f, C_GREY);
	if (Btn(TEXT("BACK"), W - 200.f * S, 20.f * S, 160.f * S, 56.f * S, FLinearColor(0.35f, 0.1f, 0.1f, 0.95f), 1.8f)) Match->GoMenu();

	// lineup on the left
	const float LX = 40.f * S, LY = 140.f * S;
	DrawRect(FLinearColor(0.05f, 0.06f, 0.12f, 0.9f), LX, LY, 520.f * S, 11.f * 62.f * S + 70.f * S);
	Txt(TEXT("YOUR LINEUP"), LX + 16.f * S, LY + 8.f * S, 2.0f, C_WHITE);
	for (int32 s = 0; s < 11; s++)
	{
		const float Y = LY + 56.f * S + (float)s * 62.f * S;
		const FFbCardDef* C = M.SlotCard(s);
		DrawRect(C ? FbTierColor(C->Tier) : FLinearColor(0.2f, 0.2f, 0.2f, 0.8f), LX + 10.f * S, Y, 500.f * S, 54.f * S);
		Txt(FFbMeta::SlotName(s), LX + 22.f * S, Y + 14.f * S, 1.5f, C_GOLD);
		if (C)
		{
			Txt(C->Name, LX + 120.f * S, Y + 14.f * S, 1.5f, C_WHITE);
			Txt(FString::Printf(TEXT("%d"), C->Ovr), LX + 470.f * S, Y + 14.f * S, 1.8f, C_WHITE);
		}
	}

	// the card collection on the right
	const int32 Cols = 5;
	const float CW = 250.f * S, CH = 76.f * S, Gap = 10.f * S;
	const float GX = W - 40.f * S - (float)Cols * (CW + Gap) + Gap, GY = 140.f * S;
	for (int32 i = 0; i < M.Cards.Num(); i++)
	{
		const FFbCardDef& C = M.Cards[i];
		const float X = GX + (float)(i % Cols) * (CW + Gap), Y = GY + (float)(i / Cols) * (CH + Gap);
		bool bIn = false;
		for (int32 s = 0; s < 11; s++) if (M.Slot[s] == i) bIn = true;
		const bool bHover = Match->MouseX >= X && Match->MouseX <= X + CW && Match->MouseY >= Y && Match->MouseY <= Y + CH;
		FLinearColor Col = FbTierColor(C.Tier);
		if (bHover) { Col.R += 0.15f; Col.G += 0.15f; Col.B += 0.15f; }
		DrawRect(Col, X, Y, CW, CH);
		Frame(X, Y, CW, CH, bIn ? 4.f * S : 1.f * S, bIn ? C_WHITE : FLinearColor(1.f, 1.f, 1.f, 0.25f));
		Txt(C.Name, X + 10.f * S, Y + 8.f * S, 1.25f, C_WHITE);
		Txt(FString::Printf(TEXT("%s  %s  #%d"), *C.Pos, *C.Team, C.Jersey), X + 10.f * S, Y + 42.f * S, 1.0f, C_GREY);
		Txt(FString::Printf(TEXT("%d"), C.Ovr), X + CW - 58.f * S, Y + 18.f * S, 2.2f, C_GOLD);
		if (bHover && Match->bClick) { Match->bClick = false; M.Equip(i); }
	}
	Txt(TEXT("More cards, packs and the online store come in the next stages."), GX, GY + 8.f * (CH + Gap) + 6.f * S, 1.1f, C_GREY);
}

// ------------------------------------------------------------------------------------------------ season
void AFbHUD::DrawSeason()
{
	FFbMeta& M = FFbMeta::Get();
	DrawRect(C_DIM, 0.f, 0.f, W * 0.5f, H);
	const float X = W * 0.05f;
	Txt(TEXT("SEASON"), X, H * 0.08f, 6.f, C_GOLD);
	Txt(FString::Printf(TEXT("RECORD   %d - %d%s"), M.Wins, M.Losses, M.Ties ? *FString::Printf(TEXT(" - %d"), M.Ties) : TEXT("")), X, H * 0.08f + 100.f * S, 2.6f, C_WHITE);
	const bool bDone = M.Week > FFbMeta::SeasonLength();
	const float BW = W * 0.34f, BH = 74.f * S;
	float Y = H * 0.44f;
	if (!bDone)
	{
		Txt(FString::Printf(TEXT("WEEK %d of %d"), M.Week, FFbMeta::SeasonLength()), X, Y - 100.f * S, 2.2f, C_GREY);
		Txt(FString::Printf(TEXT("vs  %s   (rating %d)"), FFbMeta::OppName(M.Week - 1), FFbMeta::OppRatingOf(M.Week - 1)), X, Y - 55.f * S, 2.2f, C_WHITE);
		if (Btn(TEXT("PLAY GAME"), X, Y, BW, BH, FLinearColor(0.1f, 0.35f, 0.15f, 0.95f), 2.2f)) Match->StartGame(true);
	}
	else
	{
		const bool bGood = M.Wins > M.Losses;
		Txt(bGood ? TEXT("SEASON COMPLETE - WINNING SEASON!") : TEXT("SEASON COMPLETE"), X, Y - 70.f * S, 2.2f, C_WHITE);
		if (Btn(TEXT("NEW SEASON"), X, Y, BW, BH, FLinearColor(0.1f, 0.35f, 0.15f, 0.95f), 2.2f)) Match->NewSeason();
	}
	Y += BH + 18.f * S;
	if (Btn(TEXT("ULTIMATE TEAM"), X, Y, BW, BH, FLinearColor(0.35f, 0.2f, 0.5f, 0.95f), 2.0f)) Match->GoUltTeam();
	Y += BH + 18.f * S;
	if (Btn(TEXT("BACK"), X, Y, BW, BH, FLinearColor(0.35f, 0.1f, 0.1f, 0.95f), 2.0f)) Match->GoMenu();
}

// ------------------------------------------------------------------------------------------------ play calling
void AFbHUD::DrawPlayCall()
{
	const float PY = H * 0.56f;
	DrawRect(FLinearColor(0.02f, 0.03f, 0.08f, 0.9f), 0.f, PY, W, H - PY);
	Txt(TEXT("CALL YOUR PLAY"), 30.f * S, PY + 8.f * S, 2.2f, C_GOLD);
	if (Match->Note.Len() > 0) Txt(Match->Note, W * 0.5f, PY + 14.f * S, 1.5f, C_GREY, true);
	if (Btn(FString::Printf(TEXT("TIMEOUT (%d)  [T]"), Match->Game.ToYou), W - 330.f * S, PY + 4.f * S, 300.f * S, 44.f * S, FLinearColor(0.4f, 0.3f, 0.1f, 0.95f), 1.3f)) Match->CallTimeout();
	const TArray<FFbPlayDef>& PB = Match->Sim.Playbook;
	const int32 Cols = 5;
	const float Pad = 30.f * S, Gap = 10.f * S;
	const float BW = (W - 2.f * Pad - (float)(Cols - 1) * Gap) / (float)Cols;
	const float BH = (H - PY - 70.f * S - 4.f * Gap) / 5.f;
	for (int32 i = 0; i < PB.Num(); i++)
	{
		const float X = Pad + (float)(i % Cols) * (BW + Gap), Y = PY + 56.f * S + (float)(i / Cols) * (BH + Gap);
		const FLinearColor Col = PB[i].bRun ? FLinearColor(0.10f, 0.36f, 0.14f, 0.95f) : FLinearColor(0.10f, 0.24f, 0.5f, 0.95f);
		if (Btn(FString::Printf(TEXT("%s%s"), *PB[i].Name, PB[i].bRun ? TEXT("  (run)") : TEXT("")), X, Y, BW, BH, Col, 1.5f)) Match->StartPlay(i);
	}
}

void AFbHUD::DrawFourth()
{
	DrawRect(C_DIM, 0.f, 0.f, W, H);
	Txt(TEXT("4TH DOWN"), W * 0.5f, H * 0.18f, 6.f, C_GOLD, true);
	Txt(Match->Game.DownText(), W * 0.5f, H * 0.18f + 100.f * S, 2.2f, C_WHITE, true);
	const float BW = 520.f * S, BH = 78.f * S, X = W * 0.5f - BW * 0.5f;
	float Y = H * 0.42f;
	if (Btn(TEXT("GO FOR IT"), X, Y, BW, BH, FLinearColor(0.1f, 0.35f, 0.15f, 0.95f), 2.2f)) Match->Choose4th(0);
	Y += BH + 18.f * S;
	if (Btn(TEXT("PUNT"), X, Y, BW, BH, FLinearColor(0.1f, 0.25f, 0.5f, 0.95f), 2.2f)) Match->Choose4th(1);
	Y += BH + 18.f * S;
	const int32 Dist = Match->Game.FieldGoalDistance();
	const bool bRange = Dist <= FB_FG_MAX;
	if (Btn(FString::Printf(TEXT("FIELD GOAL  (%d yd)"), Dist), X, Y, BW, BH, bRange ? FLinearColor(0.35f, 0.2f, 0.5f, 0.95f) : FLinearColor(0.2f, 0.2f, 0.2f, 0.9f), 2.2f)) Match->Choose4th(2);
	if (Btn(FString::Printf(TEXT("TIMEOUT (%d)  [T]"), Match->Game.ToYou), X, Y + BH + 18.f * S, BW, 56.f * S, FLinearColor(0.4f, 0.3f, 0.1f, 0.95f), 1.6f)) Match->CallTimeout();
	if (Match->Note.Len() > 0) Txt(Match->Note, W * 0.5f, Y + BH + 90.f * S, 1.5f, FLinearColor(1.f, 0.6f, 0.5f, 1.f), true);
}

void AFbHUD::DrawDefCall()
{
	DrawRect(C_DIM, 0.f, H * 0.55f, W, H * 0.45f);
	Txt(FString::Printf(TEXT("%s HAS THE BALL  -  CALL YOUR DEFENCE"), *Match->Game.Opp), W * 0.5f, H * 0.58f, 2.6f, C_GOLD, true);
	Txt(TEXT("You steer one defender: WASD move, SHIFT sprint, SPACE dive tackle, Q switch player"), W * 0.5f, H * 0.58f + 70.f * S, 1.3f, C_GREY, true);
	const float BW = W * 0.26f, BH = 110.f * S, Gap = 24.f * S;
	const float X0 = W * 0.5f - (3.f * BW + 2.f * Gap) * 0.5f, Y = H * 0.72f;
	if (Btn(TEXT("MAN COVERAGE"), X0, Y, BW, BH, FLinearColor(0.1f, 0.25f, 0.5f, 0.95f), 2.0f)) Match->ChooseDef(0);
	if (Btn(TEXT("ZONE"), X0 + BW + Gap, Y, BW, BH, FLinearColor(0.1f, 0.36f, 0.14f, 0.95f), 2.0f)) Match->ChooseDef(1);
	if (Btn(TEXT("BLITZ"), X0 + 2.f * (BW + Gap), Y, BW, BH, FLinearColor(0.5f, 0.12f, 0.1f, 0.95f), 2.0f)) Match->ChooseDef(2);
	Txt(TEXT("everyone sticks to a receiver"), X0 + BW * 0.5f, Y + BH + 10.f * S, 1.0f, C_GREY, true);
	Txt(TEXT("defenders guard an area"), X0 + BW + Gap + BW * 0.5f, Y + BH + 10.f * S, 1.0f, C_GREY, true);
	Txt(TEXT("linebackers rush the passer"), X0 + 2.f * (BW + Gap) + BW * 0.5f, Y + BH + 10.f * S, 1.0f, C_GREY, true);
	if (Match->Note.Len() > 0) Txt(Match->Note, W * 0.5f, H * 0.58f + 110.f * S, 1.4f, C_WHITE, true);
}

// ------------------------------------------------------------------------------------------------ during a play
void AFbHUD::DrawMarkers()
{
	const FFbSim& Sm = Match->Sim;
	const int32 Ctl = Sm.Controlled();
	for (int32 i = 0; i < FB_N; i++)
	{
		const FFbEnt& e = Sm.E[i];
		const FVector P = Project(Match->WorldOf(e.X, e.Z, 2.45f));
		if (P.X < 0.f || P.X > W || P.Y < 0.f || P.Y > H) continue;
		const float Sz = 11.f * S;
		FLinearColor Col = (e.bOff == Sm.bUserOff) ? FLinearColor(0.3f, 0.7f, 1.f, 1.f) : FLinearColor(1.f, 0.3f, 0.25f, 1.f);   // blue = your team
		if (i == Ctl) Col = FLinearColor(0.3f, 1.f, 0.35f, 1.f);
		DrawRect(Col, P.X - Sz * 0.5f, P.Y - Sz * 0.5f, Sz, Sz);
		if (Sm.bUserOff && !Sm.bRun && Sm.Carrier < 0 && !Sm.bFlying && !Sm.bEnded)
		{
			int32 Num = 0;
			switch (i) { case FbRole::W1: Num = 1; break; case FbRole::W2: Num = 2; break; case FbRole::W3: Num = 3; break; case FbRole::TE: Num = 4; break; case FbRole::RB: Num = 5; break; default: break; }
			if (Num > 0) Txt(FString::Printf(TEXT("%d"), Num), P.X, P.Y - 34.f * S, 2.2f, C_GOLD, true);
		}
		if (i == Ctl) Txt(TEXT("YOU"), P.X, P.Y - 30.f * S, 1.2f, FLinearColor(0.3f, 1.f, 0.35f, 1.f), true);
	}
}

void AFbHUD::DrawPlaying()
{
	const FFbSim& Sm = Match->Sim;
	if (Sm.Phase == EFbPhase::Pre) Txt(Sm.bUserOff ? (Sm.bRun ? TEXT("RUN PLAY - get ready") : TEXT("PASS PLAY - get ready")) : TEXT("DEFEND!"), W * 0.5f, H * 0.2f, 3.f, C_WHITE, true);
	if (Sm.Status.Len() > 0 && !Sm.bEnded) Txt(Sm.Status, W * 0.5f, H * 0.14f, 2.4f, C_GOLD, true);
	if (Sm.bEnded)
	{
		DrawRect(C_DIM, 0.f, H * 0.38f, W, 150.f * S);
		Txt(Sm.ResultText, W * 0.5f, H * 0.38f + 40.f * S, 3.4f, C_WHITE, true);
	}
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.55f), 0.f, H - 52.f * S, W, 52.f * S);
	if (!Sm.bUserOff) Txt(TEXT("DEFENCE:  WASD move   SHIFT sprint   SPACE dive tackle   Q switch player   BACKSPACE = quit to menu"), W * 0.5f, H - 40.f * S, 1.3f, C_GREY, true);
	else if (!Sm.bRun) Txt(TEXT("WASD move   SHIFT sprint   1 2 3 4 5 = throw to W1 W2 W3 TE RB   SPACE juke   BACKSPACE = quit to menu"), W * 0.5f, H - 40.f * S, 1.3f, C_GREY, true);
	else Txt(TEXT("WASD move   SHIFT sprint   SPACE juke / break tackle   BACKSPACE = quit to menu"), W * 0.5f, H - 40.f * S, 1.3f, C_GREY, true);
}

void AFbHUD::DrawBanner()
{
	DrawRect(C_DIM, 0.f, H * 0.30f, W, 300.f * S);
	Txt(Match->BannerTitle, W * 0.5f, H * 0.30f + 60.f * S, 3.6f, C_GOLD, true);
	Txt(Match->BannerSub, W * 0.5f, H * 0.30f + 170.f * S, 2.0f, C_WHITE, true);
	Txt(TEXT("click to skip"), W * 0.5f, H * 0.30f + 250.f * S, 1.0f, C_GREY, true);
}

void AFbHUD::DrawFinal()
{
	DrawRect(C_DIM, 0.f, 0.f, W, H);
	Txt(TEXT("FINAL"), W * 0.5f, H * 0.2f, 6.f, C_GOLD, true);
	Txt(Match->FinalText, W * 0.5f, H * 0.2f + 120.f * S, 3.2f, C_WHITE, true);
	const float BW = 460.f * S, BH = 78.f * S, X = W * 0.5f - BW * 0.5f;
	float Y = H * 0.5f;
	if (Btn(Match->bSeasonGame ? TEXT("BACK TO SEASON") : TEXT("MAIN MENU"), X, Y, BW, BH, FLinearColor(0.1f, 0.35f, 0.15f, 0.95f), 2.2f))
	{
		if (Match->bSeasonGame) Match->GoSeason(); else Match->GoMenu();
	}
	Y += BH + 18.f * S;
	if (Btn(TEXT("ULTIMATE TEAM"), X, Y, BW, BH, FLinearColor(0.35f, 0.2f, 0.5f, 0.95f), 2.0f)) Match->GoUltTeam();
}
