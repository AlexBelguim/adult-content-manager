"""Performer profile labels (hair, eyes, ethnicity, body ...) for the AI models, in their own SQLite file: data/profile_labels.db.
The app's own performer fields (the scraped hair_color, ethnicity, body_type ...) are never read or written here.
A performer is her folder name. Each row is one performer's profile from one source:
  - 'alex', 'claude': labelled by hand from her pictures (gold). A value is the right answer, {"any": [...]} a set of fair answers,
    and a field left out could not be judged;
  - 'qwen': the profile labeller's answer, with the model that gave it and how many pictures it looked at.

usage: profile_labels.py import <labels.json> <source>   (a {performer: labels} file, e.g. the 2026-10-16 gold labels)
       profile_labels.py list
"""
import json, sqlite3, sys, time
from contextlib import closing
from pathlib import Path

DB_PATH = Path(__file__).parent / 'data' / 'profile_labels.db'
HAND = ('alex', 'claude')  # hand sources, the first one wins when both labelled a performer


def connect():
    DB_PATH.parent.mkdir(exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.execute("""CREATE TABLE IF NOT EXISTS profiles (
        performer TEXT NOT NULL,
        source TEXT NOT NULL,
        labels TEXT NOT NULL,
        model TEXT,
        images INTEGER,
        updated_at REAL NOT NULL,
        PRIMARY KEY (performer, source))""")
    return db


def save(performer, source, labels, model=None, images=None):
    with closing(connect()) as db, db:
        db.execute("INSERT OR REPLACE INTO profiles VALUES (?, ?, ?, ?, ?, ?)",
                   (performer, source, json.dumps(labels), model, images, time.time()))


def profiles(performer=None, source=None):
    """[{performer, source, labels, model, images, updated_at}], filtered by performer and source when given"""
    where = [(c, v) for c, v in (('performer', performer), ('source', source)) if v is not None]
    sql = "SELECT performer, source, labels, model, images, updated_at FROM profiles"
    if where:
        sql += " WHERE " + " AND ".join(f"{c} = ?" for c, _ in where)
    with closing(connect()) as db:
        rows = db.execute(sql + " ORDER BY performer, source", [v for _, v in where]).fetchall()
    return [{'performer': p, 'source': s, 'labels': json.loads(l), 'model': m, 'images': n, 'updated_at': t} for p, s, l, m, n, t in rows]


def gold():
    """{performer: labels} from the best hand source of each hand-labelled performer"""
    out = {}
    for row in sorted((r for r in profiles() if r['source'] in HAND), key=lambda r: HAND.index(r['source']), reverse=True):
        out[row['performer']] = row['labels']
    return out


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'import':
        labels = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
        for name, lab in labels.items():
            save(name, sys.argv[3], lab)
        print(f"{len(labels)} profiles from {sys.argv[2]} saved as '{sys.argv[3]}' in {DB_PATH}")
    elif sys.argv[1:] == ['list']:
        for r in profiles():
            print(f"{r['performer']:<20} {r['source']:<7} {len(r['labels']):2d} fields  {r['model'] or ''}")
    else:
        print(__doc__)
