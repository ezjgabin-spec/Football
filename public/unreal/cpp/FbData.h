// GENERATED from the web game's playbook and card database. Do not edit by hand.
#pragma once
#include "CoreMinimal.h"

struct FFbPlayDef
{
	FString Name;
	bool bRun = false;
	bool bSneak = false;
	TMap<FString, TArray<FVector2D>> Routes;
	TArray<FVector2D> RunPts;
};

struct FFbCardDef
{
	FString Name; FString Pos; FString Team; FString Tier; int32 Ovr = 0; int32 Jersey = 0;
};

inline void FbBuildPlaybook(TArray<FFbPlayDef>& Out)
{
	Out.Empty();
	{ FFbPlayDef P; P.Name = TEXT("SLANTS"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(2.0f, 0.0f), FVector2D(7.0f, 6.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(2.0f, 0.0f), FVector2D(7.0f, 5.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(2.0f, 0.0f), FVector2D(7.0f, -6.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(6.0f, 0.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(1.0f, 5.0f), FVector2D(2.0f, 9.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("FOUR VERTS"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(34.0f, 0.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(32.0f, 2.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(34.0f, 0.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(30.0f, -2.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(3.0f, 6.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("CURLS"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(11.0f, 0.0f), FVector2D(9.0f, 0.6f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(8.0f, 0.6f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(11.0f, 0.0f), FVector2D(9.0f, -0.6f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(7.0f, 0.0f), FVector2D(5.5f, 0.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(3.0f, 6.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("CROSSERS"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(4.0f, 6.0f), FVector2D(5.0f, 22.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(4.0f, -6.0f), FVector2D(5.0f, -22.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(13.0f, 0.0f), FVector2D(16.0f, 8.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(14.0f, -4.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(2.0f, 5.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("CORNERS"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(12.0f, 0.0f), FVector2D(22.0f, -8.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(12.0f, 0.0f), FVector2D(22.0f, 8.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(20.0f, 6.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(7.0f, 0.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(2.0f, 5.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("DEEP OUTS"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(10.0f, -9.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(10.0f, 9.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(6.0f, 0.0f), FVector2D(6.0f, -8.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(13.0f, 0.0f), FVector2D(19.0f, -3.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(2.0f, 6.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("MESH"); P.bRun = false;
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(3.0f, 0.0f), FVector2D(3.5f, 18.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(2.5f, 0.0f), FVector2D(3.0f, -18.0f) });
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(12.0f, 0.0f), FVector2D(12.0f, 9.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(12.0f, 0.0f), FVector2D(12.0f, -9.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(1.0f, 5.0f), FVector2D(2.0f, 10.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("SMASH"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(4.0f, 0.6f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(4.0f, -0.6f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(18.0f, -7.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(18.0f, 7.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(2.0f, -4.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("FLOOD"); P.bRun = false;
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(30.0f, 0.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(11.0f, 9.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(1.0f, 5.0f), FVector2D(2.0f, 13.0f) });
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(12.0f, 0.0f), FVector2D(24.0f, 10.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(3.0f, 0.0f), FVector2D(4.0f, 14.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("DAGGER"); P.bRun = false;
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(22.0f, 0.0f) });
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(14.0f, 0.0f), FVector2D(14.0f, 12.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(32.0f, 0.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(2.0f, 0.0f), FVector2D(3.0f, 8.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(2.0f, -5.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("SNAG"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(6.0f, 0.0f), FVector2D(5.0f, 4.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(17.0f, -6.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(1.0f, 0.0f), FVector2D(2.0f, 8.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(2.0f, 0.0f), FVector2D(7.0f, -6.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(0.0f, -5.0f), FVector2D(2.0f, -10.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("Y-CROSS"); P.bRun = false;
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(12.0f, 0.0f), FVector2D(16.0f, -20.0f) });
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(12.0f, 0.0f), FVector2D(24.0f, 8.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(14.0f, 0.0f), FVector2D(12.0f, 2.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(2.0f, 0.0f), FVector2D(3.0f, -6.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(2.0f, 4.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("SPACING"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(4.5f, 0.5f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(4.5f, 0.4f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(4.5f, -0.4f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(4.5f, -0.5f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(1.0f, 6.0f), FVector2D(2.0f, 12.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("SAIL"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(30.0f, 0.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(12.0f, 0.0f), FVector2D(13.0f, -8.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(1.0f, -6.0f), FVector2D(2.0f, -12.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(4.0f, 0.0f), FVector2D(5.0f, -16.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(12.0f, 0.0f), FVector2D(22.0f, -8.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("DOUBLE MOVE"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(8.0f, 0.0f), FVector2D(9.0f, -3.0f), FVector2D(26.0f, -4.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(8.0f, 0.0f), FVector2D(9.0f, 3.0f), FVector2D(26.0f, 4.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(2.0f, 0.0f), FVector2D(7.0f, 5.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(20.0f, 0.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(2.0f, 5.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("POST CORNER"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(14.0f, 5.0f), FVector2D(22.0f, -4.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(14.0f, -5.0f), FVector2D(22.0f, 4.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(10.0f, 12.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(2.0f, 0.0f), FVector2D(3.0f, 8.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(2.0f, -4.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("DRIVE"); P.bRun = false;
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(2.0f, 0.0f), FVector2D(3.0f, 20.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(10.0f, -14.0f) });
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(30.0f, 0.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(8.5f, -0.6f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(1.0f, 5.0f), FVector2D(2.0f, 11.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("TE SEAM"); P.bRun = false;
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(24.0f, 0.0f) });
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(10.0f, 12.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(10.0f, 0.0f), FVector2D(10.0f, -12.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(4.0f, 0.4f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(0.0f, -5.0f), FVector2D(2.0f, -10.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("QUICK OUTS"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(5.0f, -6.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(5.0f, 6.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(5.0f, -6.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(5.0f, 0.0f), FVector2D(5.0f, 6.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(2.0f, 4.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("HAIL MARY"); P.bRun = false;
	  P.Routes.Add(TEXT("W1"), TArray<FVector2D>{ FVector2D(30.0f, 0.0f), FVector2D(40.0f, 9.0f) });
	  P.Routes.Add(TEXT("W2"), TArray<FVector2D>{ FVector2D(30.0f, 0.0f), FVector2D(40.0f, -9.0f) });
	  P.Routes.Add(TEXT("W3"), TArray<FVector2D>{ FVector2D(30.0f, 0.0f), FVector2D(40.0f, 5.0f) });
	  P.Routes.Add(TEXT("TE"), TArray<FVector2D>{ FVector2D(28.0f, 0.0f), FVector2D(36.0f, -5.0f) });
	  P.Routes.Add(TEXT("RB"), TArray<FVector2D>{ FVector2D(3.0f, 6.0f) });
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("DIVE"); P.bRun = true;
	  P.RunPts = TArray<FVector2D>{ FVector2D(-3.0f, 0.3f), FVector2D(0.8f, 0.3f), FVector2D(7.0f, 0.3f) };
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("TACKLE LEFT"); P.bRun = true;
	  P.RunPts = TArray<FVector2D>{ FVector2D(-4.0f, -3.0f), FVector2D(0.5f, -4.0f), FVector2D(7.0f, -5.0f) };
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("TACKLE RIGHT"); P.bRun = true;
	  P.RunPts = TArray<FVector2D>{ FVector2D(-4.0f, 3.0f), FVector2D(0.5f, 4.0f), FVector2D(7.0f, 5.0f) };
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("SWEEP LEFT"); P.bRun = true;
	  P.RunPts = TArray<FVector2D>{ FVector2D(-4.0f, -6.0f), FVector2D(-1.5f, -12.0f), FVector2D(3.0f, -15.0f), FVector2D(12.0f, -17.0f) };
	  Out.Add(P); }
	{ FFbPlayDef P; P.Name = TEXT("SWEEP RIGHT"); P.bRun = true;
	  P.RunPts = TArray<FVector2D>{ FVector2D(-4.0f, 6.0f), FVector2D(-1.5f, 12.0f), FVector2D(3.0f, 15.0f), FVector2D(12.0f, 17.0f) };
	  Out.Add(P); }
}

inline void FbBuildCards(TArray<FFbCardDef>& Out)
{
	Out.Empty();
	{ FFbCardDef C; C.Name = TEXT("Tom Brady"); C.Pos = TEXT("QB"); C.Team = TEXT("NE"); C.Tier = TEXT("LEGEND"); C.Ovr = 90; C.Jersey = 12; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Aaron Rodgers"); C.Pos = TEXT("QB"); C.Team = TEXT("GB"); C.Tier = TEXT("LEGEND"); C.Ovr = 89; C.Jersey = 12; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Drew Brees"); C.Pos = TEXT("QB"); C.Team = TEXT("NO"); C.Tier = TEXT("LEGEND"); C.Ovr = 88; C.Jersey = 9; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Ben Roethlisberger"); C.Pos = TEXT("QB"); C.Team = TEXT("PIT"); C.Tier = TEXT("LEGEND"); C.Ovr = 87; C.Jersey = 7; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("LaDainian Tomlinson"); C.Pos = TEXT("RB"); C.Team = TEXT("LAC"); C.Tier = TEXT("LEGEND"); C.Ovr = 90; C.Jersey = 21; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Adrian Peterson"); C.Pos = TEXT("RB"); C.Team = TEXT("MIN"); C.Tier = TEXT("LEGEND"); C.Ovr = 90; C.Jersey = 28; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Marshawn Lynch"); C.Pos = TEXT("RB"); C.Team = TEXT("SEA"); C.Tier = TEXT("LEGEND"); C.Ovr = 88; C.Jersey = 24; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Chris Johnson"); C.Pos = TEXT("RB"); C.Team = TEXT("TEN"); C.Tier = TEXT("LEGEND"); C.Ovr = 87; C.Jersey = 28; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Calvin Johnson"); C.Pos = TEXT("WR"); C.Team = TEXT("DET"); C.Tier = TEXT("LEGEND"); C.Ovr = 91; C.Jersey = 81; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Larry Fitzgerald"); C.Pos = TEXT("WR"); C.Team = TEXT("ARI"); C.Tier = TEXT("LEGEND"); C.Ovr = 89; C.Jersey = 11; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Chad Ochocinco"); C.Pos = TEXT("WR"); C.Team = TEXT("CIN"); C.Tier = TEXT("LEGEND"); C.Ovr = 88; C.Jersey = 85; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Antonio Brown"); C.Pos = TEXT("WR"); C.Team = TEXT("PIT"); C.Tier = TEXT("LEGEND"); C.Ovr = 88; C.Jersey = 84; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Steve Smith Sr."); C.Pos = TEXT("WR"); C.Team = TEXT("CAR"); C.Tier = TEXT("LEGEND"); C.Ovr = 87; C.Jersey = 89; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Rob Gronkowski"); C.Pos = TEXT("TE"); C.Team = TEXT("NE"); C.Tier = TEXT("LEGEND"); C.Ovr = 91; C.Jersey = 87; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Antonio Gates"); C.Pos = TEXT("TE"); C.Team = TEXT("LAC"); C.Tier = TEXT("LEGEND"); C.Ovr = 88; C.Jersey = 85; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Jason Witten"); C.Pos = TEXT("TE"); C.Team = TEXT("DAL"); C.Tier = TEXT("LEGEND"); C.Ovr = 87; C.Jersey = 82; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Jimmy Graham"); C.Pos = TEXT("TE"); C.Team = TEXT("NO"); C.Tier = TEXT("LEGEND"); C.Ovr = 87; C.Jersey = 80; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("J.J. Watt"); C.Pos = TEXT("EDGE"); C.Team = TEXT("HOU"); C.Tier = TEXT("LEGEND"); C.Ovr = 91; C.Jersey = 99; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Von Miller"); C.Pos = TEXT("EDGE"); C.Team = TEXT("DEN"); C.Tier = TEXT("LEGEND"); C.Ovr = 89; C.Jersey = 58; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("DeMarcus Ware"); C.Pos = TEXT("EDGE"); C.Team = TEXT("DAL"); C.Tier = TEXT("LEGEND"); C.Ovr = 89; C.Jersey = 94; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Julius Peppers"); C.Pos = TEXT("EDGE"); C.Team = TEXT("CAR"); C.Tier = TEXT("LEGEND"); C.Ovr = 88; C.Jersey = 90; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Patrick Willis"); C.Pos = TEXT("LB"); C.Team = TEXT("SF"); C.Tier = TEXT("LEGEND"); C.Ovr = 90; C.Jersey = 52; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Luke Kuechly"); C.Pos = TEXT("LB"); C.Team = TEXT("CAR"); C.Tier = TEXT("LEGEND"); C.Ovr = 90; C.Jersey = 59; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Brian Urlacher"); C.Pos = TEXT("LB"); C.Team = TEXT("CHI"); C.Tier = TEXT("LEGEND"); C.Ovr = 89; C.Jersey = 54; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("NaVorro Bowman"); C.Pos = TEXT("LB"); C.Team = TEXT("SF"); C.Tier = TEXT("LEGEND"); C.Ovr = 87; C.Jersey = 53; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Darrelle Revis"); C.Pos = TEXT("CB"); C.Team = TEXT("NYJ"); C.Tier = TEXT("LEGEND"); C.Ovr = 91; C.Jersey = 24; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Richard Sherman"); C.Pos = TEXT("CB"); C.Team = TEXT("SEA"); C.Tier = TEXT("LEGEND"); C.Ovr = 89; C.Jersey = 25; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Nnamdi Asomugha"); C.Pos = TEXT("CB"); C.Team = TEXT("LV"); C.Tier = TEXT("LEGEND"); C.Ovr = 88; C.Jersey = 21; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Patrick Peterson"); C.Pos = TEXT("CB"); C.Team = TEXT("ARI"); C.Tier = TEXT("LEGEND"); C.Ovr = 88; C.Jersey = 21; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Ed Reed"); C.Pos = TEXT("SAF"); C.Team = TEXT("BAL"); C.Tier = TEXT("LEGEND"); C.Ovr = 91; C.Jersey = 20; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Troy Polamalu"); C.Pos = TEXT("SAF"); C.Team = TEXT("PIT"); C.Tier = TEXT("LEGEND"); C.Ovr = 90; C.Jersey = 43; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Sean Taylor"); C.Pos = TEXT("SAF"); C.Team = TEXT("WAS"); C.Tier = TEXT("LEGEND"); C.Ovr = 89; C.Jersey = 21; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Earl Thomas"); C.Pos = TEXT("SAF"); C.Team = TEXT("SEA"); C.Tier = TEXT("LEGEND"); C.Ovr = 88; C.Jersey = 29; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Justin Tucker"); C.Pos = TEXT("K"); C.Team = TEXT("BAL"); C.Tier = TEXT("LEGEND"); C.Ovr = 92; C.Jersey = 9; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Sebastian Janikowski"); C.Pos = TEXT("K"); C.Team = TEXT("LV"); C.Tier = TEXT("LEGEND"); C.Ovr = 90; C.Jersey = 11; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Stephen Gostkowski"); C.Pos = TEXT("K"); C.Team = TEXT("NE"); C.Tier = TEXT("LEGEND"); C.Ovr = 89; C.Jersey = 3; Out.Add(C); }
	{ FFbCardDef C; C.Name = TEXT("Brandon Aubrey"); C.Pos = TEXT("K"); C.Team = TEXT("DAL"); C.Tier = TEXT("S"); C.Ovr = 88; C.Jersey = 17; Out.Add(C); }
}
