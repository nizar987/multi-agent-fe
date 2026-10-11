#!/usr/bin/env python3
"""
migration/migrate_sqlite_to_postgres.py

Migrates data from the existing SQLite database (lib/db.ts schema) to
the new PostgreSQL database managed by Alembic.

Usage:
    python migrate_sqlite_to_postgres.py \
        --sqlite  /path/to/data/app.db \
        --pg-url  postgresql://agentplatform:changeme@localhost:5432/agentplatform \
        [--dry-run]

Features:
    - Idempotent: uses ON CONFLICT DO NOTHING, safe to re-run
    - --dry-run: reads SQLite and prints row counts, writes nothing to Postgres
    - Row-count verification after each table
    - Backs up SQLite before starting (copies to .bak file)
"""
import argparse
import shutil
import sqlite3
import sys
from pathlib import Path
from datetime import datetime, timezone

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)


# ── helpers ────────────────────────────────────────────────────────────────────

def ts_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def fix_ts(val: str | None) -> str | None:
    """Convert SQLite datetime string to ISO-8601 with UTC timezone."""
    if val is None:
        return None
    # SQLite stores 'YYYY-MM-DD HH:MM:SS' without timezone
    if "T" not in val and " " in val:
        val = val.replace(" ", "T")
    if not val.endswith("Z") and "+" not in val:
        val += "+00:00"
    return val


def parse_bool(val) -> bool:
    if isinstance(val, bool):
        return val
    return bool(val)


# ── table migrators ────────────────────────────────────────────────────────────

def migrate_agents(sc: sqlite3.Cursor, pg, dry_run: bool) -> int:
    sc.execute("SELECT id,name,description,system_prompt,model_override,tools,skill_ids,"
               "avatar,color,shell_auto,category,created_at,updated_at FROM agents")
    rows = sc.fetchall()
    if dry_run:
        print(f"  agents: {len(rows)} rows (dry-run)")
        return len(rows)
    with pg.cursor() as pc:
        psycopg2.extras.execute_values(
            pc,
            """
            INSERT INTO agents
              (id,name,description,system_prompt,model_override,tools,skill_ids,
               avatar,color,shell_auto,category,created_at,updated_at)
            VALUES %s
            ON CONFLICT (id) DO NOTHING
            """,
            [
                (
                    r[0], r[1], r[2] or "", r[3] or "", r[4],
                    psycopg2.extras.Json(__import__("json").loads(r[5] or "[]")),
                    psycopg2.extras.Json(__import__("json").loads(r[6] or "[]")),
                    r[7] or "🤖", r[8] or "#c15f3c",
                    parse_bool(r[9]), r[10] or "",
                    fix_ts(r[11]) or ts_now(),
                    fix_ts(r[12]) or ts_now(),
                )
                for r in rows
            ],
        )
    pg.commit()
    print(f"  agents: inserted up to {len(rows)} rows")
    return len(rows)


def migrate_skills(sc: sqlite3.Cursor, pg, dry_run: bool) -> int:
    sc.execute("SELECT id,name,description,content,created_at FROM skills")
    rows = sc.fetchall()
    if dry_run:
        print(f"  skills: {len(rows)} rows (dry-run)")
        return len(rows)
    with pg.cursor() as pc:
        psycopg2.extras.execute_values(
            pc,
            """
            INSERT INTO skills (id,name,description,content,created_at)
            VALUES %s ON CONFLICT (id) DO NOTHING
            """,
            [(r[0], r[1], r[2] or "", r[3], fix_ts(r[4]) or ts_now()) for r in rows],
        )
    pg.commit()
    print(f"  skills: inserted up to {len(rows)} rows")
    return len(rows)


def migrate_knowledge(sc: sqlite3.Cursor, pg, dry_run: bool) -> int:
    sc.execute("SELECT id,title,content,agent_id,created_at FROM knowledge")
    rows = sc.fetchall()
    if dry_run:
        print(f"  knowledge: {len(rows)} rows (dry-run)")
        return len(rows)
    with pg.cursor() as pc:
        psycopg2.extras.execute_values(
            pc,
            """
            INSERT INTO knowledge (id,title,content,agent_id,created_at)
            VALUES %s ON CONFLICT (id) DO NOTHING
            """,
            [(r[0], r[1], r[2], r[3], fix_ts(r[4]) or ts_now()) for r in rows],
        )
    pg.commit()
    print(f"  knowledge: inserted up to {len(rows)} rows")
    return len(rows)


