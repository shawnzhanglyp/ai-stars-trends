(() => {
  const DAY = 24 * 60 * 60 * 1000;
  const PER_PAGE = 100;
  const REST_MAX_PAGE = 400;
  const DEFAULT_SOURCE = "ai";
  const DEFAULT_AI_SEARCH_QUERIES = [
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
  ];
  const DEFAULT_REPOS = [
    "openai/openai-python",
    "huggingface/transformers",
    "langchain-ai/langchain",
    "microsoft/autogen",
    "ollama/ollama",
    "ggerganov/llama.cpp",
    "vllm-project/vllm",
    "comfyanonymous/ComfyUI",
  ];
  const LEGACY_DEFAULT_REPOS = [
    "facebook/react",
    "vercel/next.js",
    "vitejs/vite",
    "vuejs/core",
    "sveltejs/svelte",
    "angular/angular",
    "denoland/deno",
    "nodejs/node",
  ];

  const PERIODS = {
    day: { days: 1, bins: 24, label: "近 24 小时" },
    week: { days: 7, bins: 7, label: "近 7 天" },
    month: { days: 30, bins: 10, label: "近 30 天" },
  };

  const AI_QUERY_STORAGE_KEY = "github-stars-trend-ai-queries";
  const SOURCE_STORAGE_KEY = "github-stars-trend-source";
  const CUSTOM_REPO_STORAGE_KEY = "github-stars-trend-repos";
  const TOKEN_KEY = "github-stars-trend-token";
  const CONFIG = window.GITHUB_STARS_CONFIG || {};
  const SNAPSHOT_DATA_URL = CONFIG.snapshotDataUrl || "./data/ai_trends.json";

  const els = {
    sourceSelect: document.querySelector("#source-select"),
    repoInput: document.querySelector("#repo-input"),
    queryLabel: document.querySelector("#query-label"),
    queryHelp: document.querySelector("#query-help"),
    tokenInput: document.querySelector("#token-input"),
    sortSelect: document.querySelector("#sort-select"),
    candidateLimit: document.querySelector("#candidate-limit"),
    pageLimit: document.querySelector("#page-limit"),
    scanButton: document.querySelector("#scan-button"),
    exportButton: document.querySelector("#export-button"),
    periodButtons: [...document.querySelectorAll("[data-period]")],
    resultsBody: document.querySelector("#results-body"),
    statusText: document.querySelector("#status-text"),
    fastestName: document.querySelector("#fastest-name"),
    fastestValue: document.querySelector("#fastest-value"),
    periodTotal: document.querySelector("#period-total"),
    periodLabel: document.querySelector("#period-label"),
    accelName: document.querySelector("#accel-name"),
    accelValue: document.querySelector("#accel-value"),
    rateValue: document.querySelector("#rate-value"),
    rateReset: document.querySelector("#rate-reset"),
    lastUpdated: document.querySelector("#last-updated"),
    currentPeriodHeading: document.querySelector("#current-period-heading"),
  };

  const numberFmt = new Intl.NumberFormat("zh-CN");
  const compactFmt = new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const decimalFmt = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 1,
  });
  const percentFmt = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  });

  const state = {
    period: "day",
    results: [],
    controller: null,
    isRunning: false,
    scanId: 0,
    rate: null,
    snapshotData: null,
    snapshotLoadPromise: null,
  };

  function init() {
    const configSource = CONFIG.source === "custom" ? "custom" : DEFAULT_SOURCE;
    const source = localStorage.getItem(SOURCE_STORAGE_KEY) || configSource;
    els.sourceSelect.value = source === "custom" ? "custom" : "ai";
    loadInputForSource();

    const configToken = typeof CONFIG.token === "string" ? CONFIG.token.trim() : "";
    els.tokenInput.value = sessionStorage.getItem(TOKEN_KEY) || configToken;
    els.tokenInput.placeholder = "ghp_... 或 github_pat_...";
    els.candidateLimit.value = String(clamp(Number(CONFIG.candidateLimit) || 80, 10, 200));

    els.repoInput.addEventListener("input", () => {
      localStorage.setItem(getInputStorageKey(), els.repoInput.value);
    });

    els.tokenInput.addEventListener("input", () => {
      sessionStorage.setItem(TOKEN_KEY, els.tokenInput.value.trim());
    });

    els.sourceSelect.addEventListener("change", () => {
      localStorage.setItem(SOURCE_STORAGE_KEY, els.sourceSelect.value);
      loadInputForSource();
      renderResults();
    });

    els.sortSelect.addEventListener("change", renderResults);
    els.exportButton.addEventListener("click", exportCsv);
    els.scanButton.addEventListener("click", () => {
      if (state.isRunning) {
        state.controller?.abort();
        setStatus("已停止");
        return;
      }
      startScan();
    });

    els.periodButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const nextPeriod = button.dataset.period;
        if (!PERIODS[nextPeriod] || nextPeriod === state.period) return;
        state.period = nextPeriod;
        renderPeriodButtons();
        startScan();
      });
    });

    renderPeriodButtons();
    renderResults();
    startScan();
  }

  function renderPeriodButtons() {
    const period = PERIODS[state.period];
    els.periodLabel.textContent = period.label;
    els.currentPeriodHeading.textContent = `${period.label}新增`;

    els.periodButtons.forEach((button) => {
      const isActive = button.dataset.period === state.period;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });
  }

  async function startScan() {
    if (state.isRunning) {
      state.controller?.abort();
    }

    const token = els.tokenInput.value.trim();
    const pageLimit = clamp(Number.parseInt(els.pageLimit.value, 10) || 20, 1, 100);
    const candidateLimit = clamp(Number.parseInt(els.candidateLimit.value, 10) || 80, 10, 200);
    const scanId = Date.now();
    const controller = new AbortController();
    state.scanId = scanId;
    state.controller = controller;
    state.isRunning = true;
    state.results = [];

    setRunning(true);
    setStatus(getSource() === "ai" ? "正在发现 AI 项目" : "正在准备项目列表");
    renderResults();

    let repos = [];
    try {
      if (getSource() === "ai") {
        const snapshotResults = await getSnapshotResults(candidateLimit);
        if (snapshotResults.length) {
          state.results = snapshotResults;
          state.isRunning = false;
          setRunning(false);
          renderResults();
          const latest = state.snapshotData?.latest_observed_at || state.snapshotData?.updated_at || "";
          els.lastUpdated.textContent = latest
            ? `快照于 ${new Date(latest).toLocaleString("zh-CN", { hour12: false })}`
            : "已读取本地快照";
          setStatus(`本地快照 ${snapshotResults.length} 个项目`);
          return;
        }

        const queries = parseSearchQueries(els.repoInput.value);
        if (!queries.length) {
          finishScanEarly(scanId, "没有 AI 搜索条件");
          return;
        }
        repos = await discoverAiRepos({
          queries,
          token,
          candidateLimit,
          signal: controller.signal,
        });
      } else {
        repos = parseRepos(els.repoInput.value);
      }
    } catch (error) {
      finishScanEarly(scanId, controller.signal.aborted ? "已停止" : normalizeError(error));
      return;
    }

    if (!repos.length) {
      state.results = [];
      finishScanEarly(scanId, getSource() === "ai" ? "没有发现 AI 项目" : "没有项目");
      return;
    }

    state.results = repos.map((repoName) => ({ name: repoName, loading: true }));
    setStatus(`发现 ${repos.length} 个候选，0/${repos.length} 已完成`);
    renderResults();

    let cursor = 0;
    let completed = 0;
    const concurrency = Math.min(4, repos.length);

    async function worker() {
      while (cursor < repos.length && !controller.signal.aborted) {
        const index = cursor;
        cursor += 1;
        const repoName = repos[index];

        try {
          const result = await analyzeRepo(repoName, {
            token,
            periodKey: state.period,
            pageLimit,
            signal: controller.signal,
          });
          if (state.scanId !== scanId) return;
          state.results[index] = result;
        } catch (error) {
          if (controller.signal.aborted) return;
          if (state.scanId !== scanId) return;
          state.results[index] = {
            name: repoName,
            error: normalizeError(error),
          };
        }

        completed += 1;
        if (state.scanId === scanId) {
          setStatus(`${completed}/${repos.length} 已完成`);
          renderResults();
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      if (state.scanId === scanId) {
        state.isRunning = false;
        setRunning(false);
        renderResults();
        if (controller.signal.aborted) {
          setStatus("已停止");
        } else {
          const time = new Date();
          els.lastUpdated.textContent = `刷新于 ${time.toLocaleString("zh-CN", {
            hour12: false,
          })}`;
          setStatus(`${completed}/${repos.length} 已完成`);
        }
      }
    }
  }

  function finishScanEarly(scanId, status) {
    if (state.scanId !== scanId) return;
    state.isRunning = false;
    setRunning(false);
    renderResults();
    setStatus(status);
  }

  function loadInputForSource() {
    if (getSource() === "ai") {
      const defaultQueries = getConfigList(CONFIG.aiQueries, DEFAULT_AI_SEARCH_QUERIES).join("\n");
      els.repoInput.value = localStorage.getItem(AI_QUERY_STORAGE_KEY) || defaultQueries;
      els.queryLabel.textContent = "AI 搜索";
      els.queryHelp.textContent =
        "每行是一个 GitHub 搜索条件；会先发现候选项目，再按实际新增 stars 排行。";
      els.candidateLimit.disabled = false;
      return;
    }

    const savedRepos = localStorage.getItem(CUSTOM_REPO_STORAGE_KEY);
    const defaultRepoText = DEFAULT_REPOS.join("\n");
    const shouldUseDefaultRepos =
      !savedRepos || parseRepos(savedRepos).join("\n") === LEGACY_DEFAULT_REPOS.join("\n");
    els.repoInput.value = shouldUseDefaultRepos ? defaultRepoText : savedRepos;
    if (shouldUseDefaultRepos) {
      localStorage.setItem(CUSTOM_REPO_STORAGE_KEY, defaultRepoText);
    }
    els.queryLabel.textContent = "项目";
    els.queryHelp.textContent = "每行一个 GitHub 仓库，例如 openai/openai-python。";
    els.candidateLimit.disabled = true;
  }

  async function discoverAiRepos(options) {
    const { queries, token, candidateLimit, signal } = options;
    const maxSearchRequests = clamp(Number(CONFIG.maxSearchRequests) || 24, 6, 60);
    const perPage = clamp(Math.ceil(candidateLimit / Math.min(queries.length, 10)) + 12, 16, 40);
    const candidates = new Map();
    const phases = buildDiscoveryPhases(state.period);
    let requestCount = 0;

    for (const phase of phases) {
      for (const query of queries) {
        if (signal.aborted) throw new DOMException("已停止", "AbortError");
        if (requestCount >= maxSearchRequests) {
          return rankCandidates(candidates).slice(0, candidateLimit);
        }

        const url = new URL("https://api.github.com/search/repositories");
        url.searchParams.set("q", buildSearchQuery(query, phase));
        url.searchParams.set("order", "desc");
        url.searchParams.set("per_page", String(perPage));
        if (phase.sort) {
          url.searchParams.set("sort", phase.sort);
        }

        const response = await githubJson(url.toString(), {
          token,
          signal,
          accept: "application/vnd.github+json",
        });
        requestCount += 1;
        const items = Array.isArray(response.data?.items) ? response.data.items : [];

        for (const item of items) {
          const fullName = normalizeRepo(item.full_name || "");
          if (!fullName || item.fork || item.archived) continue;
          rememberCandidate(candidates, item, phase);
        }
      }
    }

    return rankCandidates(candidates).slice(0, candidateLimit);
  }

  async function getSnapshotResults(limit) {
    if (CONFIG.useSnapshots === false) return [];

    const data = await loadSnapshotData();
    const repos = Array.isArray(data?.repos) ? data.repos : [];
    if (!repos.length) return [];

    const period = PERIODS[state.period];
    const latestTime = Date.parse(data.latest_observed_at || data.updated_at || "");
    const endTime = Number.isFinite(latestTime) ? latestTime : Date.now();
    const results = repos
      .map((repo) => buildSnapshotResult(repo, period, endTime))
      .filter(Boolean)
      .sort((a, b) => b.currentStars - a.currentStars || b.acceleration - a.acceleration)
      .slice(0, limit);

    return results;
  }

  async function loadSnapshotData() {
    if (state.snapshotData) return state.snapshotData;
    if (state.snapshotLoadPromise) return state.snapshotLoadPromise;

    state.snapshotLoadPromise = fetch(`${SNAPSHOT_DATA_URL}?t=${Date.now()}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((data) => {
        state.snapshotData = data;
        return data;
      });

    return state.snapshotLoadPromise;
  }

  function buildSnapshotResult(repo, period, endTime) {
    const snapshots = normalizeSnapshots(repo.snapshots);
    if (!snapshots.length) return null;

    const latest = snapshots[snapshots.length - 1];
    const currentStart = endTime - period.days * DAY;
    const previousStart = endTime - period.days * 2 * DAY;
    if (snapshots[0].time > currentStart) return null;

    const currentBase = findSnapshotAtOrBefore(snapshots, currentStart) || snapshots[0];
    const previousBase = findSnapshotAtOrBefore(snapshots, previousStart) || snapshots[0];

    const currentStars = Math.max(0, latest.stars - currentBase.stars);
    const previousStars = Math.max(0, currentBase.stars - previousBase.stars);
    const acceleration = currentStars - previousStars;
    const changePercent =
      previousStars > 0 ? (acceleration / previousStars) * 100 : currentStars > 0 ? 100 : 0;
    const fullName = repo.full_name || repo.name;

    return {
      name: fullName,
      url: repo.url || `https://github.com/${fullName}`,
      totalStars: latest.stars,
      currentStars,
      previousStars,
      acceleration,
      changePercent,
      dailyRate: currentStars / period.days,
      bins: buildSnapshotBins(snapshots, currentStart, endTime, period.bins),
      pagesScanned: snapshots.length,
      pageRequests: 0,
      truncated: snapshots[0].time > previousStart,
      checkedAt: latest.observedAt,
    };
  }

  function normalizeSnapshots(snapshots) {
    if (!Array.isArray(snapshots)) return [];
    return snapshots
      .map((snapshot) => {
        const time = Date.parse(snapshot.observed_at || snapshot.date);
        const stars = Number(snapshot.stars);
        if (!Number.isFinite(time) || !Number.isFinite(stars)) return null;
        return {
          time,
          stars,
          observedAt: snapshot.observed_at || snapshot.date,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
  }

  function findSnapshotAtOrBefore(snapshots, time) {
    let match = null;
    for (const snapshot of snapshots) {
      if (snapshot.time > time) break;
      match = snapshot;
    }
    return match;
  }

  function buildSnapshotBins(snapshots, start, end, binCount) {
    const bins = Array.from({ length: binCount }, () => 0);
    const span = Math.max(end - start, 1);
    let previous = findSnapshotAtOrBefore(snapshots, start) || snapshots[0];

    for (const snapshot of snapshots) {
      if (snapshot.time <= start) continue;
      if (snapshot.time > end) break;
      const index = Math.min(
        binCount - 1,
        Math.max(0, Math.floor(((snapshot.time - start) / span) * binCount)),
      );
      bins[index] += Math.max(0, snapshot.stars - previous.stars);
      previous = snapshot;
    }

    return bins;
  }

  function buildDiscoveryPhases(periodKey) {
    const period = PERIODS[periodKey] || PERIODS.week;
    const activeSince = formatDate(Date.now() - Math.max(period.days * 2, 14) * DAY);
    const newSince = formatDate(Date.now() - Math.max(period.days * 3, 30) * DAY);

    return [
      { sort: "updated", qualifier: `pushed:>=${activeSince}`, weight: 24 },
      { sort: "stars", qualifier: `created:>=${newSince}`, weight: 32 },
      { sort: "stars", qualifier: "", weight: 14 },
      { sort: "updated", qualifier: "", weight: 8 },
    ];
  }

  function buildSearchQuery(query, phase) {
    const parts = [query.trim()];
    if (phase.qualifier && !query.includes(phase.qualifier.split(":")[0] + ":")) {
      parts.push(phase.qualifier);
    }
    return parts.join(" ");
  }

  function rememberCandidate(candidates, item, phase) {
    const fullName = normalizeRepo(item.full_name || "");
    const key = fullName.toLowerCase();
    const existing = candidates.get(key);
    const next = {
      fullName,
      stars: Number(item.stargazers_count) || 0,
      updatedAt: item.pushed_at || item.updated_at || "",
      createdAt: item.created_at || "",
      score: scoreCandidate(item, phase),
    };

    if (!existing || next.score > existing.score) {
      candidates.set(key, next);
    }
  }

  function scoreCandidate(item, phase) {
    const stars = Number(item.stargazers_count) || 0;
    const updatedDays = ageInDays(item.pushed_at || item.updated_at);
    const createdDays = ageInDays(item.created_at);
    const updateBoost = updatedDays <= 3 ? 28 : updatedDays <= 14 ? 18 : updatedDays <= 60 ? 8 : 0;
    const newBoost = createdDays <= 30 ? 34 : createdDays <= 120 ? 16 : createdDays <= 365 ? 6 : 0;

    return Math.log10(stars + 1) * 18 + updateBoost + newBoost + phase.weight;
  }

  function rankCandidates(candidates) {
    return [...candidates.values()]
      .sort((a, b) => b.score - a.score || b.stars - a.stars)
      .map((candidate) => candidate.fullName);
  }

  function ageInDays(value) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
    return (Date.now() - time) / DAY;
  }

  function formatDate(time) {
    return new Date(time).toISOString().slice(0, 10);
  }

  async function analyzeRepo(repoName, options) {
    if (options.token) {
      return analyzeRepoWithGraphql(repoName, options);
    }

    return analyzeRepoWithRest(repoName, options);
  }

  async function analyzeRepoWithGraphql(repoName, options) {
    const { token, periodKey, pageLimit, signal } = options;
    const [owner, repo] = repoName.split("/");
    const period = PERIODS[periodKey];
    const now = Date.now();
    const currentStart = now - period.days * DAY;
    const previousStart = now - period.days * 2 * DAY;
    const query = `
      query RepoStargazers($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          stargazers(
            first: 100,
            after: $cursor,
            orderBy: { field: STARRED_AT, direction: DESC }
          ) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              starredAt
            }
          }
        }
      }
    `;

    let cursor = null;
    let totalStars = 0;
    let currentStars = 0;
    let previousStars = 0;
    let pagesScanned = 0;
    let crossedBoundary = false;
    let hasNextPage = false;
    const timestamps = [];

    while (pagesScanned < pageLimit) {
      const data = await githubGraphql(query, {
        token,
        signal,
        variables: { owner, repo, cursor },
      });
      const stargazers = data?.repository?.stargazers;

      if (!stargazers) {
        throw new Error("未找到仓库或无权限访问");
      }

      totalStars = Number(stargazers.totalCount) || 0;
      const edges = Array.isArray(stargazers.edges) ? stargazers.edges : [];
      pagesScanned += 1;

      if (!edges.length) {
        crossedBoundary = true;
        break;
      }

      const times = edges
        .map((edge) => Date.parse(edge.starredAt))
        .filter(Number.isFinite);

      if (!times.length) {
        throw new Error("GitHub 未返回 starredAt");
      }

      for (const time of times) {
        if (time >= currentStart) {
          currentStars += 1;
          timestamps.push(time);
        } else if (time >= previousStart) {
          previousStars += 1;
        }
      }

      if (Math.min(...times) < previousStart) {
        crossedBoundary = true;
        break;
      }

      hasNextPage = Boolean(stargazers.pageInfo?.hasNextPage);
      cursor = stargazers.pageInfo?.endCursor || null;
      if (!hasNextPage || !cursor) {
        crossedBoundary = true;
        break;
      }
    }

    return buildRepoResult({
      repoName,
      totalStars,
      currentStars,
      previousStars,
      timestamps,
      period,
      currentStart,
      now,
      pagesScanned,
      pageRequests: pagesScanned,
      truncated: !crossedBoundary && hasNextPage,
    });
  }

  async function analyzeRepoWithRest(repoName, options) {
    const { token, periodKey, pageLimit, signal } = options;
    const [owner, repo] = repoName.split("/");
    const period = PERIODS[periodKey];
    const now = Date.now();
    const currentStart = now - period.days * DAY;
    const previousStart = now - period.days * 2 * DAY;

    const metadata = await githubJson(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        token,
        signal,
        accept: "application/vnd.github+json",
      },
    );

    const totalStars = Number(metadata.data.stargazers_count) || 0;
    const totalPages = Math.max(1, Math.ceil(totalStars / PER_PAGE));
    if (totalPages > REST_MAX_PAGE) {
      throw new Error(`超过 ${numberFmt.format(REST_MAX_PAGE * PER_PAGE)} stars，请填写 Token（不是账号）`);
    }

    const pageCache = new Map();
    let pageRequests = 0;

    async function getStarPage(page) {
      if (pageCache.has(page)) return pageCache.get(page);

      const response = await githubJson(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stargazers?per_page=${PER_PAGE}&page=${page}`,
        {
          token,
          signal,
          accept: "application/vnd.github.star+json",
        },
      );

      pageRequests += 1;
      const pageData = Array.isArray(response.data) ? response.data : [];
      pageCache.set(page, pageData);
      return pageData;
    }

    let page = totalPages;
    let currentStars = 0;
    let previousStars = 0;
    let pagesScanned = 0;
    let crossedBoundary = false;
    const timestamps = [];

    while (page >= 1 && page <= totalPages && pagesScanned < pageLimit) {
      const stars = await getStarPage(page);
      pagesScanned += 1;

      if (!stars.length) {
        crossedBoundary = true;
        break;
      }

      const times = stars
        .map((star) => Date.parse(star.starred_at))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      if (!times.length) {
        throw new Error("GitHub 未返回 starred_at");
      }

      for (const time of times) {
        if (time >= currentStart) {
          currentStars += 1;
          timestamps.push(time);
        } else if (time >= previousStart) {
          previousStars += 1;
        }
      }

      if (times[0] < previousStart) {
        crossedBoundary = true;
        break;
      }

      page -= 1;
    }

    const hasMorePages = page >= 1 && page <= totalPages;
    const truncated = !crossedBoundary && pagesScanned >= pageLimit && hasMorePages;

    return buildRepoResult({
      name: repoName,
      repoName,
      totalStars,
      currentStars,
      previousStars,
      timestamps,
      period,
      currentStart,
      now,
      pagesScanned,
      pageRequests,
      truncated,
    });
  }

  function buildRepoResult(options) {
    const acceleration = options.currentStars - options.previousStars;
    const changePercent =
      options.previousStars > 0
        ? (acceleration / options.previousStars) * 100
        : options.currentStars > 0
          ? 100
          : 0;

    return {
      name: options.repoName,
      url: `https://github.com/${options.repoName}`,
      totalStars: options.totalStars,
      currentStars: options.currentStars,
      previousStars: options.previousStars,
      acceleration,
      changePercent,
      dailyRate: options.currentStars / options.period.days,
      bins: buildBins(
        options.timestamps,
        options.currentStart,
        options.now,
        options.period.bins,
      ),
      pagesScanned: options.pagesScanned,
      pageRequests: options.pageRequests,
      truncated: options.truncated,
      checkedAt: new Date().toISOString(),
    };
  }

  async function githubJson(url, options) {
    const headers = {
      Accept: options.accept,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(url, {
      headers,
      signal: options.signal,
    });

    rememberRate(response.headers);

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const reset = response.headers.get("x-ratelimit-reset");
      const resetTime = reset
        ? new Date(Number(reset) * 1000).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      const apiMessage = data?.message || response.statusText || "请求失败";
      const suffix = response.status === 403 && resetTime ? `，${resetTime} 重置` : "";
      throw new Error(`${response.status} ${apiMessage}${suffix}`);
    }

    return { data, headers: response.headers };
  }

  async function githubGraphql(query, options) {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        query,
        variables: options.variables,
      }),
      signal: options.signal,
    });

    rememberRate(response.headers);

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const apiMessage = payload?.message || response.statusText || "请求失败";
      throw new Error(`${response.status} ${apiMessage}`);
    }

    if (payload?.errors?.length) {
      const message = payload.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join("; ");
      throw new Error(message || "GraphQL 请求失败");
    }

    return payload?.data;
  }

  function rememberRate(headers) {
    const remaining = headers.get("x-ratelimit-remaining");
    const limit = headers.get("x-ratelimit-limit");
    const reset = headers.get("x-ratelimit-reset");

    if (remaining === null || limit === null) return;

    state.rate = {
      remaining: Number(remaining),
      limit: Number(limit),
      reset: reset ? new Date(Number(reset) * 1000) : null,
    };
    renderRate();
  }

  function buildBins(timestamps, start, end, binCount) {
    const bins = Array.from({ length: binCount }, () => 0);
    const span = Math.max(end - start, 1);

    timestamps.forEach((time) => {
      const index = Math.min(
        binCount - 1,
        Math.max(0, Math.floor(((time - start) / span) * binCount)),
      );
      bins[index] += 1;
    });

    return bins;
  }

  function renderResults() {
    renderPeriodButtons();
    renderSummary();
    renderRate();

    const rows = sortResults(state.results);
    els.resultsBody.replaceChildren();

    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 9;
      cell.className = "empty-cell";
      cell.textContent = "暂无数据";
      row.append(cell);
      els.resultsBody.append(row);
      els.exportButton.disabled = true;
      return;
    }

    rows.forEach((result, index) => {
      els.resultsBody.append(createResultRow(result, index + 1));
    });

    els.exportButton.disabled = !state.results.some((result) => isReady(result));
  }

  function renderSummary() {
    const ready = state.results.filter(isReady);
    const period = PERIODS[state.period];
    els.periodLabel.textContent = period.label;

    if (!ready.length) {
      els.fastestName.textContent = "-";
      els.fastestValue.textContent = "-";
      els.periodTotal.textContent = "-";
      els.accelName.textContent = "-";
      els.accelValue.textContent = "-";
      return;
    }

    const fastest = maxBy(ready, (item) => item.currentStars);
    const accelerationLeader = maxBy(ready, (item) => item.acceleration);
    const total = ready.reduce((sum, item) => sum + item.currentStars, 0);

    els.fastestName.textContent = fastest.name;
    els.fastestValue.textContent = `+${numberFmt.format(fastest.currentStars)} stars`;
    els.periodTotal.textContent = `+${numberFmt.format(total)}`;
    els.accelName.textContent = accelerationLeader.name;
    els.accelValue.textContent = signedNumber(accelerationLeader.acceleration);
  }

  function renderRate() {
    if (!state.rate) {
      els.rateValue.textContent = "-";
      els.rateReset.textContent = "-";
      return;
    }

    els.rateValue.textContent = `${numberFmt.format(state.rate.remaining)}/${numberFmt.format(
      state.rate.limit,
    )}`;
    els.rateReset.textContent = state.rate.reset
      ? `${state.rate.reset.toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })} 重置`
      : "-";
  }

  function createResultRow(result, rank) {
    const row = document.createElement("tr");

    row.append(textCell(result.loading || result.error ? "-" : String(rank), "rank-cell"));
    row.append(createRepoCell(result));

    if (result.loading) {
      row.append(textCell("-", "number-cell neutral"));
      row.append(textCell("-", "number-cell neutral"));
      row.append(textCell("-", "number-cell neutral"));
      row.append(textCell("-", "number-cell neutral"));
      row.append(textCell("-", "number-cell neutral"));
      row.append(sparklineCell(Array.from({ length: PERIODS[state.period].bins }, () => 0)));
      row.append(statusCell("分析中", "warn"));
      return row;
    }

    if (result.error) {
      row.append(textCell("-", "number-cell neutral"));
      row.append(textCell("-", "number-cell neutral"));
      row.append(textCell("-", "number-cell neutral"));
      row.append(textCell("-", "number-cell neutral"));
      row.append(textCell("-", "number-cell neutral"));
      row.append(sparklineCell(Array.from({ length: PERIODS[state.period].bins }, () => 0)));
      row.append(statusCell(result.error, "error"));
      return row;
    }

    row.append(textCell(compactFmt.format(result.totalStars), "number-cell"));
    row.append(textCell(`+${numberFmt.format(result.currentStars)}`, "number-cell positive"));
    row.append(textCell(numberFmt.format(result.previousStars), "number-cell"));
    row.append(
      textCell(
        `${signedNumber(result.acceleration)} (${percentFmt.format(result.changePercent)}%)`,
        `number-cell ${result.acceleration > 0 ? "positive" : result.acceleration < 0 ? "negative" : "neutral"}`,
      ),
    );
    row.append(textCell(decimalFmt.format(result.dailyRate), "number-cell"));
    row.append(sparklineCell(result.bins));
    row.append(statusCell(result.truncated ? `${result.pagesScanned} 页+` : `${result.pagesScanned} 页`, result.truncated ? "warn" : ""));

    return row;
  }

  function createRepoCell(result) {
    const cell = document.createElement("td");
    const link = document.createElement("a");
    link.className = "repo-link";
    link.href = result.url || `https://github.com/${result.name}`;
    link.target = "_blank";
    link.rel = "noreferrer";

    const dot = document.createElement("span");
    dot.className = "repo-dot";
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "repo-name";
    name.textContent = result.name;

    link.append(dot, name);
    cell.append(link);
    return cell;
  }

  function textCell(text, className = "") {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  function statusCell(text, tone) {
    const cell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill ${tone || ""}`.trim();
    pill.textContent = text;
    pill.title = text;
    cell.append(pill);
    return cell;
  }

  function sparklineCell(bins) {
    const cell = document.createElement("td");
    cell.append(createSparkline(bins));
    return cell;
  }

  function createSparkline(bins) {
    const width = 120;
    const height = 32;
    const pad = 3;
    const max = Math.max(1, ...bins);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");

    const points = bins.map((count, index) => {
      const x = bins.length === 1 ? width / 2 : (index / (bins.length - 1)) * width;
      const y = height - pad - (count / max) * (height - pad * 2);
      return [x, y];
    });

    const pointString = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const first = points[0] || [0, height - pad];
    const last = points[points.length - 1] || [width, height - pad];
    const path = [
      `M ${first[0].toFixed(1)} ${height - pad}`,
      ...points.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`),
      `L ${last[0].toFixed(1)} ${height - pad}`,
      "Z",
    ].join(" ");

    svg.setAttribute("class", "sparkline");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `趋势 ${bins.join(",")}`);
    area.setAttribute("class", "area");
    area.setAttribute("d", path);
    polyline.setAttribute("points", pointString);
    svg.append(area, polyline);
    return svg;
  }

  function sortResults(results) {
    const key = els.sortSelect.value;
    return [...results].sort((a, b) => {
      if (a.loading && !b.loading) return 1;
      if (!a.loading && b.loading) return -1;
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;

      const aValue = Number(a[key]) || 0;
      const bValue = Number(b[key]) || 0;
      if (bValue !== aValue) return bValue - aValue;
      return (b.currentStars || 0) - (a.currentStars || 0);
    });
  }

  function exportCsv() {
    const ready = state.results.filter(isReady);
    if (!ready.length) return;

    const rows = [
      [
        "project",
        "url",
        "total_stars",
        `${state.period}_stars`,
        "previous_period_stars",
        "acceleration",
        "change_percent",
        "daily_rate",
        "pages_scanned",
        "truncated",
        "checked_at",
      ],
      ...sortResults(ready).map((item) => [
        item.name,
        item.url,
        item.totalStars,
        item.currentStars,
        item.previousStars,
        item.acceleration,
        item.changePercent.toFixed(2),
        item.dailyRate.toFixed(2),
        item.pagesScanned,
        item.truncated ? "yes" : "no",
        item.checkedAt,
      ]),
    ];

    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `github-stars-trend-${state.period}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function parseRepos(value) {
    const seen = new Set();
    return value
      .split(/[\s,，]+/)
      .map(normalizeRepo)
      .filter(Boolean)
      .filter((repo) => {
        if (seen.has(repo.toLowerCase())) return false;
        seen.add(repo.toLowerCase());
        return true;
      });
  }

  function parseSearchQueries(value) {
    const seen = new Set();
    return value
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((query) => {
        const key = query.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function getSource() {
    return els.sourceSelect.value === "custom" ? "custom" : "ai";
  }

  function getInputStorageKey() {
    return getSource() === "ai" ? AI_QUERY_STORAGE_KEY : CUSTOM_REPO_STORAGE_KEY;
  }

  function getConfigList(value, fallback) {
    if (!Array.isArray(value)) return fallback;
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length ? items : fallback;
  }

  function normalizeRepo(value) {
    let text = value.trim();
    if (!text) return "";

    if (/^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text);
        if (!/github\.com$/i.test(url.hostname)) return "";
        const parts = url.pathname.split("/").filter(Boolean);
        text = parts.slice(0, 2).join("/");
      } catch {
        return "";
      }
    }

    text = text.replace(/^github\.com\//i, "").replace(/\.git$/i, "");
    const match = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    return match ? `${match[1]}/${match[2]}` : "";
  }

  function isReady(result) {
    return result && !result.loading && !result.error;
  }

  function maxBy(items, selector) {
    return items.reduce((winner, item) =>
      selector(item) > selector(winner) ? item : winner,
    );
  }

  function signedNumber(value) {
    const sign = value > 0 ? "+" : "";
    return `${sign}${numberFmt.format(value)}`;
  }

  function escapeCsv(value) {
    const text = String(value ?? "");
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function normalizeError(error) {
    if (error?.name === "AbortError") return "已停止";
    return error?.message || "请求失败";
  }

  function setRunning(isRunning) {
    els.scanButton.textContent = isRunning ? "停止" : "刷新";
    els.scanButton.classList.toggle("secondary", isRunning);
    els.scanButton.classList.toggle("primary", !isRunning);
  }

  function setStatus(text) {
    els.statusText.textContent = text;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
