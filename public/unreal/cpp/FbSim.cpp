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

void FFbSim::Setup(int32 InPlayIdx, float InLos, const FFbRatings& InRt)
{
	Rt = InRt;
	Los = InLos;
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
	if (bRun) E[FbRole::TE].Z = 6.2f, E[FbRole::TE].Z0 = 6.2f;
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
	if (Carrier >= 0) return Carrier;
	if (!bRun && !bFlying) return FbRole::QB;
	return -1;
}

void FFbSim::ControlStep(FFbEnt& e, float dt)
{
	float Sp = TopSpeed(e) * (bSprint ? 1.0f : 0.82f);
	if (e.JukeT > 0.f) Sp *= 1.12f;
	const float mx = (float)Move.X, mz = (float)Move.Y;
	const float m = FMath::Sqrt(mx * mx + mz * mz);
	float tx = 0.f, tz = 0.f;
	if (m > 0.01f) { tx = mx / m * Sp; tz = mz / m * Sp; }
	const float k = FMath::Min(1.f, 9.f * dt);
	e.VX += (tx - e.VX) * k; e.VZ += (tz - e.VZ) * k;
	e.X += e.VX * dt; e.Z += e.VZ * dt;
	if (e.Z > 27.f) e.Z = 27.f;
	if (e.Z < -27.f) e.Z = -27.f;
}

void FFbSim::Juke()
{
	if (Phase != EFbPhase::Live || Carrier < 0) return;
	FFbEnt& c = E[Carrier];
	if (c.JukeCool > 0.f) return;
	c.JukeT = 0.45f; c.JukeCool = 1.3f;
	const float side = (FMath::Abs((float)Move.Y) > 0.1f) ? ((Move.Y > 0) ? 1.f : -1.f) : ((c.VZ >= 0.f) ? 1.f : -1.f);
	c.VZ += side * 3.5f;
	Status = FString(TEXT("JUKE!"));
}

