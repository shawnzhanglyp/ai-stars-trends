#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "ai_trends.json"
DEFAULT_QUERIES = [
    "topic:artificial-intelligence stars:>50 archived:false fork:false",
    "topic:machine-learning stars:>50 archived:false fork:false",
    "topic:deep-learning stars:>50 archived:false fork:false",
    "topic:llm stars:>50 archived:false fork:false",
    "topic:generative-ai stars:>50 archived:false fork:false",
    "topic:ai-agent stars:>50 archived:false fork:false",
    "topic:rag stars:>50 archived:false fork:false",
    "topic:stable-diffusion stars:>50 archived:false fork:false",
    "large-language-model in:name,description,readme stars:>50 archived:false fork:false",
    "chatgpt in:name,description,readme stars:>50 archived:false fork:false",
]


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def github_token():
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        return token

    config_path = ROOT / "config.local.js"
    if not config_path.exists():
        return ""

    match = re.search(r"token\s*:\s*['\"]([^'\"]+)['\"]", config_path.read_text(encoding="utf-8"))
    return match.group(1).strip() if match else ""


def request_json(url, token):
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "github-ai-stars-trend-collector",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=40) as response:
            remaining = response.headers.get("x-ratelimit-remaining")
            reset = response.headers.get("x-ratelimit-reset")
            payload = json.loads(response.read().decode("utf-8"))
            return payload, remaining, reset
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API {error.code}: {body[:300]}") from error


def search_repositories(query, sort, per_page, token):
    params = {
        "q": query,
        "order": "desc",
        "per_page": str(per_page),
    }
    if sort:
        params["sort"] = sort
    url = f"https://api.github.com/search/repositories?{urlencode(params)}"
    payload, remaining, reset = request_json(url, token)
    maybe_wait_for_rate_limit(remaining, reset)
    return payload.get("items", [])


def fetch_repository(full_name, token):
    owner, repo = full_name.split("/", 1)
    url = f"https://api.github.com/repos/{owner}/{repo}"
    payload, remaining, reset = request_json(url, token)
    maybe_wait_for_rate_limit(remaining, reset)
    return payload


def maybe_wait_for_rate_limit(remaining, reset):
    try:
        remaining_count = int(remaining)
        reset_at = int(reset or "0")
    except ValueError:
        return
    if remaining_count > 2:
        return
    wait_seconds = max(0, reset_at - int(time.time()) + 2)
    if wait_seconds:
        print(f"Rate limit is low; waiting {wait_seconds}s", file=sys.stderr)
        time.sleep(wait_seconds)


def discovery_phases(reference):
    active_since = (reference - timedelta(days=14)).date().isoformat()
    new_since = (reference - timedelta(days=30)).date().isoformat()
    return [
        {"sort": "updated", "qualifier": f"pushed:>={active_since}", "weight": 24},
        {"sort": "stars", "qualifier": f"created:>={new_since}", "weight": 32},
        {"sort": "stars", "qualifier": "", "weight": 14},
        {"sort": "updated", "qualifier": "", "weight": 8},
    ]


def build_search_query(query, phase):
    qualifier = phase["qualifier"]
    if qualifier and f"{qualifier.split(':', 1)[0]}:" not in query:
        return f"{query} {qualifier}"
    return query


def age_days(value, reference):
    if not value:
        return math.inf
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return math.inf
    return max(0, (reference - parsed).total_seconds() / 86400)


def score_item(item, phase, reference):
    stars = int(item.get("stargazers_count") or 0)
    updated_days = age_days(item.get("pushed_at") or item.get("updated_at"), reference)
    created_days = age_days(item.get("created_at"), reference)
    update_boost = 28 if updated_days <= 3 else 18 if updated_days <= 14 else 8 if updated_days <= 60 else 0
    new_boost = 34 if created_days <= 30 else 16 if created_days <= 120 else 6 if created_days <= 365 else 0
    return math.log10(stars + 1) * 18 + update_boost + new_boost + phase["weight"]


