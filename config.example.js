window.GITHUB_STARS_CONFIG = {
  token: "github_pat_...",
  source: "ai",
  candidateLimit: 80,
  maxSearchRequests: 24,
  useSnapshots: true,
  snapshotDataUrl: "./data/ai_trends.json",
  aiQueries: [
    "topic:artificial-intelligence stars:>50 archived:false fork:false",
    "topic:llm stars:>50 archived:false fork:false",
    "topic:generative-ai stars:>50 archived:false fork:false",
  ],
};
