# Ultimate Online: QB Throwing Animation Interface (v139)

This is the contract between the game's throwing system and the QB animation library.
The game decides **when** the ball leaves the hand, and it drives the clip's time to match.
Your clips supply the motion and say where the key moments are. The game handles the timing.

## 1. Where the library goes

Use the same layout as the existing `anim/def` and `anim/recv` libraries:

```
anim/qb/manifest.json
anim/qb/clips/<file>.glb.gz        <- gzipped GLB, one animation per file
```

- **Rig:** the same `mixamorig` skeleton as `player_v2.glb` (74 joints; see `player_model_bones.txt`).
- **Frame rate:** 60 fps.
- **Root motion:** the game pins the hips' horizontal position like the other libraries, so the player's real movement comes from gameplay. Authoring root translation is fine; it is reported in the manifest for information only.
- **Ball hand:** the ball is attached to `mixamorigRightHand` (offset slightly toward the forearm). It stays there until the release event.

If `anim/qb/manifest.json` is missing, the game falls back to the one real throw inside the embedded `qbPass` clip, which runs from 5.07 s to 5.72 s.

## 2. Manifest format

```json
{
  "name": "Ultimate Online QB throwing library",
  "version": 1,
  "fps": 60,
  "rig": "mixamorig (player_v2.glb)",
  "clips": [
    {
      "id": "QB_MEDIUM_A",
      "file": "clips/QB_MEDIUM_A.glb",
      "title": "Medium throw, planted",
      "category": "qb_medium",
      "power_range": [0.4, 0.78],
      "direction": "in_place",
      "duration_s": 1.10,
      "frames": 66,
      "blend_in_s": 0.12,
      "events": {
        "windup_start": 0.05,
        "cocked": 0.38,
        "release": 0.55,
        "follow_through_end": 0.85,
        "transition_ready": 0.90,
        "animation_complete": 1.10
      },
      "root_motion": { "forward_m": 0.25, "lateral_m": 0.0 }
    }
  ]
}
```

Required fields: `id`, `file`, `category` (one of the 12 below), and `events.release` (seconds, greater than 0).
Recommended fields: `events.windup_start`, `events.cocked`, `events.follow_through_end`, `power_range`, `blend_in_s`.
The game serves `file` + `.gz` from `anim/qb/`.

### Event meanings

| Event | Meaning |
|---|---|
| `windup_start` | Ball at the chest, about to load. |
| `cocked` | The arm is fully back. This is the pose held while the player holds the button. |
| `release` | The ball leaves the hand. Set it at the hand's maximum forward extension, while it is still moving fast. |
| `follow_through_end` | The throwing arm has finished coming down and across. |
| `transition_ready` and `animation_complete` | Informational; locomotion takes over after the follow-through. |

## 3. How the game plays a clip

The game drives a **throw phase** from 0 to 3 and maps it onto your events piecewise:

| Phase | Clip time | When |
|---|---|---|
| 0 → 1 | `windup_start` → `cocked` | While the button is held. The arm cocks over 0.28 s of hold, then holds the cocked pose. The QB only cocks below 2.6 yd/s; faster than that he keeps running and cocks at release. |
| 1 → 2 | `cocked` → `release` | The forward whip after the button is let go. It takes 0.09 s (dish) to 0.17 s (full power), roughly ±2.5% by arm strength. The CPU QB is 40% quicker. |
| **2** | `release` | **The ball spawns at the right hand on exactly this frame.** |
| 2 → 3 | `release` → `follow_through_end` | 0.26 s of follow-through. |

So your clip's native speed does not matter; only the event times do. Keep `cocked` → `release` a clean, fast forward whip. The game compresses or stretches it to the gameplay timing.

Clip choice: the game takes the throw category from section 4, then picks the clip in that category whose `power_range` best contains the throw power.

## 4. Throw categories

Use these exact names. The game detects them from the QB's velocity relative to the target and the field, plus his state:

| Category | When the game uses it |
|---|---|
| `qb_quick_dish` | Planted, power under 0.15, target under 10 yd |
| `qb_short` | Planted, power under 0.4 |
| `qb_medium` | Planted, power 0.4 to 0.78 |
| `qb_full_power` | Planted, power 0.78 or more |
| `qb_medium_roll_left` / `qb_medium_roll_right` | Moving sideways faster than 2 yd/s, below sprint speed |
| `qb_medium_step_forward` | A controlled step into the throw, or moving toward the line, with power of at least 0.25 |
| `qb_medium_jump_back` | Airborne while moving back, or retreating fast |
| `qb_sprint_left` / `qb_sprint_right` | Sideways at sprint speed (about 6+ yd/s) |
| `qb_backpedal` | Retreating (moving away from the line) |
| `qb_off_balance` | Stunned, recoiling from contact, or airborne |

"Right" means toward +z, which is the player's right when viewed from behind the offense.

## 5. Runtime API (`window.QB_THROW`)

```js
QB_THROW.on((event, state, qb) => { ... })   // returns an unsubscribe function
// event: 'start' | 'release' | 'complete' | 'interrupted'
```

`state` contains these fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | number | Unique throw id |
| `category` | string | One of the 12 categories |
| `state` | string | `windup_forward`, `follow_through`, `complete` or `interrupted` |
| `power` | 0..1 | From the hold |
| `power_effective` | 0..1 | After the body's effect |
| `label` | string | TOUCH, SHORT, MEDIUM, FIRM or BULLET |
| `move` | `{x, z, speed}` | Movement direction (unit vector) and speed in yd/s |
| `factors` | `{velocity, accuracy}` | Body multipliers |
| `release_t` | seconds | Time from button release to the ball leaving the hand |
| `release_norm` | 0..1 | Release point within the whole motion (whip + follow-through) |
| `blend_s` | seconds | Cross-fade into the throw (0.12 s) |
| `root` | `{dx, dz}` | Expected root movement during the motion, in yards |
| `cock` | 0..1 | How far the arm was cocked when the button was let go |
| `released_at` | seconds | Game time of the release |
| `release_pos` | `{x, y, z}` | Where the ball left the hand |
| `v0` | yd/s | Release speed |
| `flight_t` | seconds | Time in the air |
| `short` | boolean | Out of range: the ball dies short on the same line |

`QB_THROW.cfg` holds every tuning value (power curve, speeds, timings).
`QB_THROW.lib.state` is `idle`, `loading`, `ready` or `off`.

## 6. Online play

The host simulates the throw. Each player's throw phase (`qbPh`) and category (`qbCat`) go out in every snapshot, so the other screen plays the same clip at the same phase. Release timing and ball spawn are host-authoritative.

## 7. Limits

- The game cannot blend upper and lower body separately. A throw clip is full body, played while gameplay moves the player.
- The cocked pose is only held when the QB is nearly still (below 2.6 yd/s), to avoid skating.
