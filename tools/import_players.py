"""Import the Ultimate Football player spreadsheet into the game as read-only data.

usage: python3 -I import_players.py <players.xlsx> <ultimate-sports.html>

Writes window.FB_PLAYER_DB into the HTML (one line, placed after the existing
window.FB_COACH_VOICE asset line). Re-running replaces the previous line.
No gameplay code is touched.
"""
import sys, json, openpyxl

GAME_SKIN_PALETTE = ['#f2d0b0', '#c58c5f', '#8a5a3a', '#5d3a24', '#e0b48c', '#6f4630']  # the game's own skin tones
WHITE_PRESET_HEX = '#f2d0b0'
ATTRS = ['Speed', 'Agility', 'Strength', 'Direction Change', 'Break Tackle', 'Ball Security',
         'Blocking', 'Catching', 'Route Running', 'Tackling', 'Big Hit', 'Coverage', 'Interceptions']
MARK = 'window.FB_PLAYER_DB='
EXCLUDE = {'Jordan Whitehead'}   # removed at the owner's request

def clean(v):
    return None if v in ('', None) else v

def build(xlsx):
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    rows = list(wb['Players'].iter_rows(values_only=True))
    H = rows[0]; ix = {h: i for i, h in enumerate(H)}
    status = {r[1]: r[3] for r in list(wb['Still Missing'].iter_rows(values_only=True))[1:] if r[1]}
    players, generated_n = [], 0
    for r in rows[1:]:
        if not r[0] or r[1] in EXCLUDE:
            continue
        g = lambda k: clean(r[ix[k]])
        name, pos, tier = g('Player'), g('Pos'), g('Tier')
        if name == 'Harrison Mevis':
            tier = 'F'                       # reserved tier
        skin_label = g('Skin Tone')
        appearance = {'preset': skin_label, 'generated': False, 'skin_hex': g('Skin HEX'),
                      'jersey_hex': g('Jersey HEX'), 'accent_hex': g('Accent HEX'),
                      'helmet_hex': g('Helmet HEX'), 'pants_hex': g('Pants HEX')}
        if pos == 'K':
            appearance['preset'] = 'White'   # all kickers use the White preset
            appearance['skin_hex'] = appearance['skin_hex'] or WHITE_PRESET_HEX
        elif skin_label in (None, 'Photo match required'):
            appearance['preset'] = 'Generated-%02d' % (generated_n + 1)
            appearance['generated'] = True
            appearance['skin_hex'] = appearance['skin_hex'] or GAME_SKIN_PALETTE[generated_n % len(GAME_SKIN_PALETTE)]
            generated_n += 1
        skills = []
        for k in range(1, 6):
            sn, sr = g('Skill %d' % k), g('Rating %d' % k)
            if sn:
                skills.append({'name': sn, 'rating': sr})
        players.append({
            'id': g('Player ID'), 'name': name, 'pos': pos, 'tier': tier, 'type': g('Type'),
            'team': g('Team'), 'jersey': g('Jersey #'),
            'height': g('Height'), 'height_in': g('Height in'), 'weight_lb': g('Weight lb'),
            'game_weight_lb': g('Game Weight lb'), 'mass_kg': g('Mass kg'), 'reach_m': g('Reach m'),
            'inertia': g('Inertia'), 'overall': g('Base OVR'),
            'appearance': appearance,
            'attributes': {a.lower().replace(' ', '_'): g(a) for a in ATTRS},
            'skills': skills, 'special_rule': g('Special Rule'),
            'appearance_status': status.get(name),   # from the "Still Missing" sheet, if listed
            'tier_pending': tier == 'UNASSIGNED',
            'rarity': None,                          # no rarity column in the sheet; set later
        })
    return players

def write(players, html):
    s = open(html, encoding='utf-8').read()
    line = MARK + json.dumps(players, separators=(',', ':')) + ';'
    lines = s.split('\n')
    lines = [l for l in lines if not l.startswith(MARK)]
    at = next(i for i, l in enumerate(lines) if l.startswith('window.FB_COACH_VOICE='))
    lines.insert(at + 1, line)
    open(html, 'w', encoding='utf-8').write('\n'.join(lines))

if __name__ == '__main__':
    players = build(sys.argv[1])
    write(players, sys.argv[2])
    print('players written:', len(players))
