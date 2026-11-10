#include "FbSim.h"

static float FbRnd() { return FMath::FRand(); }
static float FbRndR(float A, float B) { return A + (B - A) * FMath::FRand(); }
static float FbDist(const FFbEnt& A, const FFbEnt& B) { return FMath::Sqrt((A.X - B.X) * (A.X - B.X) + (A.Z - B.Z) * (A.Z - B.Z)); }
static float FbDist2(float AX, float AZ, float BX, float BZ) { return FMath::Sqrt((AX - BX) * (AX - BX) + (AZ - BZ) * (AZ - BZ)); }

static const float FB_GRAV = 18.f;      // the web game's gravity, yards / s^2

const TCHAR* FbRoleName(int32 Role)
{
	static const TCHAR* N[FB_N] = { TEXT("QB"), TEXT("RB"), TEXT("TE"), TEXT("W1"), TEXT("W2"), TEXT("W3"),
		TEXT("OL1"), TEXT("OL2"), TEXT("OL3"), TEXT("OL4"), TEXT("OL5"), TEXT("DL1"), TEXT("DL2"), TEXT("DL3"), TEXT("DL4"),
		TEXT("LB1"), TEXT("LB2"), TEXT("LB3"), TEXT("CB1"), TEXT("CB2"), TEXT("S1"), TEXT("S2") };
	return (Role >= 0 && Role < FB_N) ? N[Role] : TEXT("?");
}

FFbSim::FFbSim()
{
	FbBuildPlaybook(Playbook);
	for (int32 i = 0; i < FB_N; i++) Missed[i] = false;
}

void FFbSim::Init(int32 Role, bool bOff, EFbKind Kind, float X, float Z)
{
	FFbEnt& e = E[Role];
	e = FFbEnt();
	e.Role = Role; e.bOff = bOff; e.Kind = Kind;
	e.X = X; e.Z = Z; e.X0 = X; e.Z0 = Z;
	e.Mul = bOff ? (Role < 6 ? Rt.OffMul[Role] : 1.f) : Rt.DefMul;
}

float FFbSim::TopSpeed(const FFbEnt& e) const
{
	float Sp = 8.f;
	switch (e.Kind)
	{
	case EFbKind::QB: Sp = 5.2f; break;
	case EFbKind::RB: Sp = 9.8f; break;
	case EFbKind::TE: Sp = 9.45f; break;
	case EFbKind::WR: Sp = 10.1f; break;
	case EFbKind::OL: Sp = 6.2f; break;
	case EFbKind::DL: Sp = 9.1f; break;
	case EFbKind::LB: Sp = 8.7f; break;
	case EFbKind::CB: Sp = 9.7f; break;
	case EFbKind::SAF: Sp = 9.3f; break;
	}
	float Rm = 1.f;
	switch (e.Role)
	{
	case FbRole::QB: Rm = 1.12f; break;
	case FbRole::RB: Rm = 1.06f; break;
	case FbRole::W2: Rm = 0.93f; break;
	case FbRole::W3: Rm = 1.05f; break;
	case FbRole::TE: Rm = 0.97f; break;
	default: break;
	}
	return Sp * Rm * 0.75f * e.Mul;      // the web game moves everybody at 0.75 of the listed speed
}

void FFbSim::Setup(int32 InPlayIdx, float InLos, const FFbRatings& InRt, bool bInUserOff, EFbCall InCall)
{
	Rt = InRt;
	Los = InLos;
	bUserOff = bInUserOff;
	DefCall = InCall;
	if (!Playbook.IsValidIndex(InPlayIdx)) InPlayIdx = 0;
	PlayIdx = InPlayIdx;
	const FFbPlayDef& P = Playbook[PlayIdx];
	bRun = P.bRun;

	// offence (shotgun for passes, under centre for runs)
	const float QbDx = bRun ? -1.5f : -5.f;
	const float RbDx = bRun ? -5.8f : -5.f;
	const float RbZ = bRun ? 0.f : 2.4f;
	Init(FbRole::QB, true, EFbKind::QB, Los + QbDx, 0.f);
	Init(FbRole::RB, true, EFbKind::RB, Los + RbDx, RbZ);
	Init(FbRole::TE, true, EFbKind::TE, Los - 0.9f, 6.4f);
	Init(FbRole::W1, true, EFbKind::WR, Los - 0.6f, -15.5f);
	Init(FbRole::W2, true, EFbKind::WR, Los - 0.6f, 15.f);
	Init(FbRole::W3, true, EFbKind::WR, Los - 1.2f, -8.5f);
	if (bRun) { E[FbRole::TE].Z = 6.2f; E[FbRole::TE].Z0 = 6.2f; }
	for (int32 i = 0; i < 5; i++) Init(FbRole::OL1 + i, true, EFbKind::OL, Los - 0.9f, -4.4f + 2.2f * i);

	// defence
	const float DlZ[4] = { -4.5f, -1.5f, 1.5f, 4.5f };
	for (int32 i = 0; i < 4; i++) Init(FbRole::DL1 + i, false, EFbKind::DL, Los + 1.f, DlZ[i]);
	const float LbZ[3] = { -5.f, 0.f, 5.f };
	for (int32 i = 0; i < 3; i++) Init(FbRole::LB1 + i, false, EFbKind::LB, Los + 4.5f, LbZ[i]);
	Init(FbRole::CB1, false, EFbKind::CB, Los + 6.f, -15.5f);
	Init(FbRole::CB2, false, EFbKind::CB, Los + 6.f, 15.f);
	Init(FbRole::S1, false, EFbKind::SAF, FMath::Min(Los + 14.f, 49.f), -6.f);
	Init(FbRole::S2, false, EFbKind::SAF, FMath::Min(Los + 14.f, 49.f), 6.f);

	// routes (absolute yards)
	if (!bRun)
	{
		static const int32 RouteRoles[5] = { FbRole::W1, FbRole::W2, FbRole::W3, FbRole::TE, FbRole::RB };
		for (int32 k = 0; k < 5; k++)
		{
			FFbEnt& e = E[RouteRoles[k]];
			const TArray<FVector2D>* R = P.Routes.Find(FString(FbRoleName(RouteRoles[k])));
			if (!R) continue;
			for (int32 j = 0; j < R->Num(); j++) e.Route.Add(FVector2D(Los + (*R)[j].X, e.Z0 + (*R)[j].Y));
		}
	}
	else
	{
		FFbEnt& rb = E[FbRole::RB];
		for (int32 j = 0; j < P.RunPts.Num(); j++) rb.Route.Add(FVector2D(Los + P.RunPts[j].X, P.RunPts[j].Y));
	}

	for (int32 i = 0; i < FB_N; i++) Missed[i] = false;
	Carrier = -1; bFlying = false; Target = -1; LandT = 0.f; LandX = LandZ = 0.f;
	Bx = E[FbRole::QB].X; Bz = E[FbRole::QB].Z; By = 1.3f; Bvx = Bvz = Bvy = 0.f;
	T = 0.f; DeadT = 0.f; Phase = EFbPhase::Pre;
	Result = EFbResult::None; ResultText = FString(); Status = FString(); Yards = 0.f; Tackler = -1; bEnded = false; bHandoffDone = false;
	Move = FVector2D(0.f, 0.f); bSprint = false;
	CtlLock = 0.f; DiveT = 0.f; DiveCool = 0.f; LastLandX = Los;
	AiThrowAt = 1.7f + 0.9f * FbRnd();
	Ctl = -1;
	if (!bUserOff) AutoPick(E[FbRole::QB].X, E[FbRole::QB].Z, true);
	FinishFrame();
}