def discover_candidates(queries, token, candidate_limit, max_search_requests, reference):
    candidates = {}
    per_page = max(16, min(50, math.ceil(candidate_limit / max(1, min(len(queries), 10))) + 12))
    request_count = 0

    for phase in discovery_phases(reference):
        for query in queries:
            if request_count >= max_search_requests:
                return rank_candidates(candidates)[:candidate_limit]
            search_query = build_search_query(query, phase)
            print(f"Search: {search_query} sort={phase['sort'] or 'best-match'}")
            items = search_repositories(search_query, phase["sort"], per_page, token)
            request_count += 1

            for item in items:
                full_name = item.get("full_name")
                if not full_name or item.get("fork") or item.get("archived"):
                    continue
                key = full_name.lower()
                score = score_item(item, phase, reference)
                if key not in candidates or score > candidates[key]["score"]:
                    candidates[key] = {"full_name": full_name, "score": score, "stars": item.get("stargazers_count") or 0}

    return rank_candidates(candidates)[:candidate_limit]


def rank_candidates(candidates):
    return [
        item["full_name"]
        for item in sorted(candidates.values(), key=lambda item: (item["score"], item["stars"]), reverse=True)
    ]


def load_data(path):
    if not path.exists():
        return {"version": 1, "repos": []}
    return json.loads(path.read_text(encoding="utf-8"))


def repo_index(data):
    index = {}
    for repo in data.get("repos", []):
        full_name = repo.get("full_name") or repo.get("name")
        if full_name:
            index[full_name.lower()] = repo
    return index


def update_snapshot(repo, metadata, observed_at, observed_date, max_snapshots):
    repo["full_name"] = metadata["full_name"]
    repo["url"] = metadata.get("html_url") or f"https://github.com/{metadata['full_name']}"
    repo["description"] = metadata.get("description") or ""
    repo["language"] = metadata.get("language") or ""
    repo["topics"] = metadata.get("topics") or []
    repo["archived"] = bool(metadata.get("archived"))
    repo["fork"] = bool(metadata.get("fork"))
    repo["latest_stars"] = int(metadata.get("stargazers_count") or 0)
    repo["latest_observed_at"] = observed_at

    snapshots = repo.setdefault("snapshots", [])
    snapshot = {
        "date": observed_date,
        "observed_at": observed_at,
        "stars": repo["latest_stars"],
    }

    for index, existing in enumerate(snapshots):
        if existing.get("date") == observed_date:
            snapshots[index] = snapshot
            break
    else:
        snapshots.append(snapshot)

    snapshots.sort(key=lambda item: item.get("observed_at") or item.get("date") or "")
    del snapshots[:-max_snapshots]


def main():
    parser = argparse.ArgumentParser(description="Collect GitHub AI project stars snapshots.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--candidate-limit", type=int, default=200)
    parser.add_argument("--max-search-requests", type=int, default=48)
    parser.add_argument("--max-tracked", type=int, default=500)
    parser.add_argument("--max-snapshots", type=int, default=400)
    parser.add_argument("--query", action="append", dest="queries")
    args = parser.parse_args()

    token = github_token()
    if not token:
        raise SystemExit("Missing token. Set GITHUB_TOKEN or config.local.js token.")

    reference = now_utc()
    observed_at = iso(reference)
    observed_date = reference.date().isoformat()
    output = Path(args.output)
    data = load_data(output)
    existing = repo_index(data)
    queries = args.queries or DEFAULT_QUERIES

    discovered = discover_candidates(
        queries=queries,
        token=token,
        candidate_limit=args.candidate_limit,
        max_search_requests=args.max_search_requests,
        reference=reference,
    )
    tracked = list(dict.fromkeys(discovered + [repo.get("full_name") for repo in data.get("repos", []) if repo.get("full_name")]))
    tracked = tracked[: args.max_tracked]

    print(f"Updating {len(tracked)} repositories")
    updated_repos = {}
    for number, full_name in enumerate(tracked, start=1):
        try:
            metadata = fetch_repository(full_name, token)
        except Exception as error:
            print(f"[{number}/{len(tracked)}] skip {full_name}: {error}", file=sys.stderr)
            continue
        if metadata.get("fork") or metadata.get("archived"):
            continue
        repo = existing.get(metadata["full_name"].lower(), {})
        update_snapshot(repo, metadata, observed_at, observed_date, args.max_snapshots)
        updated_repos[metadata["full_name"].lower()] = repo
        print(f"[{number}/{len(tracked)}] {metadata['full_name']} {repo['latest_stars']}")

    data["version"] = 1
    data["updated_at"] = observed_at
    data["latest_observed_at"] = observed_at
    data["queries"] = queries
    data["repos"] = sorted(updated_repos.values(), key=lambda repo: repo.get("latest_stars", 0), reverse=True)

    output.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output.with_suffix(".tmp")
    temp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(output)
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