def migrate_app_meta(sc: sqlite3.Cursor, pg, dry_run: bool) -> int:
    sc.execute("SELECT key,value FROM app_meta")
    rows = sc.fetchall()
    if dry_run:
        print(f"  app_meta: {len(rows)} rows (dry-run)")
        return len(rows)
    with pg.cursor() as pc:
        psycopg2.extras.execute_values(
            pc,
            """
            INSERT INTO app_meta (key,value)
            VALUES %s ON CONFLICT (key) DO UPDATE SET value = excluded.value
            """,
            list(rows),
        )
    pg.commit()
    print(f"  app_meta: inserted/updated {len(rows)} rows")
    return len(rows)


def migrate_token_usage(sc: sqlite3.Cursor, pg, dry_run: bool) -> int:
    sc.execute("SELECT id,at,provider,model,source,input_tokens,output_tokens FROM token_usage")
    rows = sc.fetchall()
    if dry_run:
        print(f"  token_usage: {len(rows)} rows (dry-run)")
        return len(rows)
    with pg.cursor() as pc:
        psycopg2.extras.execute_values(
            pc,
            """
            INSERT INTO token_usage (id,at,provider,model,source,input_tokens,output_tokens)
            VALUES %s ON CONFLICT (id) DO NOTHING
            """,
            [(r[0], fix_ts(r[1]) or ts_now(), r[2], r[3], r[4], r[5], r[6]) for r in rows],
        )
    pg.commit()
    print(f"  token_usage: inserted up to {len(rows)} rows")
    return len(rows)


# ── verification ───────────────────────────────────────────────────────────────

def verify_counts(sc: sqlite3.Cursor, pg, tables: list[str]) -> bool:
    print("\nVerification:")
    ok = True
    for table in tables:
        sc.execute(f"SELECT COUNT(*) FROM {table}")
        sqlite_count = sc.fetchone()[0]
        with pg.cursor() as pc:
            pc.execute(f"SELECT COUNT(*) FROM {table}")
            pg_count = pc.fetchone()[0]
        match = "✓" if pg_count >= sqlite_count else "✗"
        print(f"  {match} {table}: sqlite={sqlite_count}, postgres={pg_count}")
        if pg_count < sqlite_count:
            ok = False
    return ok


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Migrate SQLite → PostgreSQL")
    parser.add_argument("--sqlite",  required=True, help="Path to app.db")
    parser.add_argument("--pg-url",  required=True, help="PostgreSQL connection URL")
    parser.add_argument("--dry-run", action="store_true", help="Read-only, no writes")
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite)
    if not sqlite_path.exists():
        print(f"SQLite file not found: {sqlite_path}")
        sys.exit(1)

    # Backup SQLite before migration
    if not args.dry_run:
        backup = sqlite_path.with_suffix(".db.bak")
        shutil.copy2(sqlite_path, backup)
        print(f"SQLite backup saved → {backup}")

    print(f"\nConnecting to SQLite: {sqlite_path}")
    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sc = sqlite_conn.cursor()

    if not args.dry_run:
        print(f"Connecting to PostgreSQL...")
        pg = psycopg2.connect(args.pg_url)
    else:
        pg = None

    print("\nMigrating tables:")
    tables = ["agents", "skills", "knowledge", "app_meta", "token_usage"]
    counts = {}

    counts["agents"]      = migrate_agents(sc, pg, args.dry_run)
    counts["skills"]      = migrate_skills(sc, pg, args.dry_run)
    counts["knowledge"]   = migrate_knowledge(sc, pg, args.dry_run)
    counts["app_meta"]    = migrate_app_meta(sc, pg, args.dry_run)
    counts["token_usage"] = migrate_token_usage(sc, pg, args.dry_run)

    if not args.dry_run and pg:
        verify_counts(sc, pg, tables)
        pg.close()

    sqlite_conn.close()

    total = sum(counts.values())
    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Migration complete. Total rows processed: {total}")


if __name__ == "__main__":
    main()