float FFbSim::Go(FFbEnt& e, float tx, float tz, float speed, float dt)
{
	const float dx = tx - e.X, dz = tz - e.Z;
	const float d = FMath::Sqrt(dx * dx + dz * dz);
	if (d < 1e-4f) { e.VX = 0.f; e.VZ = 0.f; return d; }
	const float s = FMath::Min(speed, d / FMath::Max(dt, 1e-4f));
	e.VX = dx / d * s; e.VZ = dz / d * s;
	e.X += e.VX * dt; e.Z += e.VZ * dt;
	return d;
}

void FFbSim::RouteStep(FFbEnt& e, float dt)
{
	if (e.Ri >= e.Route.Num()) { e.VX = 0.f; e.VZ = 0.f; return; }
	const float tx = (float)e.Route[e.Ri].X, tz = (float)e.Route[e.Ri].Y;
	if (Go(e, tx, tz, TopSpeed(e), dt) < 0.25f) e.Ri++;
}

int32 FFbSim::Controlled() const
{
	if (Phase != EFbPhase::Live) return -1;
	if (!bUserOff) return Ctl;
	if (Carrier >= 0) return Carrier;
	if (!bRun && !bFlying) return FbRole::QB;
	return -1;
}

void FFbSim::ControlStep(FFbEnt& e, float dt)
{
	float Sp = TopSpeed(e) * (bSprint ? 1.0f : 0.85f);
	if (e.JukeT > 0.f) Sp *= 1.12f;
	if (!e.bOff)
	{
		if (e.Kind == EFbKind::DL && T < e.BlockedUntil) Sp *= 0.35f;      // a lineman who is being blocked is slowed
		if (DiveT > 0.f) Sp = TopSpeed(e) * 1.4f;
		else if (DiveCool > 0.f) Sp *= 0.5f;
	}
	const float mx = (float)Move.X, mz = (float)Move.Y;
	const float m = FMath::Sqrt(mx * mx + mz * mz);
	float tx = 0.f, tz = 0.f;
	if (m > 0.01f) { tx = mx / m * Sp; tz = mz / m * Sp; }
	if (!e.bOff && DiveT > 0.f && m <= 0.01f) { tx = e.VX; tz = e.VZ; }       // a dive keeps going the way it started
	const float k = FMath::Min(1.f, 9.f * dt);
	e.VX += (tx - e.VX) * k; e.VZ += (tz - e.VZ) * k;
	e.X += e.VX * dt; e.Z += e.VZ * dt;
	if (e.Z > 27.f) e.Z = 27.f;
	if (e.Z < -27.f) e.Z = -27.f;
}

void FFbSim::Juke()
{
	if (Phase != EFbPhase::Live || !bUserOff || Carrier < 0) return;
	FFbEnt& c = E[Carrier];
	if (c.JukeCool > 0.f) return;
	c.JukeT = 0.45f; c.JukeCool = 1.3f;
	const float side = (FMath::Abs((float)Move.Y) > 0.1f) ? ((Move.Y > 0) ? 1.f : -1.f) : ((c.VZ >= 0.f) ? 1.f : -1.f);
	c.VZ += side * 3.5f;
	Status = FString(TEXT("JUKE!"));
}

void FFbSim::Dive()
{
	if (Phase != EFbPhase::Live || bUserOff || Ctl < 0) return;
	if (DiveT > 0.f || DiveCool > 0.f) return;
	DiveT = 0.45f;
	Status = FString(TEXT("DIVE!"));
}

void FFbSim::AutoPick(float Fx, float Fz, bool bAllowDL)
{
	int32 Best = -1; float BestD = 1e9f;
	for (int32 i = FbRole::DL1; i <= FbRole::S2; i++)
	{
		if (!bAllowDL && E[i].Kind == EFbKind::DL) continue;
		const float d = FbDist2(E[i].X, E[i].Z, Fx, Fz);
		if (d < BestD) { BestD = d; Best = i; }
	}
	if (Best >= 0) { Ctl = Best; CtlLock = 0.f; }
}

