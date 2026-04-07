---
name: agentic-deep-research
description: Distributed web research system using multiple browser agents. Use when user says "deep research", "웹 리서치", "여러 소스 탐색", "종합적 검색", or requests comprehensive research on a topic using parallel agent exploration.

IMPORTANT: Before using this skill, check if agent-browser is installed. If not, tell the user to run /init or /setup first. See Prerequisites section for details.
---

# Deep Research Skill

A distributed web research system that uses multiple parallel browser agents to explore different sources simultaneously, then aggregates findings into a comprehensive report.

## ⚠️ Prerequisites

**This skill requires `agent-browser` to be installed.**

If agent-browser is not installed, the research will fail. Run one of these commands first:

```bash
/init
# or
/setup
```

These commands will install agent-browser automatically. Or install manually:

```bash
npm i -g agent-browser
agent-browser install
```

For more information, visit: https://github.com/vercel-labs/agent-browser

## Overview

Deep Research uses multiple parallel browser agents to explore different sources simultaneously, then aggregates findings into a comprehensive report.

**Key concepts:**
- **Main Agent (Orchestrator):** Receives keywords, performs initial search, distributes work
- **Subagent (Researcher):** Each subagent gets a set of URLs to explore
- **Handoff:** Subagents write findings to temp markdown files
- **Aggregation:** Main agent merges all findings into final report

**Session management:**
- Each subagent uses its own named browser session for isolation
- Optional: User can provide authenticated sessions for restricted sites

## Technical Reference

For complete CLI documentation and parameters, see **INTEGRATION.md**:
- Session management commands
- Semantic locators
- Auth session setup
- Advanced browser settings

## Key Concepts

### Main Agent (Orchestrator)
The main agent coordinates the entire research workflow:
1. Receives and analyzes the research topic
2. Selects optimal search engine based on topic category
3. Performs initial search to discover relevant URLs
4. Groups and distributes URLs to subagents
5. Aggregates findings from all subagents
6. Generates final comprehensive report

### Subagent (Researcher)
Each subagent operates independently with its own browser session:
1. Receives assigned URLs from main agent
2. Opens each URL in its session
3. Extracts key content (headings, paragraphs, quotes)
4. Writes findings to temporary markdown file
5. Reports completion to main agent

