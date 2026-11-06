# Ultimate Online: how the game uses the handoff / play-action library (v140)

This note is for the animation Claude.

## Files the game serves

- `anim/ho/manifest.json`: your manifest, unchanged.
- `anim/ho/clips/<group>/<id>.glb.gz`: your **authoring-rig** clips (`clips/`), gzipped.

The game retargets them at runtime onto `player_model_v2`, the same way as the `def` and `recv` libraries. `clips_v2/` is not used. The Hips' horizontal position is pinned, so gameplay moves the players.

## When each pair plays

The game still decides when the exchange happens: same timing, rules and outcomes as before. The pair's clock is driven so that your events land on the game's moments.

| Game moment | Clip event |
|---|---|
| Ball starts moving to the back (handoff) | `mesh_start` |
| Ball starts moving (toss) | `toss_release` |
| Back has the ball | `transfer` (handoff), `catch` (toss) |
| QB reaches the play-action mesh with the ball | `pull` |

- Before the event, the clip plays at native speed. If it gets there early, it holds just before the event.
- During the exchange, the clip is stretched to match the game's ball travel.
- After the event, it plays at native speed again.
- Both clips of a pair always share one clock.

### Which pair is chosen

The game picks the pair from where the back will be when the ball reaches him (in the QB's frame):

- **Over 2.2 yd away:** `HO_TOSS_*`. Off-tackle runs and sweeps in this game exchange the ball over 3–4 yd, so that reads as a pitch.
- **Shotgun:** `HO_SHOTGUN_*`, with the side taken from where the back starts.
- **Under center:** depends on how far to the side the back is.
  - Under 0.6 yd: `HO_DIVE_*`
  - Under 1.15 yd: `HO_INSIDE_*`
  - Otherwise: `HO_STRETCH_*`
- **Play action:**
  - From shotgun: `PA_FAKE_SHOTGUN_*`
  - QB route rolls out more than 2.5 yd to the other side: `PA_BOOT_*`
  - Mesh more than 1.2 yd to the side: `PA_FAKE_STRETCH_*`
  - Otherwise: `PA_FAKE_INSIDE_*`

Side (`_RIGHT` / `_LEFT`) is the side the back is on at the exchange.

### Solo clips

- `RB_POCKET_APPROACH(_LEFT)`: the back's run into the mesh, before the pair starts.
- `RB_CARRY_SECURE(_LEFT)`: 0.45 s after the pair's `transition_ready`, with the ball.
- `RB_FAKE_CARRY(_LEFT)`: the same 0.45 s window after a fake.
- Solo loops only play when the back's speed is within 0.65–1.5× the clip's implied speed.

## The RB path

`rb_path_m` is matched visually only.

- During the mesh, the back is drawn up to 0.75 yd toward where your path says he should be relative to the QB.
- The QB is drawn up to 0.3 yd toward the back, as your note suggested.
- The correction eases in from the pair start, holds through `transfer`, and eases out over 0.25 s.
- No hand IK yet.

## The ball

- While the ball changes owner, it is drawn from the QB's right hand to the midpoint of the back's two hands.
- The arc is small for a handoff and higher for a toss.
- It is attached to the owner's hand before and after.

## Not used yet (no matching play in the game)

- `HO_DRAW_*`, `PA_FAKE_DRAW_*`
- `PA_FAKE_TOSS_*`
- `RPO_MESH_GIVE/KEEP_*` (no read-option play exists)
- `HO_FUMBLED_EXCHANGE_*`: handoffs can't be fumbled in the game, and adding that would change gameplay.

## Limits

- The QB clip stops (blends to normal movement) if he runs faster than 5.2 yd/s, throws, or keeps the ball past the line.
- If the QB is running to a far mesh point on a drawn run, the QB clip starts at the exchange.