void FFbSim::SwitchDefender()
{
	if (bUserOff || Phase != EFbPhase::Live) return;
	float Fx = E[FbRole::QB].X, Fz = E[FbRole::QB].Z;
	if (bFlying) { Fx = LandX; Fz = LandZ; }
	else if (Carrier >= 0) { Fx = E[Carrier].X; Fz = E[Carrier].Z; }
	int32 Order[11]; float Dst[11];
	for (int32 k = 0; k < 11; k++) { Order[k] = FbRole::DL1 + k; Dst[k] = FbDist2(E[Order[k]].X, E[Order[k]].Z, Fx, Fz); }
	for (int32 a = 0; a < 11; a++)
		for (int32 b = a + 1; b < 11; b++)
			if (Dst[b] < Dst[a]) { const float td = Dst[a]; Dst[a] = Dst[b]; Dst[b] = td; const int32 ti = Order[a]; Order[a] = Order[b]; Order[b] = ti; }
	int32 Rank = 0;
	for (int32 k = 0; k < 11; k++) if (Order[k] == Ctl) Rank = k;
	Ctl = Order[(Rank + 1) % 5];
	E[Ctl].VX = 0.f; E[Ctl].VZ = 0.f;
	CtlLock = 1.5f;
}

bool FFbSim::IsRusher(int32 i) const
{
	if (E[i].Kind == EFbKind::DL) return true;
	return DefCall == EFbCall::Blitz && (i == FbRole::LB1 || i == FbRole::LB2);
}

float FFbSim::TackleR(int32 i) const
{
	if (!bUserOff && i == Ctl && DiveT > 0.f) return 1.9f;
	return 1.0f;
}

void FFbSim::OlDlContact()
{
	for (int32 i = FbRole::DL1; i <= FbRole::LB3; i++)
	{
		if (!IsRusher(i)) continue;
		FFbEnt& d = E[i];
		if (d.bRolled || T < d.BlockedUntil || T >= 6.f) continue;
		for (int32 j = FbRole::OL1; j <= FbRole::OL5; j++)
		{
			if (FbDist(E[j], d) < 1.3f && T > 0.2f)
			{
				d.bRolled = true;
				float Dur;
				if (bRun) Dur = FbRndR(2.0f, 3.4f);
				else Dur = (FbRnd() < 0.965f) ? FbRndR(1.8f, 3.0f) : 0.2f;
				d.BlockedUntil = T + Dur * Rt.OlMul;
				break;
			}
		}
	}
}

void FFbSim::DefenseStep(float dt, int32 Pursue)
{
	static const int32 ManOf[22] = { 0,0,0,0,0,0,0,0,0,0,0, 0,0,0,0, FbRole::TE, FbRole::RB, 0, FbRole::W1, FbRole::W2, FbRole::W3, 0 };
	static const float ZoneDx[22] = { 0,0,0,0,0,0,0,0,0,0,0, 0,0,0,0, 5.f, 5.f, 5.f, 7.f, 7.f, 14.f, 14.f };
	static const float ZoneZ[22] = { 0,0,0,0,0,0,0,0,0,0,0, 0,0,0,0, -6.f, 0.f, 6.f, -15.f, 15.f, -7.f, 7.f };
	const int32 Skip = bUserOff ? -1 : Ctl;           // the defender the player steers is not moved by the AI
	for (int32 i = FbRole::DL1; i <= FbRole::S2; i++)
	{
		if (i == Skip && Phase == EFbPhase::Live) continue;
		FFbEnt& e = E[i];
		const float Sp = TopSpeed(e);
		if (Pursue < 0 && bRun) { e.VX = 0.f; e.VZ = 0.f; continue; }       // on a run the front holds until the play develops
		if (Pursue >= 0)
		{
			const FFbEnt& c = E[Pursue];
			const float Slow = (e.Kind == EFbKind::DL && T < e.BlockedUntil) ? 0.25f : 1.f;
			Go(e, c.X + c.VX * 0.25f, c.Z + c.VZ * 0.25f, Sp * (bRun ? 0.96f : 0.98f) * Slow, dt);
			continue;
		}
		const FFbEnt& q = E[FbRole::QB];
		if (IsRusher(i))
		{
			const float Sp2 = Sp * ((T < e.BlockedUntil) ? 0.25f : 1.f);
			Go(e, q.X, q.Z, Sp2 * 0.95f, dt);
		}
		else if (DefCall == EFbCall::Zone && i >= FbRole::LB1)
		{
			const float Ax = Los + ZoneDx[i], Az = ZoneZ[i];
			int32 Rb = -1; float RbD = 8.f;
			for (int32 k = FbRole::RB; k <= FbRole::W3; k++)
			{
				if (E[k].X < Los - 1.f) continue;
				const float d = FbDist2(E[k].X, E[k].Z, Ax, Az);
				if (d < RbD) { RbD = d; Rb = k; }
			}
			if (Rb >= 0 && T > 0.3f) Go(e, E[Rb].X + 0.9f, E[Rb].Z, Sp * 0.92f, dt);
			else if (T > 0.3f) Go(e, Ax, Az, Sp * 0.8f, dt);
		}
		else if (ManOf[i] != 0 && T > 0.3f)
		{
			const FFbEnt& r = E[ManOf[i]];
			Go(e, r.X + 0.9f, r.Z, Sp * 0.97f, dt);
		}
		else if (i == FbRole::S2)
		{
			float Far = Los + 12.f;
			for (int32 k = 0; k < 6; k++) if (E[k].Kind == EFbKind::WR || E[k].Kind == EFbKind::TE) Far = FMath::Max(Far, E[k].X);
			Go(e, FMath::Min(Far + 6.f, 52.f), 0.f, Sp * 0.9f, dt);
		}
		else if (i == FbRole::LB3)
		{
			Go(e, Los + 6.5f, q.Z, Sp * 0.8f, dt);
		}
	}
	// when the ball is in the air the closest defender (not a lineman) breaks on the spot where it comes down
	if (bFlying && T > LandT - 0.7f)
	{
		int32 Best = -1; float BestD = 1e9f;
		for (int32 i = FbRole::LB1; i <= FbRole::S2; i++)
		{
			if (i == Skip) continue;
			const float d = FbDist2(E[i].X, E[i].Z, LandX, LandZ);
			if (d < BestD) { BestD = d; Best = i; }
		}
		if (Best >= 0) Go(E[Best], LandX, LandZ, TopSpeed(E[Best]) * 0.95f, dt);
	}
}