void FFbSim::OlDlContact()
{
	for (int32 i = FbRole::DL1; i <= FbRole::DL4; i++)
	{
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
	for (int32 i = FbRole::DL1; i <= FbRole::S2; i++)
	{
		FFbEnt& e = E[i];
		const float Sp = TopSpeed(e);
		if (Pursue < 0 && bRun) { e.VX = 0.f; e.VZ = 0.f; continue; }       // on a run the front holds until the play develops
		if (Pursue >= 0)
		{
			const FFbEnt& c = E[Pursue];
			const float Slow = (e.Kind == EFbKind::DL && T < e.BlockedUntil) ? 0.25f : 1.f;
			Go(e, c.X + c.VX * 0.25f, c.Z + c.VZ * 0.25f, Sp * (bRun ? 0.88f : 0.93f) * Slow, dt);
			continue;
		}
		const FFbEnt& q = E[FbRole::QB];
		if (e.Kind == EFbKind::DL)
		{
			const float Sp2 = Sp * ((T < e.BlockedUntil) ? 0.25f : 1.f);
			Go(e, q.X, q.Z, Sp2 * 0.95f, dt);
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
			const float d = FbDist2(E[i].X, E[i].Z, LandX, LandZ);
			if (d < BestD) { BestD = d; Best = i; }
		}
		if (Best >= 0) Go(E[Best], LandX, LandZ, TopSpeed(E[Best]) * 0.95f, dt);
	}
}

void FFbSim::LivePass(float dt)
{
	if (Carrier < 0 && !bFlying) OlDlContact();
	for (int32 i = FbRole::RB; i <= FbRole::W3; i++)
		if (T > 0.15f && i != Carrier) RouteStep(E[i], dt);

	FFbEnt& q = E[FbRole::QB];
	if (Carrier < 0)
	{
		if (!bFlying)
		{
			ControlStep(q, dt);
			if (q.X > Los + 0.5f)                // the QB has run past the line with the ball: now he is a ball carrier
			{
				Carrier = FbRole::QB; Status = FString(TEXT("SCRAMBLE!"));
				DefenseStep(dt, Carrier);
				CheckTackle(Carrier);
				return;
			}
			DefenseStep(dt, -1);
			for (int32 i = FbRole::DL1; i <= FbRole::S2; i++)
			{
				if (FbDist(E[i], q) < 1.05f)
				{
					Tackler = i;
					if (q.X <= Los) End(EFbResult::Sack, FString::Printf(TEXT("SACK  for %d yd loss"), FMath::RoundToInt(FMath::Max(0.f, Los - q.X))), FMath::Min(0.f, q.X - Los));
					else End(EFbResult::Tackled, FString(TEXT("TACKLED")), q.X - Los);
					return;
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
		ControlStep(c, dt);
		if (c.JukeT > 0.f) c.JukeT -= dt;
		if (c.JukeCool > 0.f) c.JukeCool -= dt;
		DefenseStep(dt, Carrier);
		CheckTackle(Carrier);
	}
}

bool FFbSim::Throw(int32 Slot)
{
	if (Phase != EFbPhase::Live || bRun || Carrier >= 0 || bFlying || bEnded) return false;
	static const int32 SlotRole[5] = { FbRole::W1, FbRole::W2, FbRole::W3, FbRole::TE, FbRole::RB };
	if (Slot < 0 || Slot > 4) return false;
	const int32 Rec = SlotRole[Slot];
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
	for (int32 i = FbRole::DL1; i <= FbRole::DL4; i++) if (FbDist(E[i], q) < 3.5f) Pressure += 0.5f;
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
	By = 0.3f; Bx = LandX; Bz = LandZ;
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
	if (Dd < 1.4f)
	{
		const float Roll = FbRnd();
		if (Roll < 0.06f) { Tackler = Dn; End(EFbResult::Interception, FString::Printf(TEXT("INTERCEPTED by %s!"), FbRoleName(Dn)), 0.f); return; }
		if (Roll < 0.34f) { End(EFbResult::Incomplete, FString(TEXT("INCOMPLETE  (broken up)")), 0.f); return; }
	}
	Carrier = R;
	Status = FString::Printf(TEXT("CATCH by %s - RUN!"), FbRoleName(R));
}

void FFbSim::LiveRun(float dt)
{
	FFbEnt& rb = E[FbRole::RB];
	if (Carrier < 0 && T >= 0.55f) { Carrier = FbRole::RB; bHandoffDone = true; Status = FString(TEXT("HANDOFF - RUN!")); }
	if (Carrier < 0)
	{
		if (rb.Route.Num() > 0) Go(rb, (float)rb.Route[0].X, (float)rb.Route[0].Y, TopSpeed(rb) * 0.6f, dt);
	}
	else
	{
		FFbEnt& c = E[Carrier];
		ControlStep(c, dt);
		if (c.JukeT > 0.f) c.JukeT -= dt;
		if (c.JukeCool > 0.f) c.JukeCool -= dt;
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
		if (d > 2.2f) Missed[i] = false;
		if (d < 1.0f)
		{
			if (e.JukeT > 0.f && !Missed[i] && FbRnd() < 0.65f) { Missed[i] = true; Status = FString(TEXT("MISSED TACKLE!")); continue; }
			if (Missed[i]) continue;
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
	YouScore = CpuScore = 0; Drive = 1; Drives = 6; Overtimes = 0; Opp = InOpp; OppRating = InRating; CpuBonus = 0.f; bOver = false;
	NewDrive();
}

void FFbGame::NewDrive()
{
	Down = 1; ToGo = 10.f; Ball = 25.f; LineToGain = 35.f;
}

EFbDrive FFbGame::ApplyPlay(const FFbSim& S)
{
	switch (S.Result)
	{
	case EFbResult::Touchdown: YouScore += 7; CpuBonus = 0.f; return EFbDrive::Score;
	case EFbResult::Interception: CpuBonus = 0.14f; return EFbDrive::Turnover;
	default: break;
	}
	Ball = FMath::Clamp(Ball + S.Yards, 1.f, 99.f);
	if (Ball >= LineToGain)
	{
		Down = 1; ToGo = FMath::Min(10.f, 100.f - Ball); LineToGain = Ball + ToGo;
		return EFbDrive::Continue;
	}
	Down++;
	ToGo = LineToGain - Ball;
	if (Down > 4) { CpuBonus = 0.06f; return EFbDrive::Downs; }
	return EFbDrive::Continue;
}

bool FFbGame::KickFieldGoal(float KickerOvr)
{
	const float Dist = (float)FieldGoalDistance();
	const float P = FMath::Clamp(1.05f - (Dist - 20.f) * 0.016f + (KickerOvr - 85.f) * 0.004f, 0.05f, 0.97f);
	const bool bGood = FbRnd() < P;
	if (bGood) YouScore += 3;
	CpuBonus = bGood ? 0.f : 0.10f;
	return bGood;
}

FString FFbGame::CpuDrive(float UserDefAvg)
{
	const float PTd = FMath::Clamp(0.27f + ((float)OppRating - UserDefAvg) * 0.011f + CpuBonus, 0.06f, 0.65f);
	const float PFg = 0.18f;
	const float R = FbRnd();
	CpuBonus = 0.f;
	if (R < PTd)
	{
		CpuScore += 7;
		return FString::Printf(TEXT("%s drive: %d yards, TOUCHDOWN"), *Opp, 55 + FMath::RoundToInt(FbRnd() * 30.f));
	}
	if (R < PTd + PFg)
	{
		CpuScore += 3;
		return FString::Printf(TEXT("%s drive stalls: %d-yard FIELD GOAL"), *Opp, 30 + FMath::RoundToInt(FbRnd() * 22.f));
	}
	if (FbRnd() < 0.25f) return FString::Printf(TEXT("%s drive ends in a TURNOVER"), *Opp);
	return FString::Printf(TEXT("Your defence stops %s - they punt"), *Opp);
}

void FFbGame::AfterCpuDrive()
{
	if (Drive >= Drives)
	{
		if (YouScore != CpuScore || Overtimes >= 3) { bOver = true; return; }
		Overtimes++; Drives++;
	}
	Drive++;
	NewDrive();
}

FString FFbGame::DownText() const
{
	const TCHAR* Ord[5] = { TEXT("1st"), TEXT("1st"), TEXT("2nd"), TEXT("3rd"), TEXT("4th") };
	const int32 D = FMath::Clamp(Down, 1, 4);
	const int32 Spot = (Ball <= 50.f) ? (int32)Ball : (int32)(100.f - Ball);
	const TCHAR* Side = (Ball <= 50.f) ? TEXT("OWN") : TEXT("OPP");
	const int32 Goal = (LineToGain >= 100.f);
	if (Goal) return FString::Printf(TEXT("%s & Goal   ball on %s %d"), Ord[D], Side, Spot);
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