### Handoff System
File-based communication between agents:
- **Location:** `./deep-research-{run_id}/` (in user's cwd)
- **Subagent output:** `{subagent_id}_findings_{timestamp}.md`
- **Aggregation metadata:** `research_metadata.md`

### Aggregation
Main agent merges all findings:
1. Reads all temp markdown files
2. Groups findings by theme/topic
3. Removes duplicate information
4. Synthesizes into final report with citations

## Session Management

### Session Isolation
Each subagent uses a dedicated browser session:
```bash
agent-browser --session subagent-1 open {url}
agent-browser --session subagent-2 open {url}
```

### Linux / Container Environments
On Linux, VMs, or containers, you need additional Chrome flags:
```bash
# Linux/VM/Container (required flags)
agent-browser --session subagent-1 --args "--no-sandbox --disable-dev-shm-usage --disable-gpu" open {url}
```

**Required flags:**
- `--no-sandbox` - Bypass sandbox (root/containers)
- `--disable-dev-shm-usage` - Fix /dev/shm size issues in containers
- `--disable-gpu` - Disable GPU acceleration (headless environments)

### Session Lifecycle
1. **Create:** Named session for each subagent
2. **Use:** Open URLs, extract content, write findings
3. **Close:** Clean up after research completes
4. **Cleanup:** Optional user-provided sessions persist; temporary sessions removed

### Named Session Format
Sessions follow pattern: `research-{run_id}-{subagent-id}`
- Example: `research-20260407-abc123-subagent-1`

## Agent Selection

### Use `researcher` Agent
**IMPORTANT:** When spawning subagents for deep research, use the `researcher` agent instead of `worker`.

| Agent | Use Case | Slop Cleaner |
|-------|----------|-------------|
| `researcher` | Deep research, browser automation, data collection | ❌ Disabled |
| `worker` | General purpose execution, code changes | ✅ Enabled |

**Why `researcher`?**
- The `worker` agent triggers `slop-cleaner` after execution, which is unnecessary for research tasks
- `researcher` agent is optimized for browser-based research without code cleanup overhead

**Example subagent call:**
```bash
subagent(agent: "researcher", task: "Research task description", cwd: "...")
```

## Trigger Phrases

Use this skill when user says:
- "deep research on [topic]"
- "deep research [topic]"
- "웹 리서치 해줘"
- "여러 소스에서 정보 수집해줘"
- "종합적 검색 진행해줘"
- "research [topic] thoroughly"
- "comprehensive research on [topic]"
- "thorough investigation of [topic]"

## Input Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `topic` | Yes | Research topic/keywords |
| `session_files` | No | Array of auth session file paths for restricted sites |
| `agent_count` | No | Max number of parallel agents (default: 3) |
| `depth` | No | Exploration depth per agent (default: 5 URLs) |

**Example invocation:**
```
research topic="AI trends 2026"
session_files=["~/.agent-browser/sessions/twitter.json"]
agent_count=5
depth=10
```

## When to Use Browser vs WebFetch

This skill uses **agent-browser** for full browser automation (login, scroll, interact). However, for simple content extraction, **webfetch** is faster and simpler:

| Use Case | Tool | Why |
|----------|------|-----|
| Read article content | `webfetch` | Fast, no browser overhead |
| Extract search results | `agent-browser` or `webfetch` | Either works |
| Login-required content | `agent-browser` | Needs session/auth |
| Interactive pages (SPA) | `agent-browser` | Needs JS execution |
| Screenshots | `agent-browser` | Requires visual rendering |
| Form submission | `agent-browser` | Needs interaction |

**Tip:** Use `webfetch` when you just need text content from a URL. Reserve `agent-browser` for cases requiring interaction or authentication.

## Main Workflow

### Phase 1: Initial Search with Autonomous Engine Selection

The main agent analyzes the topic and selects the optimal search engine based on topic category.

#### Search Engine Selection Logic

```bash
# Pseudocode for engine selection
function select_search_engine(topic):
    # Korean-local topics → Naver (better for Korea-specific content)
    if matches_any(topic, ["맛집", "맛집 추천", "한국 브랜드", "한국 쇼핑", 
                           "서울 맛집", "부산 맛집", "지도", "한국 뉴스",
                           "한국 영화", "한국 드라마", "한국 관광", "한국 여행",
                           "서울 여행", "부산 여행", "홍대 맛집", "강남 맛집",
                           "한국 음식", "한식", "분식", "치킨", "피자",
                           "네이버 지도", "카카오맵"]):
        return "naver"
    
    # Explicit site requests override category logic
    if contains(topic, "reddit"):
        return "reddit"
    if contains(topic, "arxiv"):
        return "arxiv"
    if contains(topic, "github"):
        return "github"
    
    # Academic/research topics
    if matches_any(topic, ["paper", "research", "study", "academic", "논문", "학술"]):
        return "google_scholar"
    
    # Default: Google (better for tech, coding, international content)
    return "google"
```

#### Supported Search Engines

| Engine | Use Case | URL Pattern |
|--------|----------|-------------|
| Google | Tech, coding, international topics | `https://www.google.com/search?q={q}` |
| Naver | Korean-local: food, brands, maps, news | `https://search.naver.com/search.naver?query={q}` |
| Bing | Alternative to Google | `https://www.bing.com/search?q={q}` |
| DuckDuckGo | Privacy-focused | `https://duckduckgo.com/?q={q}` |
| Reddit | Community discussions | `https://www.reddit.com/search/?q={q}` |
| ArXiv | Academic papers | `https://arxiv.org/search/?search_query={q}` |
| Google Scholar | Academic research | `https://scholar.google.com/scholar?q={q}` |

#### Korean-Local Categories (→ Naver)

| Category | Keywords | Why Naver |
|----------|----------|----------|
| 맛집/음식 | "서울 맛집", "홍대 맛집", "한국 음식" | 리뷰, 블로그 많음 |
| 쇼핑/브랜드 | "한국 브랜드", "한국 쇼핑몰", "쿠팡" | 국내 쇼핑 sites |
| 여행/관광 | "서울 여행", "부산 여행", "한국 관광" | 한국 여행 정보 |
| 지도/위치 | "주변 맛집", "약국", "편의점" | 네이버 지도 |
| 한국 뉴스 | "오늘 뉴스", "대한민국" | 네이버 뉴스 |

#### Initial Search Execution

```bash
# Based on selection, use appropriate search URL
ENGINE_URL=$(get_engine_url selected_engine)
SEARCH_URL="${ENGINE_URL}?q=${TOPIC}"

agent-browser --session main open "${SEARCH_URL}"
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Extract discovered URLs into a list. If initial search yields few results, automatically try alternative engines.

### Phase 2: URL Grouping

Group discovered URLs by domain or topic similarity:

```bash
# Example grouping logic (pseudocode)
urls_by_domain = group_by_domain(discovered_urls)
urls_by_topic = group_by_topic(discovered_urls)

# Group sizes based on agent count
urls_per_agent = ceil(total_urls / agent_count)
```

### Phase 3: Subagent Distribution

Create research tasks for each subagent with their assigned URLs:

```bash
# Use cwd (current working directory) for handoff files
# This allows users to access research results easily
RESEARCH_DIR="$(pwd)/deep-research-{run_id}"
mkdir -p "$RESEARCH_DIR/tasks"

# Task file format (written by main agent):
cat > "$RESEARCH_DIR/tasks/subagent-{n}.json" << EOF
{
  "subagent_id": "subagent-{n}",
  "session_name": "research-{run_id}-subagent-{n}",
  "assigned_urls": [
    {"url": "https://...", "priority": "high"},
    {"url": "https://...", "priority": "medium"}
  ],
  "auth_sessions": ["twitter.json"]
}
EOF
```

### Phase 4: Research Execution

Each subagent follows this pattern:

1. Read assigned task file
2. Create own browser session
3. For each URL in assigned URLs:
   - Open URL
   - Wait for page load
   - Extract key content
   - Write findings to output file
   - Close tab (if multiple tabs)
4. Write completion marker
5. Exit

```bash
# Use cwd for handoff files
RESEARCH_DIR="$(pwd)/deep-research-{run_id}"
TASK_FILE="$RESEARCH_DIR/tasks/subagent-1.json"
SESSION_NAME="research-{run_id}-subagent-1"
OUTPUT_FILE="$RESEARCH_DIR/subagent-1_findings.md"

# Read task
URLS=$(jq -r '.assigned_urls[].url' "$TASK_FILE")

# Create session and explore
# Note: Add --args "--no-sandbox --disable-dev-shm-usage --disable-gpu" on Linux/VM/container
for url in $URLS; do
    agent-browser --session "$SESSION_NAME" open "$url"
    # Linux: agent-browser --session "$SESSION_NAME" --args "--no-sandbox --disable-dev-shm-usage --disable-gpu" open "$url"
    agent-browser wait --load networkidle
    
    # Extract content
    agent-browser get text body >> "$OUTPUT_FILE"
    
    agent-browser close --tab 2>/dev/null || true
done
```

### Phase 5: Aggregation

Main agent reads all temp files, merges by theme/topic, removes duplicates, generates final report:

```bash
# Read all subagent findings
RESEARCH_DIR="$(pwd)/deep-research-{run_id}"
REPORT_FILE="$RESEARCH_DIR/final_report.md"

# Merge and deduplicate
cat "$FINDINGS_DIR"/subagent-*_findings.md | \
    deduplicate | \
    group_by_theme | \
    generate_report > "$REPORT_FILE"

# Write metadata
cat > "$FINDINGS_DIR/research_metadata.md" << EOF
# Research Run - {run_id}

**Topic:** {research_topic}
**Started:** {start_time}
**Completed:** {end_time}
**Agents Used:** {n}
**Total URLs Explored:** {n}
**Successful:** {n}
**Failed:** {n}
**Output:** $REPORT_FILE
EOF
```

## Subagent Research Pattern

Each subagent follows this pattern for each assigned URL:

```bash
# Open URL
agent-browser --session {session_name} open {url}
agent-browser wait --load networkidle

# Extract content
agent-browser snapshot -i
agent-browser get text body > {url_hash}.txt

# Get metadata
agent-browser get title
agent-browser get url

# Write findings to temp file
cat >> {session_dir}/findings.md << EOF
## {Title}

**Source:** [{url}]({url})
**Explored:** {timestamp}

{extracted_content}

---
EOF

# Close tab and move to next URL
agent-browser close --tab
```

**Full bash example with error handling:**

```bash
#!/bin/bash
# subagent-research.sh - Subagent research execution script

RUN_ID="$1"
SUBAGENT_ID="$2"
SESSION_NAME="research-${RUN_ID}-${SUBAGENT_ID}"
OUTPUT_DIR="$(pwd)/deep-research-${RUN_ID}"
OUTPUT_FILE="${OUTPUT_DIR}/${SUBAGENT_ID}_findings.md"

# Create output file with header
cat > "$OUTPUT_FILE" << EOF
# Research Findings - ${SUBAGENT_ID}

**Run ID:** ${RUN_ID}
**Timestamp:** $(date -Iseconds)
**Agent:** ${SUBAGENT_ID}
**Session:** ${SESSION_NAME}

## URLs Explored

EOF

# Read assigned URLs
TASK_FILE="${OUTPUT_DIR}/tasks/${SUBAGENT_ID}.json"
URLS=$(jq -r '.assigned_urls[].url' "$TASK_FILE" 2>/dev/null || echo "")

# Explore each URL
for url in $URLS; do
    echo "Exploring: $url"
    
    # Open URL with timeout
    if timeout 30 agent-browser --session "$SESSION_NAME" open "$url" 2>&1; then
        agent-browser wait --load networkidle
        
        # Get page info
        TITLE=$(agent-browser get title 2>/dev/null || echo "Unknown")
        
        # Append to findings
        cat >> "$OUTPUT_FILE" << EOF

### [$TITLE]($url)

**Explored At:** $(date -Iseconds)
**Status:** success

$(agent-browser get text body 2>/dev/null | head -n 100)

EOF
    else
        # Log failure
        echo "| [$url]($url) | failed | timeout" >> "$OUTPUT_FILE"
    fi
    
    # Close tab
    agent-browser close --tab 2>/dev/null || true
done

echo "Completed: $SUBAGENT_ID"
```

**Temp file naming:** `{subagent_id}_findings.md`
**Location:** `./deep-research-{run_id}/` (in user's cwd)

## Auth Session Handling

### User-Provided Sessions

Users can provide authenticated session files for sites that require login:

```bash
# Session file location passed to subagent
AGENT_SESSION_FILE="~/.agent-browser/sessions/twitter.json"

# Subagent uses auth session for matching domains
agent-browser --session subagent-1 --state {session_file} open {restricted_url}
```

### Supported Auth Sites

| Site | Auth Type | Session Format |
|------|-----------|----------------|
| X (Twitter) | Session cookie | `.json` state file |
| Reddit | Session cookie | `.json` state file |
| LinkedIn | Session cookie | `.json` state file |
| GitHub | Personal token | `.env` or `.json` |

### Session Matching Logic

```bash
# Pseudocode for session matching
for url in assigned_urls:
    domain = extract_domain(url)
    if domain in user_provided_sessions:
        use_session(user_provided_sessions[domain])
    else:
        use_anonymous_session()
```

### Prompting for Sessions

If the user mentions restricted sites without providing sessions:

```
I notice some relevant sources may require login (X, Reddit, LinkedIn, etc.).

Would you like to provide authenticated sessions for these sites?
- Run `agent-browser state list` to see available sessions
- Or run `agent-browser auth login <site>` to create new sessions
```

## Error Handling

### URL Access Failures

If a URL fails to load:

```bash
# Check error type
agent-browser --session {name} open {url} 2>&1
# If 403/401: mark as "auth_required"
# If timeout: mark as "timeout_retry"
# If 404: mark as "not_found"
```

**Fallback strategy:** If primary source fails, subagent marks it and continues to next URL.

### Session Expiration

```bash
# Check session validity before use
agent-browser --session {name} open {test_url}
if contains("login", page_content):
    # Session expired
    mark_for_user_review()
```

### Resource Limits

```bash
# Max URLs per agent (configurable)
MAX_URLS_PER_AGENT=${depth:-5}

# Max total agents
MAX_PARALLEL_AGENTS=${agent_count:-3}

# Timeout per URL
URL_TIMEOUT=30000  # 30 seconds
```

### Cleanup on Error

```bash
# Cleanup function (runs in user's cwd)
cleanup() {
    rm -rf ./deep-research-{run_id}
    agent-browser --session {name} close 2>/dev/null || true
}

# Register cleanup on exit
trap cleanup EXIT
```

### Error Recovery Flow

```
1. URL fails to load
   → Check error type (403, timeout, 404)
   → If recoverable: retry once after 2 seconds
   → If still fails: mark as failed, continue to next URL
   → Log error with URL and error type

2. Session expires mid-research
   → Detect via login page or 401
   → Mark affected URLs as "auth_required"
   → Continue with remaining URLs
   → Report at end for user review

3. Subagent crashes
   → Main agent detects via missing completion marker
   → Reassign URLs to another subagent
   → Log partial results if available

4. Browser crashes
   → Restart session
   → Resume from last successful URL
   → Log crash event
```

## Temporary File Format

### Research Findings File

Each subagent writes findings to:

```markdown
# Research Findings - {subagent_id}

**Run ID:** {run_id}
**Timestamp:** {iso_timestamp}
**Agent:** {subagent_id}
**Session:** {session_name}

## URLs Explored

1. [{title}]({url}) - {status} ({error_if_any})
2. ...

## Findings by URL

### {URL 1}
**Title:** {page_title}
**Domain:** {domain}
**Relevance:** {high|medium|low}

{extracted key content, quotes, data}

### {URL 2}
...

## Notes
- Any observations, patterns, or cross-URL insights

## Errors
- {url}: {error_message}
```

### Aggregation Metadata

```markdown
# Research Run - {run_id}

**Topic:** {research_topic}
**Started:** {start_time}
**Completed:** {end_time}
**Agents Used:** {n}
**Total URLs Explored:** {n}
**Successful:** {n}
**Failed:** {n}

## Session Usage
- Authenticated: {domains}
- Anonymous: {domains}

## Output File
{final_report_path}
```

### Directory Structure

All files are created in the user's current working directory:

```
./deep-research-{run_id}/
├── tasks/
│   ├── subagent-1.json
│   ├── subagent-2.json
│   └── ...
├── subagent-1_findings.md
├── subagent-2_findings.md
├── ...
├── research_metadata.md
└── final_report.md
```

**Note:** Use `$(pwd)` or accept the cwd from the subagent call to locate files.

## Final Report Format

The aggregated report follows this structure:

```markdown
# Deep Research Report: {Topic}

**Generated:** {timestamp}
**Sources:** {n} unique sources
**Agents Used:** {n}
**Time Spent:** {duration}

## Executive Summary

{2-3 paragraph overview of findings}

## Key Themes

### Theme 1: {Theme Name}
{Content synthesized from multiple sources}

**Sources:**
- [{Title 1}]({url1})
- [{Title 2}]({url2})

### Theme 2: {Theme Name}
...

## Source Index

| # | Source | Domain | Relevance |
|---|--------|--------|-----------|
| 1 | [Title](url) | domain.com | High |

## Methodology

- Initial search: {search_engine} with "{keywords}"
- Distribution: {n} agents, ~{urls_per_agent} URLs each
- Sessions: {n} authenticated, {n} anonymous
- Exploration: {depth} URLs per agent

## Appendix: Raw Findings

{Dump of all temp files, or reference their location}
```

### Citation Format

Use inline citations where relevant:

```markdown
According to [Source Name]({url}), {claim}.

{claim}[^1]

[^1]: {url}
```

## Usage Example

### Simple Research

User: "deep research on renewable energy trends 2026"

Main Agent Flow:
1. Initial search → discovers 15+ relevant URLs
2. Groups URLs into 3 clusters (tech, policy, market)
3. Creates 3 subagents with ~5 URLs each
4. Each subagent explores assigned URLs, writes findings
5. Main agent aggregates all findings
6. Generates final markdown report

### Research with Auth Sessions

User: "deep research on Twitter discussions about AI safety"
User provides: `~/.agent-browser/sessions/twitter.json`

Main Agent Flow:
1. Initial search (DDG, anonymous)
2. Identifies Twitter/X URLs in results
3. Subagent handling Twitter URLs uses auth session
4. Other subagents use anonymous sessions
5. Aggregation and report generation

### Korean-Local Research

User: "서울 맛집 추천 2026"

Main Agent Flow:
1. Detects Korean-local keywords ("맛집", "서울")
2. Selects Naver search engine
3. Initial search on Naver
4. Groups by type (카페, 한식, 중식, etc.)
5. Distributes to subagents
6. Aggregates findings
7. Generates Korean-language report

### Output

```markdown
# Deep Research Report: Renewable Energy Trends 2026

**Generated:** 2026-04-07T14:30:00Z
**Sources:** 23 unique sources
**Agents Used:** 3

## Executive Summary
...

## Key Themes
...

## Source Index
...
```

## Limitations

- **No real-time updates:** Research is a point-in-time snapshot
- **URL depth limited:** Cannot explore infinite link chains
- **Content extraction:** Complex pages (SPAs, paywalls) may have limited extraction
- **Rate limiting:** Some sites may block automated access
- **Browser dependencies:** Requires Chrome/Chromium and agent-browser installed
- **Session management:** User must manage auth session lifecycle

## Future Work

- [ ] Add vector storage for semantic search across findings
- [ ] Support streaming updates during research
- [ ] Add interactive source verification (click to view original)
- [ ] Implement research quality scoring
- [ ] Add support for PDF/document extraction
- [ ] Integrate with knowledge bases for persistent storage
- [ ] Add parallel engine search for broader coverage
- [ ] Implement smart URL deduplication across engines
- [ ] Add language detection and translation support
- [ ] Implement research session resumption

## Integration with Other Skills

### With agentic-brainstorming
Use brainstorming to refine research topic before starting:
- "I want to research AI safety" → brainstorm → "AI safety in large language models: current debates and mitigations"

### With agentic-plan-crafting
After research, use findings to create implementation plans:
- Research "microservices best practices" → Plan → "Implementation plan for migrating to microservices"

### With agent-browser
This skill is built on top of agent-browser:
- Requires `agent-browser` CLI installed
- Uses named sessions for isolation
- Supports all agent-browser auth methods
- Compatible with all agent-browser commands

### With agentic-long-run
For multi-day research projects:
- Day 1: Initial research on topic A
- Day 2: Follow-up research on related topic B
- Day 3: Synthesis and final report

### Skill Invocation Chain

```
User Request → agentic-clarification (if needed)
           → agentic-deep-research (this skill)
           → agentic-brainstorming (optional refinement)
           → agentic-plan-crafting (optional planning)
           → agentic-long-run (optional multi-day)
```