void FFbSim::AiCarrierStep(FFbEnt& c, float dt)
{
	if (c.JukeT > 0.f) c.JukeT -= dt;
	if (c.JukeCool > 0.f) c.JukeCool -= dt;
	if (c.JukeCool <= 0.f)
	{
		for (int32 i = FbRole::DL1; i <= FbRole::S2; i++)
			if (FbDist(E[i], c) < 2.2f && FbRnd() < 1.2f * dt) { c.JukeT = 0.45f; c.JukeCool = 1.4f; break; }
	}
	const float Sp = TopSpeed(c) * 0.80f * ((c.JukeT > 0.f) ? 1.08f : 1.f);
	if (bRun && c.Role == FbRole::RB && c.Ri < c.Route.Num())
	{
		if (Go(c, (float)c.Route[c.Ri].X, (float)c.Route[c.Ri].Y, Sp, dt) < 0.3f) c.Ri++;
		return;
	}
	float Tz = c.Z * 0.9f;
	for (int32 i = FbRole::DL1; i <= FbRole::S2; i++)               // run to daylight: step away from the closest defender ahead
	{
		const FFbEnt& d = E[i];
		if (d.X > c.X - 1.f && FbDist(d, c) < 6.f) { Tz += (c.Z >= d.Z) ? 4.f : -4.f; break; }
	}
	Tz = FMath::Clamp(Tz, -24.f, 24.f);
	Go(c, c.X + 10.f, Tz, Sp, dt);
}

void FFbSim::AiThrow()
{
	static const int32 Roles[5] = { FbRole::W1, FbRole::W2, FbRole::W3, FbRole::TE, FbRole::RB };
	int32 Best = -1; float BestS = -1e9f;
	for (int32 k = 0; k < 5; k++)
	{
		const FFbEnt& r = E[Roles[k]];
		if (r.Route.Num() == 0) continue;
		float Ax, Az;
		RouteAt(r, 1.2f, Ax, Az);
		float Md = 1e9f;
		for (int32 i = FbRole::DL1; i <= FbRole::S2; i++) Md = FMath::Min(Md, FbDist2(E[i].X, E[i].Z, Ax, Az));
		float Score = Md + FbRndR(0.f, 1.2f);
		if (Roles[k] == FbRole::RB) Score -= 1.5f;                // the checkdown is the last choice
		if (Score > BestS) { BestS = Score; Best = Roles[k]; }
	}
	if (Best >= 0) ThrowRole(Best);
}

void FFbSim::LivePass(float dt)
{
	if (Carrier < 0 && !bFlying) OlDlContact();
	for (int32 i = FbRole::RB; i <= FbRole::W3; i++)
		if (T > 0.15f && i != Carrier) RouteStep(E[i], dt);

	if (!bUserOff && Ctl >= 0)
	{
		if (CtlLock > 0.f) CtlLock -= dt;
		if (DiveT > 0.f) { DiveT -= dt; if (DiveT <= 0.f) DiveCool = 0.9f; }
		else if (DiveCool > 0.f) DiveCool -= dt;
		ControlStep(E[Ctl], dt);
	}

	FFbEnt& q = E[FbRole::QB];
	if (Carrier < 0)
	{
		if (!bFlying)
		{
			if (bUserOff) ControlStep(q, dt);
			else
			{
				Go(q, q.X0 - 2.0f, q.Z0, TopSpeed(q), dt);
				float Near = 1e9f;
				for (int32 i = FbRole::DL1; i <= FbRole::LB3; i++) if (IsRusher(i)) Near = FMath::Min(Near, FbDist(E[i], q));
				if (T >= AiThrowAt || (T > 0.9f && Near < 2.2f)) AiThrow();
			}
			if (bUserOff && q.X > Los + 0.5f)                // the QB has run past the line with the ball: now he is a ball carrier
			{
				Carrier = FbRole::QB; Status = FString(TEXT("SCRAMBLE!"));
				DefenseStep(dt, Carrier);
				CheckTackle(Carrier);
				return;
			}
			if (!bFlying)
			{
				DefenseStep(dt, -1);
				for (int32 i = FbRole::DL1; i <= FbRole::S2; i++)
				{
					if (FbDist(E[i], q) < TackleR(i) + 0.05f)
					{
						Tackler = i;
						if (q.X <= Los) End(EFbResult::Sack, FString::Printf(TEXT("SACK  for %d yd loss"), FMath::RoundToInt(FMath::Max(0.f, Los - q.X))), FMath::Min(0.f, q.X - Los));
						else End(EFbResult::Tackled, FString(TEXT("TACKLED")), q.X - Los);
						return;
					}
				}
			}
		}
		else
		{
			q.VX = 0.f; q.VZ = 0.f;
			DefenseStep(dt, -1);
			BallStep(dt);
		}
	}
	else
	{
		FFbEnt& c = E[Carrier];
		if (bUserOff)
		{
			ControlStep(c, dt);
			if (c.JukeT > 0.f) c.JukeT -= dt;
			if (c.JukeCool > 0.f) c.JukeCool -= dt;
		}
		else AiCarrierStep(c, dt);
		DefenseStep(dt, Carrier);
		CheckTackle(Carrier);
	}
}

