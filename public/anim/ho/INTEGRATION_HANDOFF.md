# Ultimate Online handoff and play-action library: integration handoff

From the animation Claude to the game Claude. Synchronized quarterback + running back pairs for handoffs, tosses, read-option meshes, a fumbled exchange, and play-action fakes and bootlegs, plus solo running-back clips. Same rig, conventions, events and ball rules as the quarterback library.

## 1. What is in the folder

| Path | What it is |
|---|---|
| `manifest.json` | One entry per file: `role` (QB/RB), `kind`, `state_id`, `events`, `ball` (carried window and owner timeline), `pair` (RB path, root yaw, mesh window, transfer/pull/fumble times), `partner_file`, `mirror_file`, foot contacts, implied ground speed. |
| `transitions.json` | States, chains (run play, play action, bootleg, toss sweep, draw, RPO, fumble) and rules. |
| `clips/01_handoffs`, `clips/02_play_action`, `clips/03_rb_solo` | Authoring-rig clips (`football_player.fbx`, 65 `mixamorig:` bones; the game's runtime retarget takes them onto `player_model_v2`). |
| `clips_v2/...` | The same clips already retargeted onto `player_model_v2.glb`. Use one folder or the other. |
| `previews/` | Contact sheets on both rigs (`fb_*`, `v2_*`): blue = QB, red = RB, brown = the reference football. |
| `QUALITY_AUDIT.txt` | Ball-holding windows, implied speeds, pitch/fumble reference data. |

Every pair exists as `*_RIGHT` (RB on the QB's right, QB opens right) and `*_LEFT` (exact mirror). Pair files end in `_QB` and `_RB`.

## 2. How a pair works

* **Frame:** the QB root at the snap. +z downfield, +x the QB's left, 45.2 rig units = player height (24.7 per metre). Both clips are in place (Hips Y only).
* **Start both clips on the same tick** with the same `timeScale`.
* **The RB travels.** `pair.rb_path_m` gives the RB root position relative to the QB root over time (metres), and `pair.rb_root_yaw_deg` his facing. The game moves the RB root along that path (or a path close to it; both players' hands were solved against it, so the ball exchange lines up when the RB is where the path says at `transfer`). The QB root stays put; in the dropback-style draw the QB's own footwork is baked.
* **One football.** The QB's hand carries it from the snap; the RB's hand carries it from `transfer` (handoff) or `catch` (toss). `ball.owner_timeline` lists the owner per phase (`QB`, `RB`, `loose`, `none`). Attach the ball to the owner's hand with the grip rule from the quarterback library (`ball.attach` there); at the switch the two hand positions are within about 2 rig units (one frame of RB travel).
* **Fakes** never move the ball: the QB keeps it (hidden on the hip, then brought to the chest) and the RB wraps his arms on nothing.

## 3. Events (seconds; also in each GLB under `animation.extras.events`)

`snap`, `open_step`, `drop_complete` (draw), `mesh_start` (QB hand reaches the RB pocket), `transfer` (ball changes hands) or `pull` (QB keeps it), `mesh_end`, `carry_secure` (RB has it tucked), `toss_release`, `catch`, `fumble`, `fake_complete`, `transition_ready`, `animation_complete`, plus measured `foot_plant_left/right`.

* Fire the ball-owner switch on `transfer` (or `catch`); fire the loose ball on `fumble` or `toss_release` (the toss arc is a reference; `release.hand_velocity_dir_root` and `ball_position_root` give the launch).
* RPO give and keep share every frame up to `mesh_end`: start either, and switch to the other at any frame before the read is resolved with a 0–2 frame blend.

## 4. Clip set

* **Handoffs:** inside (under center, open step), quick dive, outside zone / stretch (QB runs laterally with the ball extended), shotgun crossing handoff, toss (underhand pitch, RB catches wide), draw (3-step drop then hand off), RPO mesh give, RPO mesh keep, fumbled exchange.
* **Play action:** fake inside handoff (hide on the hip, set to pass), naked bootleg after the inside fake (run out the other way with the ball hidden, then up), fake stretch (pull, plant, set), fake shotgun handoff, fake toss, fake draw.
* **RB solo:** pocket approach loop (inside elbow up, outside palm up: blend into any pair), fake carry loop (arms wrapped on nothing), secure carry loop.

Every handoff and fake ends with the QB in his ready stance (ball at the chest for fakes, empty hands for handoffs) or in a jog for boots, so the quarterback library states follow directly: `QB_POCKET`, any `QB_THROW_*`, `QB_JOG_*`.

## 5. State machine

`QB_HANDOFF`, `QB_TOSS`, `QB_PLAY_ACTION`, `QB_HANDOFF_FUMBLE`, `RB_MESH_APPROACH`, `RB_CARRY`, `RB_FAKE_CARRY`. Blend 4 frames into the RB clip of a pair from `RB_POCKET_APPROACH`, 4–6 frames out. After `transition_ready` the QB goes to the quarterback library states; the RB with the ball goes to the ballcarrier run / MASS runner states, the faking RB to block or route states.

## 6. Known limits

* **Not played in the game.** Checked numerically (ball continuity at the transfer, holding windows, foot contacts, file validation, Blender round trip) and on rendered contact sheets of both rigs.
* **The QB does not travel.** Real quarterbacks take a small step with the mesh; the clips reach with the arms and torso instead. If the game lets the QB root drift toward the RB by up to 0.3 m during the mesh window, the exchange will look even closer.
* **The RB path is the authored ideal.** Where the game's RB is more than about 0.3 m off it at `transfer`, use hand IK on the QB's throwing hand toward the RB's belly (bone `Spine` + 6 units forward) for the mesh window.
* **Reverse pivots are not included** (the QB turning his back to the RB first): the engine's leg solver does not handle a 180° hip turn on planted feet.
* **v2 previews** place the ball by my own grip rule and show the bare head.

## 7. Clip list

| File (id) | Role | Kind | State | Partner | What it is |
|---|---|---|---|---|---|
| HO_INSIDE_RIGHT_QB | QB | handoff | QB_HANDOFF | HO_INSIDE_RIGHT_RB | Inside handoff to the right (open step, ball seated in the RB pocket, empty-hand fake after) |
| HO_INSIDE_RIGHT_RB | RB | handoff | QB_HANDOFF | HO_INSIDE_RIGHT_QB | Inside handoff to the right (open step, ball seated in the RB pocket, empty-hand fake after) |
| HO_INSIDE_LEFT_QB | QB | handoff | QB_HANDOFF | HO_INSIDE_LEFT_RB | Inside handoff to the right (open step, ball seated in the RB pocket, empty-hand fake after) (mirrored: left side) |
| HO_INSIDE_LEFT_RB | RB | handoff | QB_HANDOFF | HO_INSIDE_LEFT_QB | Inside handoff to the right (open step, ball seated in the RB pocket, empty-hand fake after) (mirrored: left side) |
| PA_FAKE_INSIDE_RIGHT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_INSIDE_RIGHT_RB | Play-action: fake inside handoff right, hide the ball on the hip, set up to pass |
| PA_FAKE_INSIDE_RIGHT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_INSIDE_RIGHT_QB | Play-action: fake inside handoff right, hide the ball on the hip, set up to pass |
| PA_FAKE_INSIDE_LEFT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_INSIDE_LEFT_RB | Play-action: fake inside handoff right, hide the ball on the hip, set up to pass (mirrored: left side) |
| PA_FAKE_INSIDE_LEFT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_INSIDE_LEFT_QB | Play-action: fake inside handoff right, hide the ball on the hip, set up to pass (mirrored: left side) |
| PA_BOOT_LEFT_AFTER_FAKE_RIGHT_QB | QB | fake | QB_PLAY_ACTION | PA_BOOT_LEFT_AFTER_FAKE_RIGHT_RB | Naked bootleg: fake inside handoff right, run out left with the ball hidden then up |
| PA_BOOT_LEFT_AFTER_FAKE_RIGHT_RB | RB | fake | QB_PLAY_ACTION | PA_BOOT_LEFT_AFTER_FAKE_RIGHT_QB | Naked bootleg: fake inside handoff right, run out left with the ball hidden then up |
| PA_BOOT_RIGHT_AFTER_FAKE_LEFT_QB | QB | fake | QB_PLAY_ACTION | PA_BOOT_RIGHT_AFTER_FAKE_LEFT_RB | Naked bootleg: fake inside handoff right, run out left with the ball hidden then up (mirrored: left side) |
| PA_BOOT_RIGHT_AFTER_FAKE_LEFT_RB | RB | fake | QB_PLAY_ACTION | PA_BOOT_RIGHT_AFTER_FAKE_LEFT_QB | Naked bootleg: fake inside handoff right, run out left with the ball hidden then up (mirrored: left side) |
| HO_DIVE_RIGHT_QB | QB | handoff | QB_HANDOFF | HO_DIVE_RIGHT_RB | Quick dive handoff (RB straight past the right hip) |
| HO_DIVE_RIGHT_RB | RB | handoff | QB_HANDOFF | HO_DIVE_RIGHT_QB | Quick dive handoff (RB straight past the right hip) |
| HO_DIVE_LEFT_QB | QB | handoff | QB_HANDOFF | HO_DIVE_LEFT_RB | Quick dive handoff (RB straight past the right hip) (mirrored: left side) |
| HO_DIVE_LEFT_RB | RB | handoff | QB_HANDOFF | HO_DIVE_LEFT_QB | Quick dive handoff (RB straight past the right hip) (mirrored: left side) |
| HO_STRETCH_RIGHT_QB | QB | handoff | QB_HANDOFF | HO_STRETCH_RIGHT_RB | Outside-zone handoff right (QB runs laterally, ball extended, RB takes it wide) |
| HO_STRETCH_RIGHT_RB | RB | handoff | QB_HANDOFF | HO_STRETCH_RIGHT_QB | Outside-zone handoff right (QB runs laterally, ball extended, RB takes it wide) |
| HO_STRETCH_LEFT_QB | QB | handoff | QB_HANDOFF | HO_STRETCH_LEFT_RB | Outside-zone handoff right (QB runs laterally, ball extended, RB takes it wide) (mirrored: left side) |
| HO_STRETCH_LEFT_RB | RB | handoff | QB_HANDOFF | HO_STRETCH_LEFT_QB | Outside-zone handoff right (QB runs laterally, ball extended, RB takes it wide) (mirrored: left side) |
| PA_FAKE_STRETCH_RIGHT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_STRETCH_RIGHT_RB | Play-action: fake outside-zone handoff right, pull, plant and set up |
| PA_FAKE_STRETCH_RIGHT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_STRETCH_RIGHT_QB | Play-action: fake outside-zone handoff right, pull, plant and set up |
| PA_FAKE_STRETCH_LEFT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_STRETCH_LEFT_RB | Play-action: fake outside-zone handoff right, pull, plant and set up (mirrored: left side) |
| PA_FAKE_STRETCH_LEFT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_STRETCH_LEFT_QB | Play-action: fake outside-zone handoff right, pull, plant and set up (mirrored: left side) |
| HO_SHOTGUN_RIGHT_TO_LEFT_QB | QB | handoff | QB_HANDOFF | HO_SHOTGUN_RIGHT_TO_LEFT_RB | Shotgun handoff: RB from the right crosses in front, QB seats the ball with the right hand |
| HO_SHOTGUN_RIGHT_TO_LEFT_RB | RB | handoff | QB_HANDOFF | HO_SHOTGUN_RIGHT_TO_LEFT_QB | Shotgun handoff: RB from the right crosses in front, QB seats the ball with the right hand |
| HO_SHOTGUN_LEFT_TO_RIGHT_QB | QB | handoff | QB_HANDOFF | HO_SHOTGUN_LEFT_TO_RIGHT_RB | Shotgun handoff: RB from the right crosses in front, QB seats the ball with the right hand (mirrored: left side) |
| HO_SHOTGUN_LEFT_TO_RIGHT_RB | RB | handoff | QB_HANDOFF | HO_SHOTGUN_LEFT_TO_RIGHT_QB | Shotgun handoff: RB from the right crosses in front, QB seats the ball with the right hand (mirrored: left side) |
| PA_FAKE_SHOTGUN_RIGHT_TO_LEFT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_SHOTGUN_RIGHT_TO_LEFT_RB | Play-action from shotgun: fake the crossing handoff, pull and set |
| PA_FAKE_SHOTGUN_RIGHT_TO_LEFT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_SHOTGUN_RIGHT_TO_LEFT_QB | Play-action from shotgun: fake the crossing handoff, pull and set |
| PA_FAKE_SHOTGUN_LEFT_TO_RIGHT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_SHOTGUN_LEFT_TO_RIGHT_RB | Play-action from shotgun: fake the crossing handoff, pull and set (mirrored: left side) |
| PA_FAKE_SHOTGUN_LEFT_TO_RIGHT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_SHOTGUN_LEFT_TO_RIGHT_QB | Play-action from shotgun: fake the crossing handoff, pull and set (mirrored: left side) |
| HO_TOSS_RIGHT_QB | QB | toss | QB_TOSS | HO_TOSS_RIGHT_RB | Toss (pitch) right: QB opens and pitches underhand, RB catches wide and tucks |
| HO_TOSS_RIGHT_RB | RB | toss | QB_TOSS | HO_TOSS_RIGHT_QB | Toss (pitch) right: QB opens and pitches underhand, RB catches wide and tucks |
| HO_TOSS_LEFT_QB | QB | toss | QB_TOSS | HO_TOSS_LEFT_RB | Toss (pitch) right: QB opens and pitches underhand, RB catches wide and tucks (mirrored: left side) |
| HO_TOSS_LEFT_RB | RB | toss | QB_TOSS | HO_TOSS_LEFT_QB | Toss (pitch) right: QB opens and pitches underhand, RB catches wide and tucks (mirrored: left side) |
| PA_FAKE_TOSS_RIGHT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_TOSS_RIGHT_RB | Play-action: fake toss right (arms swing, ball stays), hide and set |
| PA_FAKE_TOSS_RIGHT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_TOSS_RIGHT_QB | Play-action: fake toss right (arms swing, ball stays), hide and set |
| PA_FAKE_TOSS_LEFT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_TOSS_LEFT_RB | Play-action: fake toss right (arms swing, ball stays), hide and set (mirrored: left side) |
| PA_FAKE_TOSS_LEFT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_TOSS_LEFT_QB | Play-action: fake toss right (arms swing, ball stays), hide and set (mirrored: left side) |
| HO_DRAW_RIGHT_QB | QB | handoff | QB_HANDOFF | HO_DRAW_RIGHT_RB | Draw: 3-step drop, then the RB steps up and takes the handoff on the right |
| HO_DRAW_RIGHT_RB | RB | handoff | QB_HANDOFF | HO_DRAW_RIGHT_QB | Draw: 3-step drop, then the RB steps up and takes the handoff on the right |
| HO_DRAW_LEFT_QB | QB | handoff | QB_HANDOFF | HO_DRAW_LEFT_RB | Draw: 3-step drop, then the RB steps up and takes the handoff on the right (mirrored: left side) |
| HO_DRAW_LEFT_RB | RB | handoff | QB_HANDOFF | HO_DRAW_LEFT_QB | Draw: 3-step drop, then the RB steps up and takes the handoff on the right (mirrored: left side) |
| PA_FAKE_DRAW_RIGHT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_DRAW_RIGHT_RB | Fake draw: 3-step drop, fake the handoff, set to pass |
| PA_FAKE_DRAW_RIGHT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_DRAW_RIGHT_QB | Fake draw: 3-step drop, fake the handoff, set to pass |
| PA_FAKE_DRAW_LEFT_QB | QB | fake | QB_PLAY_ACTION | PA_FAKE_DRAW_LEFT_RB | Fake draw: 3-step drop, fake the handoff, set to pass (mirrored: left side) |
| PA_FAKE_DRAW_LEFT_RB | RB | fake | QB_PLAY_ACTION | PA_FAKE_DRAW_LEFT_QB | Fake draw: 3-step drop, fake the handoff, set to pass (mirrored: left side) |
| RPO_MESH_GIVE_RIGHT_QB | QB | rpo | QB_HANDOFF | RPO_MESH_GIVE_RIGHT_RB | Read-option mesh right: QB rides the RB through the mesh and gives |
| RPO_MESH_GIVE_RIGHT_RB | RB | rpo | QB_HANDOFF | RPO_MESH_GIVE_RIGHT_QB | Read-option mesh right: QB rides the RB through the mesh and gives |
| RPO_MESH_GIVE_LEFT_QB | QB | rpo | QB_HANDOFF | RPO_MESH_GIVE_LEFT_RB | Read-option mesh right: QB rides the RB through the mesh and gives (mirrored: left side) |
| RPO_MESH_GIVE_LEFT_RB | RB | rpo | QB_HANDOFF | RPO_MESH_GIVE_LEFT_QB | Read-option mesh right: QB rides the RB through the mesh and gives (mirrored: left side) |
| RPO_MESH_KEEP_RIGHT_QB | QB | rpo | QB_PLAY_ACTION | RPO_MESH_KEEP_RIGHT_RB | Read-option mesh right: QB rides the RB and pulls the ball (keep), sets to throw or run |
| RPO_MESH_KEEP_RIGHT_RB | RB | rpo | QB_PLAY_ACTION | RPO_MESH_KEEP_RIGHT_QB | Read-option mesh right: QB rides the RB and pulls the ball (keep), sets to throw or run |
| RPO_MESH_KEEP_LEFT_QB | QB | rpo | QB_PLAY_ACTION | RPO_MESH_KEEP_LEFT_RB | Read-option mesh right: QB rides the RB and pulls the ball (keep), sets to throw or run (mirrored: left side) |
| RPO_MESH_KEEP_LEFT_RB | RB | rpo | QB_PLAY_ACTION | RPO_MESH_KEEP_LEFT_QB | Read-option mesh right: QB rides the RB and pulls the ball (keep), sets to throw or run (mirrored: left side) |
| HO_FUMBLED_EXCHANGE_RIGHT_QB | QB | fumble | QB_HANDOFF_FUMBLE | HO_FUMBLED_EXCHANGE_RIGHT_RB | Fumbled exchange: the ball comes out of the mesh, both players turn and bend for it |
| HO_FUMBLED_EXCHANGE_RIGHT_RB | RB | fumble | QB_HANDOFF_FUMBLE | HO_FUMBLED_EXCHANGE_RIGHT_QB | Fumbled exchange: the ball comes out of the mesh, both players turn and bend for it |
| HO_FUMBLED_EXCHANGE_LEFT_QB | QB | fumble | QB_HANDOFF_FUMBLE | HO_FUMBLED_EXCHANGE_LEFT_RB | Fumbled exchange: the ball comes out of the mesh, both players turn and bend for it (mirrored: left side) |
| HO_FUMBLED_EXCHANGE_LEFT_RB | RB | fumble | QB_HANDOFF_FUMBLE | HO_FUMBLED_EXCHANGE_LEFT_QB | Fumbled exchange: the ball comes out of the mesh, both players turn and bend for it (mirrored: left side) |
| RB_POCKET_APPROACH | RB | rb | RB_MESH_APPROACH |  | RB approaching the mesh with the pocket formed (inside elbow up, outside palm up) |
| RB_POCKET_APPROACH_LEFT | RB | rb | RB_MESH_APPROACH |  | RB approaching the mesh with the pocket formed (inside elbow up, outside palm up) (mirrored: left side) |
| RB_FAKE_CARRY | RB | rb | RB_FAKE_CARRY |  | RB carrying out the fake (arms wrapped on nothing, running hard) |
| RB_FAKE_CARRY_LEFT | RB | rb | RB_FAKE_CARRY |  | RB carrying out the fake (arms wrapped on nothing, running hard) (mirrored: left side) |
| RB_CARRY_SECURE | RB | rb | RB_CARRY |  | RB running with the ball secured high and tight (after a handoff) |
| RB_CARRY_SECURE_LEFT | RB | rb | RB_CARRY |  | RB running with the ball secured high and tight (after a handoff) (mirrored: left side) |
