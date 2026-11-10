// Ultimate Football (Unreal port) - the football rules and play simulation. Plain C++ (no Unreal objects), ported from the web game / fb_game.py.
// Units: YARDS. x = downfield (own goal line -50 ... opponent goal line +50), z = across the field.
#pragma once
#include "CoreMinimal.h"
#include "FbData.h"

#define FB_N 22
#define FB_YD 91.44f

enum class EFbKind : uint8 { QB, RB, TE, WR, OL, DL, LB, CB, SAF };
enum class EFbPhase : uint8 { Pre, Live, Dead };
enum class EFbResult : uint8 { None, Tackled, Sack, Incomplete, Touchdown, Interception, OutOfBounds };

namespace FbRole
{
	enum Type { QB = 0, RB, TE, W1, W2, W3, OL1, OL2, OL3, OL4, OL5, DL1, DL2, DL3, DL4, LB1, LB2, LB3, CB1, CB2, S1, S2 };
}
const TCHAR* FbRoleName(int32 Role);

struct FFbEnt
{
	int32 Role = 0;
	bool bOff = true;
	EFbKind Kind = EFbKind::QB;
	float X = 0.f, Z = 0.f, VX = 0.f, VZ = 0.f, X0 = 0.f, Z0 = 0.f;
	float Mul = 1.f;                 // speed multiplier from the card / opponent rating
	TArray<FVector2D> Route;         // absolute yards: X = x, Y = z
	int32 Ri = 0;
	float BlockedUntil = 0.f;
	bool bRolled = false;
	float JukeT = 0.f;
	float JukeCool = 0.f;
};

struct FFbRatings
{
	float QbAcc = 0.85f;             // 0.5 .. 0.97
	float OffMul[6] = { 1.f, 1.f, 1.f, 1.f, 1.f, 1.f };   // QB, RB, TE, W1, W2, W3 speed multipliers
	float DefMul = 1.f;              // the defenders' speed multiplier (opponent strength)
	float OlMul = 1.f;               // how long the line holds its blocks
};

class FFbSim
{
public:
	FFbSim();

	TArray<FFbPlayDef> Playbook;
	FFbEnt E[FB_N];
	FFbRatings Rt;
	float Los = -20.f;
	EFbPhase Phase = EFbPhase::Dead;
	float T = 0.f;
	bool bRun = false;
	int32 PlayIdx = 0;
	int32 Carrier = -1;              // who has the ball in his hands after a catch / handoff / scramble (-1 = the QB holds it)
	bool bFlying = false;
	int32 Target = -1;
	float LandT = 0.f, LandX = 0.f, LandZ = 0.f;
	float Bx = 0.f, Bz = 0.f, By = 1.3f, Bvx = 0.f, Bvz = 0.f, Bvy = 0.f;
	EFbResult Result = EFbResult::None;
	FString ResultText;
	FString Status;
	float Yards = 0.f;
	int32 Tackler = -1;
	bool bEnded = false;
	float DeadT = 0.f;
	bool bHandoffDone = false;

	// player input, set by the caller every frame
	FVector2D Move;                  // X = downfield, Y = across
	bool bSprint = false;

	void Setup(int32 InPlayIdx, float InLos, const FFbRatings& InRt);
	void Tick(float Dt);             // call with small steps (<= 1/30 s)
	bool Throw(int32 Slot);          // 0..4 = W1, W2, W3, TE, RB
	void Juke();
	int32 Controlled() const;        // entity the player is steering, -1 = none
	float TopSpeed(const FFbEnt& e) const;
	bool PlayIsRun(int32 Idx) const { return Playbook.IsValidIndex(Idx) && Playbook[Idx].bRun; }

private:
	bool Missed[FB_N];
	void Init(int32 Role, bool bOff, EFbKind Kind, float X, float Z);
	float Go(FFbEnt& e, float tx, float tz, float speed, float dt);
	void RouteStep(FFbEnt& e, float dt);
	void ControlStep(FFbEnt& e, float dt);
	void DefenseStep(float dt, int32 Pursue);
	void OlDlContact();
	void LivePass(float dt);
	void LiveRun(float dt);
	void BallStep(float dt);
	void ResolveCatch();
	void CheckTackle(int32 c);
	void End(EFbResult R, const FString& Text, float InYards);
	void RouteAt(const FFbEnt& e, float Secs, float& OutX, float& OutZ) const;
	void FinishFrame();
};

// ---------------------------------------------------------------------------------------------------- the game (score, downs, drives)
enum class EFbDrive : uint8 { Continue, Score, Turnover, Downs };

struct FFbGame
{
	int32 YouScore = 0, CpuScore = 0;
	int32 Drive = 1, Drives = 6, Overtimes = 0;
	int32 Down = 1;
	float ToGo = 10.f, Ball = 25.f, LineToGain = 35.f;   // Ball = yards from our own goal line
	int32 OppRating = 80;
	FString Opp;
	float CpuBonus = 0.f;
	bool bOver = false;

	void Reset(const FString& InOpp, int32 InRating);
	void NewDrive();
	float Los() const { return Ball - 50.f; }
	EFbDrive ApplyPlay(const FFbSim& S);
	bool KickFieldGoal(float KickerOvr);           // true = good (adds 3)
	int32 FieldGoalDistance() const { return (int32)(100.f - Ball) + 17; }
	FString CpuDrive(float UserDefAvg);            // simulates their possession, returns a headline
	void AfterCpuDrive();                           // moves to the next drive / ends the game
	FString DownText() const;
};

// ---------------------------------------------------------------------------------------------------- your team + season (kept while the editor stays open)
struct FFbMeta
{
	TArray<FFbCardDef> Cards;
	int32 Slot[11];
	int32 NextWr = 0;
	int32 Week = 1, Wins = 0, Losses = 0, Ties = 0;
	bool bInit = false;

	static FFbMeta& Get();
	void Init();
	void Equip(int32 CardIdx);
	const FFbCardDef* SlotCard(int32 S) const { return (Slot[S] >= 0 && Slot[S] < Cards.Num()) ? &Cards[Slot[S]] : nullptr; }
	FFbRatings Ratings() const;
	float DefAvg() const;
	float KickerOvr() const;
	static const TCHAR* SlotName(int32 S);
	static int32 SeasonLength() { return 8; }
	static const TCHAR* OppName(int32 WeekIdx);
	static int32 OppRatingOf(int32 WeekIdx);
};