bool FFbSim::Throw(int32 Slot)
{
	if (!bUserOff) return false;
	static const int32 SlotRole[5] = { FbRole::W1, FbRole::W2, FbRole::W3, FbRole::TE, FbRole::RB };
	if (Slot < 0 || Slot > 4) return false;
	return ThrowRole(SlotRole[Slot]);
}

bool FFbSim::ThrowRole(int32 Rec)
{
	if (Phase != EFbPhase::Live || bRun || Carrier >= 0 || bFlying || bEnded) return false;
	FFbEnt& q = E[FbRole::QB];
	float d = FbDist(E[Rec], q);
	float Tf = 0.55f + 0.036f * d, Ax = E[Rec].X, Az = E[Rec].Z;
	for (int32 k = 0; k < 4; k++)
	{
		RouteAt(E[Rec], Tf, Ax, Az);
		d = FbDist2(Ax, Az, q.X, q.Z);
		Tf = 0.55f + 0.036f * d;
	}
	// accuracy: a better quarterback is closer to the spot; pressure and distance move it away
	float Pressure = 0.f;
	for (int32 i = FbRole::DL1; i <= FbRole::LB3; i++) if (IsRusher(i) && FbDist(E[i], q) < 3.5f) Pressure += 0.5f;
	const float Err = (1.f - Rt.QbAcc) * 2.2f + 0.02f * d + Pressure * 0.5f;
	const float Ang = FbRndR(0.f, 6.2831853f), Mag = Err * FbRnd();
	Ax += FMath::Cos(Ang) * Mag; Az += FMath::Sin(Ang) * Mag;
	d = FbDist2(Ax, Az, q.X, q.Z);
	Tf = 0.55f + 0.036f * d;
	Bx = q.X; Bz = q.Z; By = 2.1f;
	Bvx = (Ax - Bx) / Tf; Bvz = (Az - Bz) / Tf;
	Bvy = (0.45f - By + 0.5f * FB_GRAV * Tf * Tf) / Tf;
	bFlying = true; Target = Rec; LandT = T + Tf; LandX = Ax; LandZ = Az;
	Status = FString::Printf(TEXT("THROW to %s  (%d yd)"), FbRoleName(Rec), FMath::RoundToInt(d));
	if (!bUserOff) AutoPick(LandX, LandZ, false);          // the player now steers whoever is closest to where the ball comes down
	return true;
}

void FFbSim::RouteAt(const FFbEnt& e, float Secs, float& OutX, float& OutZ) const
{
	float x = e.X, z = e.Z, Left = TopSpeed(e) * Secs;
	int32 i = e.Ri;
	while (i < e.Route.Num() && Left > 0.f)
	{
		const float tx = (float)e.Route[i].X, tz = (float)e.Route[i].Y;
		const float d = FbDist2(tx, tz, x, z);
		if (d <= Left) { x = tx; z = tz; Left -= d; i++; }
		else { x += (tx - x) / d * Left; z += (tz - z) / d * Left; Left = 0.f; }
	}
	OutX = x; OutZ = z;
}

void FFbSim::BallStep(float dt)
{
	Bx += Bvx * dt; Bz += Bvz * dt; By += Bvy * dt; Bvy -= FB_GRAV * dt;
	if (T >= LandT) ResolveCatch();
}

void FFbSim::ResolveCatch()
{
	bFlying = false;
	By = 0.3f; Bx = LandX; Bz = LandZ; LastLandX = LandX;
	int32 R = -1; float Dr = 1e9f;
	for (int32 i = FbRole::RB; i <= FbRole::W3; i++)
	{
		const float d = FbDist2(E[i].X, E[i].Z, Bx, Bz);
		if (d < Dr) { Dr = d; R = i; }
	}
	if (R < 0 || Dr > 1.8f) { End(EFbResult::Incomplete, FString::Printf(TEXT("INCOMPLETE  (ball came down %.1f yd from the nearest receiver)"), Dr), 0.f); return; }
	if (FMath::Abs(Bz) > 26.5f) { End(EFbResult::Incomplete, FString(TEXT("INCOMPLETE  (out of bounds)")), 0.f); return; }
	float Dd = 1e9f; int32 Dn = -1;
	for (int32 i = FbRole::DL1; i <= FbRole::S2; i++)
	{
		const float d = FbDist(E[i], E[R]);
		if (d < Dd) { Dd = d; Dn = i; }
	}
	// the defender the player steers gets a real chance to make the play
	if (!bUserOff && Ctl >= FbRole::LB1 && FbDist(E[Ctl], E[R]) < 1.7f)
	{
		const float Roll = FbRnd();
		const float Pick = (DiveT > 0.f) ? 0.30f : 0.42f;
		if (Roll < Pick) { Tackler = Ctl; End(EFbResult::Interception, FString(TEXT("YOU INTERCEPTED IT!")), 0.f); return; }
		if (Roll < Pick + 0.30f) { End(EFbResult::Incomplete, FString(TEXT("PASS BROKEN UP BY YOU!")), 0.f); return; }
	}
	else if (Dd < 1.4f)
	{
		const float Roll = FbRnd();
		if (Roll < 0.06f) { Tackler = Dn; End(EFbResult::Interception, FString::Printf(TEXT("INTERCEPTED by %s!"), FbRoleName(Dn)), 0.f); return; }
		if (Roll < 0.34f) { End(EFbResult::Incomplete, FString(TEXT("INCOMPLETE  (broken up)")), 0.f); return; }
	}
	Carrier = R;
	Status = FString::Printf(TEXT("CATCH by %s"), FbRoleName(R));
	if (!bUserOff) AutoPick(E[R].X, E[R].Z, true);
}

