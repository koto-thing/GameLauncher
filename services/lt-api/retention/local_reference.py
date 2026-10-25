"""架空DB用の呼出し参照実装。本番接続・CLI・定期実行機能を持たない"""
import calendar
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).parent
PROTECTED = {'users', 'platform_roles', 'operator_admissions', 'd1_migrations'}


def calendar_expiry(terminal_ms):
    """日本時間の同日時を3か月進め、存在しない日は月末に丸める"""
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    local = (epoch + timedelta(milliseconds=terminal_ms)).astimezone(timezone(timedelta(hours=9)))
    month = local.year * 12 + local.month - 1 + 3
    year, month = divmod(month, 12)
    month += 1
    expiry = local.replace(year=year, month=month, day=min(local.day, calendar.monthrange(year, month)[1]))
    delta = expiry - epoch
    return delta.days * 86400000 + delta.seconds * 1000 + delta.microseconds // 1000


def validate_inventory(db):
    """未知テーブル/列/型を検知した場合、削除前に停止する"""
    expected = json.loads((ROOT / 'schema-inventory.json').read_text())
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    if 'lt_archive_markers' in tables:
        expected['lt_archive_markers'] = [['talk_id','TEXT'],['event_id','TEXT'],['snapshot_json','TEXT']]
    if tables - set(expected) - PROTECTED or set(expected) - tables:
        raise ValueError('Retention table inventory requires review')
    handlers = (ROOT / "delete-event.sql").read_text(encoding="utf-8-sig") + (ROOT / "delete-expired-orphan-auth.sql").read_text(encoding="utf-8-sig")
    handlers += (ROOT / "prepare-archive-proposal.sql").read_text(encoding="utf-8-sig")
    handlers += (ROOT / "delete-expired-rate.sql").read_text(encoding="utf-8-sig")
    handled = set(re.findall(r"(?:DELETE FROM|UPDATE)\s+(lt_\w+)", handlers))
    if set(expected) - handled:
        raise ValueError("Retention handler registration requires review")
    for table, columns in expected.items():
        actual = [list(row)[1:3] for row in db.execute('PRAGMA table_info(' + table + ')')]
        if actual != columns:
            raise ValueError('Retention column inventory requires review: ' + table)


def statements(path):
    """独立SQLは単純なDMLのみとし、一文ずつ同じtransactionへ渡す"""
    sql = '\n'.join(line for line in path.read_text(encoding='utf-8-sig').splitlines() if not line.lstrip().startswith('--'))
    return [statement.strip() for statement in sql.split(';') if statement.strip()]


def sweep_fixture(db, anchors, now_ms, *, dry_run=True, inject_failure_after=None):
    """確定済み不変anchorを受け取る専用DBテスト用処理。既定はdry-run"""
    if db.in_transaction:
        raise ValueError('Caller transaction must not be open')
    db.execute('BEGIN IMMEDIATE')
    try:
        validate_inventory(db)
        for name in ['retention_due', 'retention_apps', 'retention_outbox']:
            db.execute('DROP TABLE IF EXISTS temp.' + name)
        db.execute('CREATE TEMP TABLE retention_due(event_id TEXT PRIMARY KEY,kind TEXT NOT NULL)')
        # アンカー取得と検証も同じtransactionで実施するのが呼出側の契約
        for event_id, kind, terminal_ms, expiry_ms in anchors():
            if kind not in ('ended', 'cancelled') or expiry_ms != calendar_expiry(terminal_ms):
                raise ValueError('Unconfirmed retention anchor')
            row = db.execute('SELECT state,private_expires FROM lt_events WHERE id=?', (event_id,)).fetchone()
            if row is None or row != (kind, expiry_ms):
                raise ValueError('Anchor differs from fixed event state/expiry')
            if expiry_ms <= now_ms:
                db.execute('INSERT INTO retention_due VALUES(?,?)', (event_id, kind))
        db.execute('CREATE TEMP TABLE retention_apps AS SELECT id,email FROM lt_applications WHERE event_id IN (SELECT event_id FROM retention_due)')
        db.execute('CREATE TEMP TABLE retention_outbox AS SELECT id FROM lt_outbox WHERE application_id IN (SELECT id FROM retention_apps)')
        counts = dict(db.execute("SELECT 'events',count(*) FROM retention_due UNION ALL SELECT 'applications',count(*) FROM retention_apps"))
        if dry_run:
            db.rollback()
            return counts
        commands = statements(ROOT / 'prepare-archive-proposal.sql') + statements(ROOT / 'delete-event.sql') + statements(ROOT / 'delete-expired-orphan-auth.sql') + statements(ROOT / 'delete-expired-rate.sql')
        for index, statement in enumerate(commands):
            db.execute(statement, {'now_ms': now_ms})
            if index == inject_failure_after:
                raise RuntimeError('Injected deletion failure')
        db.commit()
        return counts
    except BaseException:
        db.rollback()
        raise


def clean_auth_fixture(db, now_ms):
    """開催回削除と独立した期限切れ情報ジョブのローカル参照処理"""
    if db.in_transaction:
        raise ValueError('Caller transaction must not be open')
    db.execute('BEGIN IMMEDIATE')
    try:
        validate_inventory(db)
        for path in ['delete-expired-orphan-auth.sql', 'delete-expired-rate.sql']:
            for statement in statements(ROOT / path):
                db.execute(statement, {'now_ms': now_ms})
        db.commit()
    except BaseException:
        db.rollback()
        raise
