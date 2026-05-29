#!/usr/bin/env python3
"""
Rewrites workflowHistory userId from Jonas to current ownerId
(same as Brynn Fogerty test: account/get → account/update).

Usage:
  python3 scripts/fix-leaderboard-history.py --dry-run
  python3 scripts/fix-leaderboard-history.py --live
  python3 scripts/fix-leaderboard-history.py --live --closed-only
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

JONAS_ID = "U.a19_7hSDbg"
DEFAULT_CSV = Path(__file__).resolve().parent.parent / "Jonas Lim Accounts - jonas-lim-accounts.script.csv.csv"
ENV_PATH = Path(__file__).resolve().parent.parent / ".env.local"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip("'\"")
    return env


def load_candidates(csv_path: Path, closed_only: bool, closed_stage_id: str) -> list[dict]:
    rows: list[dict] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            owner_id = (row.get("ownerId") or "").strip()
            account_id = (row.get("accountId") or "").strip()
            if not account_id or not owner_id or owner_id == JONAS_ID:
                continue
            try:
                snap = json.loads(row.get("snapshot") or "{}")
                wh = snap.get("workflowHistory") or []
            except json.JSONDecodeError:
                continue
            if not any(h.get("userId") == JONAS_ID for h in wh):
                continue
            stage_id = (row.get("workflowStageId") or "").strip()
            if closed_only and closed_stage_id and stage_id != closed_stage_id:
                continue
            name = f"{row.get('residentFirstName', '').strip()} {row.get('residentLastName', '').strip()}".strip()
            rows.append(
                {
                    "accountId": account_id,
                    "csvOwnerId": owner_id,
                    "workflowStageId": stage_id,
                    "name": name,
                    "line1": (row.get("line1") or "").strip(),
                }
            )
    return rows


def terros_ok(text: str) -> bool:
    try:
        return json.loads(text).get("type") != "error"
    except json.JSONDecodeError:
        return True


def terros_post(base: str, key: str, path: str, body: dict) -> tuple[bool, int, str]:
    url = f"{base}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Authorization": f"ApiKey {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            text = res.read().decode("utf-8")
            return terros_ok(text), res.status, text
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        return False, e.code, text


def rewrite_history(history: list[dict], target_owner: str) -> list[dict]:
    out = []
    for entry in history:
        e = dict(entry)
        if e.get("userId") == JONAS_ID:
            e["userId"] = target_owner
        out.append(e)
    return out


def needs_fix(history: list[dict]) -> bool:
    return any(h.get("userId") == JONAS_ID for h in history)


def process_account(base: str, key: str, row: dict, live: bool) -> dict:
    account_id = row["accountId"]
    label = f"{account_id} ({row['name'] or row['line1']})"

    ok, status, text = terros_post(base, key, "/account/get", {"accountId": account_id})
    if status == 404 or not ok:
        reason = "not found" if status == 404 else f"get failed ({status})"
        print(f"SKIP  {label} — {reason}")
        return {"accountId": account_id, "name": row["name"], "status": "skipped", "reason": reason}

    try:
        account = json.loads(text).get("account") or {}
    except json.JSONDecodeError:
        print(f"FAIL  {label} — invalid get response")
        return {"accountId": account_id, "name": row["name"], "status": "failed", "reason": "invalid get response"}

    live_owner = str(account.get("ownerId") or row["csvOwnerId"]).strip()
    live_stage = str(account.get("workflowStageId") or row["workflowStageId"]).strip()
    live_history = account.get("workflowHistory") or []

    if not live_owner or live_owner == JONAS_ID:
        print(f"SKIP  {label} — no valid live ownerId")
        return {
            "accountId": account_id,
            "name": row["name"],
            "status": "skipped",
            "reason": "no valid live ownerId",
        }

    if not needs_fix(live_history):
        print(f"SKIP  {label} — already fixed")
        return {
            "accountId": account_id,
            "name": row["name"],
            "status": "skipped",
            "reason": "already fixed",
            "ownerId": live_owner,
        }

    new_history = rewrite_history(live_history, live_owner)

    if not live:
        print(f"DRY   {label} → owner {live_owner}, {len(live_history)} history entries")
        return {
            "accountId": account_id,
            "name": row["name"],
            "status": "updated",
            "reason": "would update",
            "ownerId": live_owner,
        }

    ok, status, text = terros_post(
        base,
        key,
        "/account/update",
        {
            "account": {
                "accountId": account_id,
                "id": account_id,
                "ownerId": live_owner,
                "workflowStageId": live_stage,
                "workflowHistory": new_history,
            }
        },
    )

    if ok:
        print(f"OK    {label} → {live_owner}")
        return {"accountId": account_id, "name": row["name"], "status": "updated", "ownerId": live_owner}

    preview = text[:120].replace("\n", " ")
    print(f"FAIL  {label} — update {status}: {preview}")
    return {
        "accountId": account_id,
        "name": row["name"],
        "status": "failed",
        "reason": f"update failed ({status})",
        "ownerId": live_owner,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Apply updates (default: dry-run)")
    parser.add_argument("--closed-only", action="store_true", help="Only accounts at Closed stage in CSV")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--concurrency", type=int, default=5)
    args = parser.parse_args()

    env = load_env(ENV_PATH)
    base = env.get("TERROS_API_BASE_URL", "https://api.terros.com").rstrip("/")
    key = env.get("TERROS_API_KEY", "")
    closed_stage = env.get("TERROS_WORKFLOW_CLOSED_STAGE_ID", "")

    if not key:
        print("TERROS_API_KEY missing in .env.local", file=sys.stderr)
        sys.exit(1)
    if not args.csv.exists():
        print(f"CSV not found: {args.csv}", file=sys.stderr)
        sys.exit(1)

    rows = load_candidates(args.csv, args.closed_only, closed_stage)
    mode = "LIVE" if args.live else "DRY RUN"
    print(f"Mode: {mode}")
    print(f"CSV: {args.csv}")
    print(f"Candidates: {len(rows)}{' (closed only)' if args.closed_only else ''}")
    print()

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(process_account, base, key, row, args.live): row for row in rows}
        for fut in as_completed(futures):
            results.append(fut.result())

    summary = {
        "updated": sum(1 for r in results if r["status"] == "updated"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "total": len(rows),
    }

    out = args.csv.parent / f"leaderboard-fix-results-{int(time.time())}.json"
    out.write_text(json.dumps({"summary": summary, "results": results}, indent=2))

    print()
    print("Summary:", summary)
    print("Results:", out)


if __name__ == "__main__":
    main()