void FFbSim::LiveRun(float dt)
{
	FFbEnt& rb = E[FbRole::RB];
	if (Carrier < 0 && T >= 0.55f)
	{
		Carrier = FbRole::RB; bHandoffDone = true; Status = FString(TEXT("HANDOFF"));
		if (!bUserOff) AutoPick(rb.X, rb.Z, true);
	}
	if (!bUserOff && Ctl >= 0)
	{
		if (CtlLock > 0.f) CtlLock -= dt;
		if (DiveT > 0.f) { DiveT -= dt; if (DiveT <= 0.f) DiveCool = 0.9f; }
		else if (DiveCool > 0.f) DiveCool -= dt;
		ControlStep(E[Ctl], dt);
	}
	if (Carrier < 0)
	{
		if (rb.Route.Num() > 0) Go(rb, (float)rb.Route[0].X, (float)rb.Route[0].Y, TopSpeed(rb) * 0.6f, dt);
	}
	else
	{
		FFbEnt& c = E[Carrier];
		if (bUserOff)
		{
			ControlStep(c, dt);
			if (c.JukeT > 0.f) c.JukeT -= dt;
			if (c.JukeCool > 0.f) c.JukeCool -= dt;
		}
		else AiCarrierStep(c, dt);
	}
	E[FbRole::QB].VX = 0.f; E[FbRole::QB].VZ = 0.f;
	for (int32 i = FbRole::OL1; i <= FbRole::OL5; i++)                       // linemen drive their man
	{
		int32 Best = FbRole::DL1; float BestD = 1e9f;
		for (int32 j = FbRole::DL1; j <= FbRole::DL4; j++)
		{
			const float d = FbDist(E[i], E[j]);
			if (d < BestD) { BestD = d; Best = j; }
		}
		Go(E[i], E[Best].X - 0.6f, E[Best].Z, 3.0f * Rt.OlMul, dt);
	}
	OlDlContact();
	DefenseStep(dt, (T > 1.05f && Carrier >= 0) ? Carrier : -1);
	if (Carrier >= 0) CheckTackle(Carrier);
}

void FFbSim::CheckTackle(int32 c)
{
	FFbEnt& e = E[c];
	if (e.X >= 50.f) { End(EFbResult::Touchdown, FString(TEXT("TOUCHDOWN!")), 50.f - Los); return; }
	if (FMath::Abs(e.Z) > 26.5f) { End(EFbResult::OutOfBounds, FString::Printf(TEXT("OUT OF BOUNDS after %d yards"), FMath::RoundToInt(e.X - Los)), e.X - Los); return; }
	for (int32 i = FbRole::DL1; i <= FbRole::S2; i++)
	{
		const float d = FbDist(E[i], e);
		if (d > 2.4f) Missed[i] = false;
		if (d < TackleR(i))
		{
			if (Missed[i]) continue;
			if (e.JukeT > 0.f && FbRnd() < 0.65f) { Missed[i] = true; Status = FString(TEXT("MISSED TACKLE!")); continue; }
			if (!bUserOff && i == Ctl && DiveT > 0.f && FbRnd() < 0.22f) { Missed[i] = true; Status = FString(TEXT("HE BROKE IT!")); continue; }
			Tackler = i;
			End(EFbResult::Tackled, FString::Printf(TEXT("TACKLED by %s after %d yards"), FbRoleName(i), FMath::RoundToInt(e.X - Los)), e.X - Los);
			return;
		}
	}
}

void FFbSim::End(EFbResult R, const FString& Text, float InYards)
{
	Phase = EFbPhase::Dead; bEnded = true; Result = R; ResultText = Text; Yards = InYards; DeadT = 0.f;
	for (int32 i = 0; i < FB_N; i++) { E[i].VX = 0.f; E[i].VZ = 0.f; }
	if (R == EFbResult::Incomplete || R == EFbResult::Interception) By = 0.3f;
}

void FFbSim::Tick(float Dt)
{
	Dt = FMath::Min(Dt, 0.05f);
	if (Phase == EFbPhase::Dead) { DeadT += Dt; FinishFrame(); return; }
	if (Phase == EFbPhase::Pre)
	{
		T += Dt;
		if (T > 0.9f) { Phase = EFbPhase::Live; T = 0.f; }
	}
	else
	{
		T += Dt;
		if (bRun) LiveRun(Dt); else LivePass(Dt);
	}
	FinishFrame();
}

void FFbSim::FinishFrame()
{
	if (!bFlying && !(bEnded && (Result == EFbResult::Incomplete || Result == EFbResult::Interception)))
	{
		const int32 H = (Carrier >= 0) ? Carrier : FbRole::QB;
		Bx = E[H].X + 0.25f; Bz = E[H].Z; By = 1.3f;
	}
}

// ====================================================================================================== game flow
void FFbGame::Reset(const FString& InOpp, int32 InRating)
{
	YouScore = CpuScore = 0; Q = 1; Clock = FB_QUARTER; UserBall = true; bYouReceivedFirst = true;
	ToYou = 3; HuddleRefund = 0.f; OtPoss = 0; OtRound = 0; Opp = InOpp; OppRating = InRating; bOver = false;
	NewSeries(25.f);
}

void FFbGame::NewSeries(float InBall)
{
	Ball = FMath::Clamp(InBall, 1.f, 99.f);
	Down = 1;
	ToGo = FMath::Min(10.f, 100.f - Ball);
	LineToGain = Ball + ToGo;
}

void FFbGame::SetPossession(bool bUser, float InBall)
{
	const bool bChanged = (bUser != UserBall);
	UserBall = bUser;
	NewSeries(InBall);
	HuddleRefund = 0.f;
	if (Q == 5 && bChanged)
	{
		OtPoss++;
		if (OtPoss >= 2)
		{
			if (YouScore != CpuScore) bOver = true;
			else { OtPoss = 0; OtRound++; if (OtRound >= 3) bOver = true; }
		}
	}
}

EFbDrive FFbGame::ApplyPlay(const FFbSim& S, FString& Out)
{
	const bool u = UserBall;
	const FString Who = u ? FString(TEXT("YOU")) : Opp;
	const bool bStops = (S.Result == EFbResult::Incomplete || S.Result == EFbResult::OutOfBounds || S.Result == EFbResult::Touchdown || S.Result == EFbResult::Interception);
	if (Q <= 4)
	{
		const float Huddle = bStops ? 0.f : 14.f;
		Clock = FMath::Max(0.f, Clock - S.T - Huddle);
		HuddleRefund = Huddle;
	}
	if (S.Result == EFbResult::Touchdown)
	{
		AddScore(u, 6);
		const bool bGood = FMath::FRand() < FB_XP_P;
		if (bGood) AddScore(u, 1);
		Out = FString::Printf(TEXT("%s TOUCHDOWN!   %s"), *Who, bGood ? TEXT("+7  (extra point is good)") : TEXT("+6  (extra point missed)"));
		Flip(25.f);
		return EFbDrive::Score;
	}
	if (S.Result == EFbResult::Interception)
	{
		Out = u ? FString(TEXT("INTERCEPTED!  They take over")) : FString(TEXT("YOU PICKED IT OFF!  Your ball"));
		const float Spot = FMath::Clamp(S.LastLandX + 50.f, 3.f, 97.f);
		Flip(100.f - Spot);
		return EFbDrive::Turnover;
	}
	Ball = Ball + S.Yards;
	if (Ball <= 0.f)
	{
		AddScore(!u, 2);
		Out = u ? FString(TEXT("SAFETY!  They get 2 points")) : FString(TEXT("SAFETY!  You get 2 points"));
		SetPossession(!u, 35.f);
		return EFbDrive::Turnover;
	}
	Ball = FMath::Clamp(Ball, 1.f, 99.f);
	if (Ball >= LineToGain)
	{
		Down = 1; ToGo = FMath::Min(10.f, 100.f - Ball); LineToGain = Ball + ToGo;
		Out = S.ResultText + FString(TEXT("   FIRST DOWN"));
		return EFbDrive::Continue;
	}
	Down++;
	ToGo = LineToGain - Ball;
	Out = S.ResultText;
	if (Down > 4)
	{
		Out = u ? FString(TEXT("TURNOVER ON DOWNS")) : FString::Printf(TEXT("YOU STOPPED THEM ON DOWNS!"));
		Flip(100.f - Ball);
		return EFbDrive::Downs;
	}
	return EFbDrive::Continue;
}

FString FFbGame::CheckQuarterEnd()
{
	if (Q >= 5 || bOver || Clock > 0.f) return FString();
	if (Q == 1) { Q = 2; Clock = FB_QUARTER; return FString(TEXT("END OF THE 1ST QUARTER")); }
	if (Q == 3) { Q = 4; Clock = FB_QUARTER; return FString(TEXT("END OF THE 3RD QUARTER")); }
	if (Q == 2)
	{
		Q = 3; Clock = FB_QUARTER; ToYou = 3;
		SetPossession(!bYouReceivedFirst, 25.f);
		return FString(TEXT("HALFTIME"));
	}
	if (YouScore != CpuScore) { bOver = true; return FString(TEXT("FINAL")); }
	Q = 5; Clock = 99999.f; OtPoss = 0; OtRound = 0;
	UserBall = true; NewSeries(25.f);
	return FString(TEXT("TIED - OVERTIME"));
}

FString FFbGame::Punt()
{
	const bool u = UserBall;
	if (Q <= 4) Clock = FMath::Max(0.f, Clock - 8.f);
	const float Net = 38.f + 8.f * FMath::FRand();
	const float Landing = Ball + Net;
	float NewBall;
	if (Landing >= 100.f) NewBall = 20.f; else NewBall = 100.f - Landing;
	NewBall = FMath::Clamp(NewBall, 5.f, 80.f);
	const FString Who = u ? FString(TEXT("YOU PUNT")) : FString::Printf(TEXT("%s PUNTS"), *Opp);
	Flip(NewBall);
	return FString::Printf(TEXT("%s   (%d yards)"), *Who, FMath::RoundToInt(Net));
}

FString FFbGame::FieldGoal(float KickerOvr)
{
	const bool u = UserBall;
	if (Q <= 4) Clock = FMath::Max(0.f, Clock - 8.f);
	const float Dist = (float)FieldGoalDistance();
	const float P = FMath::Clamp(1.05f - (Dist - 20.f) * 0.016f + (KickerOvr - 85.f) * 0.004f, 0.05f, 0.97f);
	const bool bGood = FMath::FRand() < P;
	const FString Who = u ? FString(TEXT("YOUR")) : FString::Printf(TEXT("%s'S"), *Opp);
	if (bGood)
	{
		AddScore(u, 3);
		Flip(25.f);
		return FString::Printf(TEXT("%s %d-YARD FIELD GOAL IS GOOD!  +3"), *Who, (int32)Dist);
	}
	const float Spot = FMath::Clamp(100.f - Ball, 20.f, 80.f);
	Flip(Spot);
	return FString::Printf(TEXT("%s %d-YARD FIELD GOAL IS NO GOOD"), *Who, (int32)Dist);
}

int32 FFbGame::CpuFourth() const
{
	const int32 Dist = FieldGoalDistance();
	if (Dist <= FB_FG_MAX && Ball >= 55.f) return 2;
	if (Ball > 50.f && ToGo <= 2.f) return 0;
	if (Ball < 40.f || ToGo > 5.f) return 1;
	if (Q == 4 && Clock < 240.f && CpuScore < YouScore) return 0;
	return 1;
}

bool FFbGame::CallTimeout()
{
	if (ToYou <= 0 || Q > 4) return false;
	ToYou--;
	Clock = FMath::Min(FB_QUARTER, Clock + HuddleRefund);
	HuddleRefund = 0.f;
	return true;
}

FString FFbGame::ClockText() const
{
	if (Q > 4) return FString(TEXT("OT"));
	const int32 T = FMath::Max(0, (int32)Clock);
	return FString::Printf(TEXT("%d:%02d"), T / 60, T % 60);
}

FString FFbGame::QText() const
{
	if (Q > 4) return FString(TEXT("OVERTIME"));
	const TCHAR* N[5] = { TEXT("1ST"), TEXT("1ST"), TEXT("2ND"), TEXT("3RD"), TEXT("4TH") };
	return FString(N[FMath::Clamp(Q, 1, 4)]);
}

FString FFbGame::DownText() const
{
	const TCHAR* Ord[5] = { TEXT("1st"), TEXT("1st"), TEXT("2nd"), TEXT("3rd"), TEXT("4th") };
	const int32 D = FMath::Clamp(Down, 1, 4);
	const int32 Spot = (Ball <= 50.f) ? (int32)Ball : (int32)(100.f - Ball);
	const TCHAR* Side = (Ball <= 50.f) ? TEXT("OWN") : TEXT("OPP");
	if (LineToGain >= 100.f) return FString::Printf(TEXT("%s & Goal   ball on %s %d"), Ord[D], Side, Spot);
	return FString::Printf(TEXT("%s & %d   ball on %s %d"), Ord[D], FMath::Max(1, FMath::RoundToInt(ToGo)), Side, Spot);
}

// ====================================================================================================== your team
static const TCHAR* FB_SLOT_NAMES[11] = { TEXT("QB"), TEXT("RB"), TEXT("WR 1"), TEXT("WR 2"), TEXT("WR 3"), TEXT("TE"), TEXT("EDGE"), TEXT("LB"), TEXT("CB"), TEXT("SAF"), TEXT("K") };
static const TCHAR* FB_SLOT_POS[11] = { TEXT("QB"), TEXT("RB"), TEXT("WR"), TEXT("WR"), TEXT("WR"), TEXT("TE"), TEXT("EDGE"), TEXT("LB"), TEXT("CB"), TEXT("SAF"), TEXT("K") };

const TCHAR* FFbMeta::SlotName(int32 S) { return (S >= 0 && S < 11) ? FB_SLOT_NAMES[S] : TEXT("?"); }

FFbMeta& FFbMeta::Get()
{
	static FFbMeta M;
	if (!M.bInit) M.Init();
	return M;
}

void FFbMeta::Init()
{
	bInit = true;
	FbBuildCards(Cards);
	for (int32 s = 0; s < 11; s++) Slot[s] = -1;
	for (int32 s = 0; s < 11; s++)
	{
		for (int32 c = 0; c < Cards.Num(); c++)
		{
			if (!(Cards[c].Pos == FString(FB_SLOT_POS[s]))) continue;
			bool bUsed = false;
			for (int32 o = 0; o < s; o++) if (Slot[o] == c) bUsed = true;
			if (bUsed) continue;
			Slot[s] = c; break;
		}
	}
}

void FFbMeta::Equip(int32 CardIdx)
{
	if (!Cards.IsValidIndex(CardIdx)) return;
	for (int32 s = 0; s < 11; s++) if (Slot[s] == CardIdx) return;           // already in the lineup
	if (Cards[CardIdx].Pos == FString(TEXT("WR")))
	{
		const int32 s = 2 + (NextWr % 3);
		NextWr++;
		Slot[s] = CardIdx;
		return;
	}
	for (int32 s = 0; s < 11; s++)
		if (Cards[CardIdx].Pos == FString(FB_SLOT_POS[s])) { Slot[s] = CardIdx; return; }
}

static float FbMulOf(int32 Ovr) { return FMath::Clamp(1.f + ((float)Ovr - 85.f) * 0.004f, 0.94f, 1.06f); }

FFbRatings FFbMeta::Ratings() const
{
	FFbRatings R;
	const FFbCardDef* Q = SlotCard(0);
	if (Q) R.QbAcc = FMath::Clamp(0.60f + ((float)Q->Ovr - 75.f) * 0.025f, 0.5f, 0.97f);
	if (Q) R.OffMul[FbRole::QB] = FbMulOf(Q->Ovr);
	const FFbCardDef* B = SlotCard(1); if (B) R.OffMul[FbRole::RB] = FbMulOf(B->Ovr);
	const FFbCardDef* T1 = SlotCard(5); if (T1) R.OffMul[FbRole::TE] = FbMulOf(T1->Ovr);
	for (int32 k = 0; k < 3; k++) { const FFbCardDef* W = SlotCard(2 + k); if (W) R.OffMul[FbRole::W1 + k] = FbMulOf(W->Ovr); }
	return R;
}

float FFbMeta::DefAvg() const
{
	float Sum = 0.f; int32 N = 0;
	for (int32 s = 6; s <= 9; s++) { const FFbCardDef* C = SlotCard(s); if (C) { Sum += (float)C->Ovr; N++; } }
	return N ? Sum / (float)N : 80.f;
}

float FFbMeta::KickerOvr() const { const FFbCardDef* K = SlotCard(10); return K ? (float)K->Ovr : 80.f; }

static const TCHAR* FB_OPP[8] = { TEXT("MIA"), TEXT("NYJ"), TEXT("DEN"), TEXT("BUF"), TEXT("SF"), TEXT("KC"), TEXT("BAL"), TEXT("PHI") };
static const int32 FB_OPP_R[8] = { 74, 77, 80, 82, 85, 87, 89, 91 };
const TCHAR* FFbMeta::OppName(int32 W) { return FB_OPP[FMath::Clamp(W, 0, 7)]; }
int32 FFbMeta::OppRatingOf(int32 W) { return FB_OPP_R[FMath::Clamp(W, 0, 7)]; }
