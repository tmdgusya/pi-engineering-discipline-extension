# Deep Research Feature Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill. Tasks 1-5 can run in parallel. Task 6 depends on all others.

**Goal:** Implement a distributed web research system where multiple subagents (each with their own browser session) explore different sources in parallel, save findings to temporary markdown files, and a main agent aggregates results into a final research report.

**Architecture:** A skill-based system with modular components:
- **Orchestrator (Main Agent):** Receives keywords, performs initial search, distributes work to subagents, aggregates results
- **Research Subagent:** Receives URLs, explores sources via agent-browser, extracts key information
- **Session Manager:** Handles optional authenticated sessions for restricted sites
- **Handoff System:** File-based communication between agents
- **Report Generator:** Merges temporary documents into final report

**Tech Stack:** SKILL.md format, agent-browser CLI, bash scripts, markdown output, existing agentic-harness infrastructure

**Work Scope:**
- **In scope:** 
  - SKILL.md with orchestration logic
  - Main agent initial search and distribution
  - Subagent research and extraction logic
  - Optional auth session handling
  - File-based handoff system
  - Final report generation with citations
- **Out of scope:** 
  - Persistent storage (temp files only, cleaned after report)
  - Rate limiting (assumes reasonable usage)
  - Content filtering beyond basic domain allowlisting

---

**Verification Strategy:**
- **Level:** build-only
- **Command:** Manual verification — skill loads correctly, basic workflow test
- **What it validates:** SKILL.md structure valid, all components referenced correctly

---

## Context

From brainstorming session:

| Item | Decision |
|------|----------|
| Purpose | Distributed web research from keywords to comprehensive report |
| Method | **Parallel subagent exploration** — each agent explores assigned URLs independently |
| Handoff | **File-based** — subagents write temp markdown, main agent aggregates |
| Auth | **Optional** — user can provide session files for restricted sites (X, Reddit, etc.) |
| Sessions | **Named sessions** — one per subagent for isolation |
| Distribution | **Dynamic** — main agent decides agent count based on initial results |
| Collaboration | **Fully distributed** — no mid-process communication |
| Search Strategy | **Autonomous category-based selection** — analyzes topic domain to choose optimal search engine (Korean brands/food/maps → Naver, tech/coding/international → Google) |

---

## File Structure Mapping

```
extensions/
└── agentic-harness/
    └── skills/
        └── agentic-deep-research/
            ├── SKILL.md                    # Main orchestration logic
            ├── SEARCH.md                   # Search engine patterns & URL extraction logic
            └── templates/
                ├── research-template.md    # Subagent output template
                └── report-template.md      # Final report template
```

---

## Task 1: Create SKILL.md Structure

**Dependencies:** None (can run in parallel with Tasks 2-5)
**Files:**
- Create: `extensions/agentic-harness/skills/agentic-deep-research/SKILL.md`

- [ ] **Step 1: Define SKILL.md metadata header**

```markdown
---
name: agentic-deep-research
description: Distributed web research system using multiple browser agents. Use when user says "deep research", "웹 리서치", "여러 소스 탐색", " 종합적 검색", or requests comprehensive research on a topic using parallel agent exploration.
---

# Deep Research Skill

A distributed web research system that...
```

- [ ] **Step 2: Write Overview section**

```markdown
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
```

- [ ] **Step 3: Write Trigger Phrases section**

```markdown
## Trigger Phrases

Use this skill when user says:
- "deep research on [topic]"
- "웹 리서치 해줘"
- "여러 소스에서 정보 수집해줘"
- "종합적 검색 진행해줘"
- "research [topic] thoroughly"
```

- [ ] **Step 4: Write Input Parameters section**

```markdown
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
```

- [ ] **Step 5: Write Main Workflow section**

```markdown
## Main Workflow

### Phase 1: Initial Search with Autonomous Engine Selection

The main agent analyzes the topic and selects the optimal search engine:

#### Search Engine Selection Logic

```bash
# Pseudocode for engine selection
function select_search_engine(topic):
    # Korean-local topics → Naver (better for Korea-specific content)
    if matches_any(topic, ["맛집", "맛집 추천", "한국 브랜드", "한국 쇼핑", 
                           "서울 맛집", "부산 맛집", "지도", "한국 뉴스",
                           "한국 영화", "한국 드라마", "한국 관광", "한국 여행",
                           "서울 여행", "부산 여행"]):
        return "naver"
    
    # Explicit site requests override category logic
    if contains(topic, "reddit"):
        return "reddit"
    if contains(topic, "arxiv"):
        return "arxiv"
    if contains(topic, "github"):
        return "github"
    
    # Academic/research topics
    if matches_any(topic, ["paper", "research", "study", "academic", "논문"]):
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
```

### Phase 3: Subagent Distribution

Create research tasks for each subagent with their assigned URLs:

```bash
# Each subagent runs with its own session
agent-browser --session subagent-1 open {url1}
agent-browser --session subagent-2 open {url2}
# etc.
```

### Phase 4: Research Execution

Each subagent follows this pattern:

1. Open assigned URL
2. Wait for page load
3. Extract key content (headings, paragraphs, quotes)
4. Write findings to temp markdown file
5. Close session

### Phase 5: Aggregation

Main agent reads all temp files, merges by theme/topic, removes duplicates, generates final report.
```

- [ ] **Step 6: Write Subagent Research Pattern section**

```markdown
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

**Temp file naming:** `{session_name}_findings_{timestamp}.md`
**Location:** `./deep-research-{run_id}/` (in user's cwd)
```

- [ ] **Step 7: Write Auth Session Handling section**

```markdown
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
```

- [ ] **Step 8: Write Error Handling section**

```markdown
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
# Cleanup function
cleanup() {
    rm -rf ./deep-research-{run_id}
    agent-browser --session {name} close 2>/dev/null || true
}

# Register cleanup on exit
trap cleanup EXIT
```
```

- [ ] **Step 9: Write Temporary File Format section**

```markdown
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
```

- [ ] **Step 10: Write Final Report Format section**

```markdown
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
```

- [ ] **Step 11: Write Usage Example section**

```markdown
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
```

- [ ] **Step 12: Write Limitations and Future Work section**

```markdown
## Limitations

- **No real-time updates:** Research is a point-in-time snapshot
- **URL depth limited:** Cannot explore infinite link chains
- **Content extraction:** Complex pages (SPAs, paywalls) may have limited extraction
- **Rate limiting:** Some sites may block automated access

## Future Work

- [ ] Add vector storage for semantic search across findings
- [ ] Support streaming updates during research
- [ ] Add interactive source verification (click to view original)
- [ ] Implement research quality scoring
- [ ] Add support for PDF/document extraction
- [ ] Integrate with knowledge bases for persistent storage
```

- [ ] **Step 13: Write Integration with Other Skills section**

```markdown
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
```

- [ ] **Step 14: Save SKILL.md file**

Create directory structure and save:
```bash
mkdir -p extensions/agentic-harness/skills/agentic-deep-research/templates
# Save SKILL.md
```

---

## Task 2: Create Research Template

**Dependencies:** None (can run in parallel with Tasks 1, 3-5)
**Files:**
- Create: `extensions/agentic-harness/skills/agentic-deep-research/templates/research-template.md`

- [ ] **Step 1: Create template for subagent output**

```markdown
# Research Findings - {subagent_id}

**Run ID:** {run_id}
**Timestamp:** {iso_timestamp}
**Agent:** {subagent_id}
**Session:** {session_name}
**Assigned URLs:** {url_count}

## URLs Explored

| # | Title | URL | Status |
|---|-------|-----|--------|
| 1 | ... | ... | success |
| 2 | ... | ... | failed |

## Findings by URL

### {URL}
**Title:** {page_title}
**Domain:** {domain}
**Explored At:** {timestamp}
**Relevance:** {high|medium|low}

**Key Points:**
- {point 1}
- {point 2}

**Notable Quotes:**
> "{quote 1}"

**Data/Statistics:**
| Metric | Value |
|--------|-------|
| ... | ... |

---

### {URL}
...

## Cross-URL Insights

{Any patterns or connections noticed across multiple sources}

## Notes and Observations

- {observation 1}
- {observation 2}

## Errors and Failures

| URL | Error | Action Taken |
|-----|-------|--------------|
| ... | ... | skipped |

## Metadata

```yaml
run_id: {run_id}
subagent_id: {subagent_id}
session: {session_name}
urls_assigned: {count}
urls_explored: {count}
urls_succeeded: {count}
urls_failed: {count}
duration_seconds: {duration}
```
```

- [ ] **Step 2: Save template file**

```bash
# Already created above
```

---

## Task 3: Create Report Template

**Dependencies:** None (can run in parallel with Tasks 1-2, 4-5)
**Files:**
- Create: `extensions/agentic-harness/skills/agentic-deep-research/templates/report-template.md`

- [ ] **Step 1: Create template for final report**

```markdown
# Deep Research Report: {Topic}

> **Metadata**
> - **Generated:** {timestamp}
> - **Sources:** {n} unique sources
> - **Agents Used:** {n}
> - **Time Spent:** {duration}
> - **Research Run ID:** {run_id}

---

## Executive Summary

{2-3 paragraph overview that captures the essence of all findings}

---

## Research Context

**Original Query:** {original_keywords}
**Scope:** {breadth of research}
**Limitations:** {any constraints or gaps identified}

---

## Key Themes

### Theme 1: {Theme Name}

{Detailed synthesis of findings on this theme, combining multiple sources}

**Supporting Sources:**
- [{Source Title 1}]({url1}) - {brief description}
- [{Source Title 2}]({url2}) - {brief description}

**Key Data Points:**
| Finding | Source | Date |
|---------|--------|------|
| ... | ... | ... |

### Theme 2: {Theme Name}
...

### Theme 3: {Theme Name}
...

---

## Divergent Views

{Any conflicting information or differing perspectives found across sources}

| View | Source | Position |
|------|--------|----------|
| ... | ... | ... |

---

## Source Index

| # | Source | Domain | Type | Relevance |
|---|--------|--------|------|-----------|
| 1 | [{Title}](url) | domain.com | article | High |

### By Domain

- **News Sites:** {n} sources
- **Academic:** {n} sources
- **Social Media:** {n} sources
- **Other:** {n} sources

---

## Methodology

### Research Process

1. **Initial Search:** {search_engine} with "{keywords}"
2. **URL Discovery:** Found {n} relevant URLs
3. **Distribution:** {n} agents, ~{urls_per_agent} URLs each
4. **Exploration:** Each agent visited assigned URLs, extracted key content
5. **Aggregation:** Findings merged, deduplicated, synthesized

### Session Usage

| Domain | Session Type | Purpose |
|--------|--------------|---------|
| ... | authenticated/anonymous | ... |

### Quality Indicators

- **Coverage:** {assessment}
- **Recency:** {date range of sources}
- **Diversity:** {types of sources}

---

## Recommendations

{If applicable, actionable insights based on findings}

1. {recommendation 1}
2. {recommendation 2}

---

## Appendix: Raw Findings

Full research findings from each agent:

- [Agent 1 Findings](./findings/agent_1_findings.md)
- [Agent 2 Findings](./findings/agent_2_findings.md)

---

## Footer

*Report generated by Deep Research Skill*
*Run ID: {run_id}*
```

- [ ] **Step 2: Save template file**

```bash
# Already created above
```

---

## Task 4: Create SEARCH.md (Search Engine Patterns)

**Dependencies:** None (can run in parallel with Tasks 1-3, 5-6)
**Files:**
- Create: `extensions/agentic-harness/skills/agentic-deep-research/SEARCH.md`

- [ ] **Step 1: Create SEARCH.md with search engine patterns**

```markdown
---
name: agentic-deep-research-search
description: Search engine patterns and URL extraction logic for Deep Research. Contains autonomous engine selection, URL extraction from various search engines, and fallback strategies.
---

# Search Engine Patterns

This module handles autonomous search engine selection and URL extraction.

## Search Engine Selection

### Selection Algorithm

```bash
# Pseudocode
function select_engine(topic):
    # Korean-local topics → Naver
    if matches_category(topic, ["korean_food", "korean_brands", "korean_travel", 
                                 "korean_maps", "korean_news", "korean_shopping"]):
        return "naver"
    
    # Site-specific requests (always override)
    if contains(topic, "reddit"):
        return "reddit"
    if contains(topic, "arxiv"):
        return "arxiv"
    if contains(topic, "github"):
        return "github"
    
    # Academic focus
    if contains_any(topic, ["paper", "research", "study", "academic", "논문"]):
        return "google_scholar"
    
    # Default: Google (tech, coding, international)
    return "google"
```

### Korean-Local Categories (→ Naver)

| Category | Keywords | Why Naver |
|----------|----------|----------|
| 맛집/음식 | "서울 맛집", "홍대 맛집", "한국 음식" | 리뷰, 블로그 많음 |
| 쇼핑/브랜드 | "한국 브랜드", "한국 쇼핑몰", "쿠팡" | 국내 쇼핑 sites |
| 여행/관광 | "서울 여행", "부산 여행", "한국 관광" | 한국 여행 정보 |
| 지도/위치 | "주변 맛집", "약국", "편의점" | 네이버 지도 |
| 한국 뉴스 | "오늘 뉴스", "대한민국" | 네이버 뉴스 |

### Engine URLs

| Engine | URL Template | Notes |
|--------|-------------|-------|
| Google | `https://www.google.com/search?q={q}` | Tech, coding, international |
| Naver | `https://search.naver.com/search.naver?query={q}` | Korean-local content |
| Bing | `https://www.bing.com/search?q={q}` | Alternative |
| DuckDuckGo | `https://duckduckgo.com/?q={q}` | Privacy |
| Reddit | `https://www.reddit.com/search/?q={q}` | Discussions |
| ArXiv | `https://arxiv.org/search/?search_query={q}` | Papers |
| Google Scholar | `https://scholar.google.com/scholar?q={q}` | Academic |

## URL Extraction Patterns

### Google

```bash
# Extract search result links
agent-browser snapshot -i
# Look for elements like:
# @e1 link "Result Title" -> a[href^="/url?"]
```

### Naver

```bash
# Naver search result structure
agent-browser snapshot -s ".view_wrap"
# Extract from .title_link, .url_link
```

### Reddit

```bash
# Reddit search results
agent-browser snapshot -s ".search-result"
```

## Fallback Strategy

```bash
# If primary engine fails:
1. Try alternative engine from same category
2. If still failing, try generic search (Google)
3. Report partial results with warning
```

## Example: Multi-Engine Search

```bash
# Topic: "AI safety research"
topic="AI safety research"

# Step 1: Select engine (defaults to Google)
engine="google"

# Step 2: Search
agent-browser --session main open "https://www.google.com/search?q=${topic}"
agent-browser wait --load networkidle

# Step 3: Extract URLs
urls=$(extract_links "search-result" ".r a")

# Step 4: If few results, try additional engines
if [ ${#urls[@]} -lt 5 ]; then
    agent-browser open "https://arxiv.org/search/?search_query=${topic}"
    urls+=($(extract_links))
fi
```

---
*Auto-generated search patterns - update as engines change*
```

- [ ] **Step 2: Save SEARCH.md file**

```bash
# Already in directory created above
```

---

## Task 5: Create Cleanup Script

**Dependencies:** None (can run in parallel with Tasks 1-4, 6)
**Files:**
- Create: `extensions/agentic-harness/skills/agentic-deep-research/scripts/cleanup.sh`

- [ ] **Step 1: Create cleanup script**

```bash
#!/bin/bash
# cleanup.sh - Clean up temporary research files

set -e

RUN_ID="${1:-}"
if [ -z "$RUN_ID" ]; then
    echo "Usage: cleanup.sh <run_id>"
    exit 1
fi

RESEARCH_DIR="$(pwd)/deep-research-${RUN_ID}" or use cwd from subagent

# Close all browser sessions for this run
for session in $(ls "${RESEARCH_DIR}/sessions/" 2>/dev/null || true); do
    agent-browser --session "${session}" close 2>/dev/null || true
done

# Remove temp directory
rm -rf "${RESEARCH_DIR}"

echo "Cleaned up research run: ${RUN_ID}"
```

- [ ] **Step 2: Make script executable**

```bash
chmod +x extensions/agentic-harness/skills/agentic-deep-research/scripts/cleanup.sh
```

- [ ] **Step 3: Create directory structure**

```bash
mkdir -p extensions/agentic-harness/skills/agentic-deep-research/scripts
mkdir -p extensions/agentic-harness/skills/agentic-deep-research/templates
```

---

## Task 6: Write Integration Guide

**Dependencies:** None (can run in parallel with Tasks 1-5)
**Files:**
- Create: `extensions/agentic-harness/skills/agentic-deep-research/INTEGRATION.md`

- [ ] **Step 1: Write integration documentation**

```markdown
# Integration Guide

## Prerequisites

1. **Install agent-browser:**
   ```bash
   npm i -g agent-browser
   agent-browser install
   ```

2. **Verify installation:**
   ```bash
   agent-browser --version
   ```

## Setting Up Auth Sessions

### For Twitter/X

1. Login to Twitter in browser
2. Export cookies to session file:
   ```bash
   agent-browser state save ~/.agent-browser/sessions/twitter.json
   ```

### For Reddit

1. Login to Reddit
2. Export cookies:
   ```bash
   agent-browser state save ~/.agent-browser/sessions/reddit.json
   ```

### For LinkedIn

1. Login to LinkedIn
2. Export cookies:
   ```bash
   agent-browser state save ~/.agent-browser/sessions/linkedin.json
   ```

## Running Deep Research

### From pi agent

Simply invoke with natural language:

```
deep research on AI safety developments in 2026
```

### With Auth Sessions

```
deep research on Twitter discussions about {topic}
session: twitter.json
```

### Advanced Usage

```
research topic="climate change policy"
agent_count=5
depth=10
session_files=["twitter.json", "reddit.json"]
```

## Troubleshooting

### Browser Not Starting

```bash
# Reinstall Chrome
agent-browser install --force

# Check Chrome location
which google-chrome || which chromium
```

### Session Not Loading

```bash
# Verify session file exists
ls -la ~/.agent-browser/sessions/

# Test session loading
agent-browser --session test --state ~/.agent-browser/sessions/twitter.json open https://twitter.com
```

### Memory Issues

```bash
# Reduce agent count
agent_count=2

# Close all sessions before starting
agent-browser close --all
```
```

---

## Task 7 (Final): Verify Deep Research Skill Completeness

**Dependencies:** Tasks 1-6 complete
**Files:** All created files (read-only verification)

- [ ] **Step 1: Verify SKILL.md exists at correct path**

Path: `extensions/agentic-harness/skills/agentic-deep-research/SKILL.md`

- [ ] **Step 2: Verify all required sections present in SKILL.md**

Check for:
- [ ] name and description (frontmatter)
- [ ] Overview section
- [ ] Trigger Phrases
- [ ] Input Parameters
- [ ] Main Workflow (5 phases)
- [ ] Subagent Research Pattern
- [ ] Auth Session Handling
- [ ] Error Handling
- [ ] Temporary File Format
- [ ] Final Report Format
- [ ] Usage Example
- [ ] Limitations
- [ ] Future Work
- [ ] Integration with Other Skills

- [ ] **Step 3: Verify templates exist**

- [ ] `templates/research-template.md`
- [ ] `templates/report-template.md`

- [ ] **Step 4: Verify SEARCH.md exists**

- [ ] `SEARCH.md` exists with search engine patterns
- [ ] Autonomous selection logic documented

- [ ] **Step 5: Verify cleanup script**

- [ ] `scripts/cleanup.sh` exists and is executable

- [ ] **Step 6: Verify integration guide**

- [ ] `INTEGRATION.md` exists with setup instructions

- [ ] **Step 7: Check file structure**

```bash
ls -la extensions/agentic-harness/skills/agentic-deep-research/
ls -la extensions/agentic-harness/skills/agentic-deep-research/templates/
ls -la extensions/agentic-harness/skills/agentic-deep-research/scripts/
```

Expected structure:
```
agentic-deep-research/
├── SKILL.md
├── SEARCH.md
├── INTEGRATION.md
├── templates/
│   ├── research-template.md
│   └── report-template.md
└── scripts/
    └── cleanup.sh
```

- [ ] **Step 7: Validate markdown syntax**

```bash
# Basic syntax check (if markdownlint available)
# or manual review of SKILL.md structure
```

---

## Self-Review Checklist

- [ ] All tasks have exact file paths
- [ ] All steps contain executable content (bash commands, markdown)
- [ ] No file conflicts between parallel tasks
- [ ] Dependency chain is accurate (Task 7 depends on 1-6)
- [ ] SKILL.md covers all spec requirements from brainstorming
- [ ] SEARCH.md contains autonomous engine selection logic
- [ ] No placeholders (TBD, TODO, "implement later")
- [ ] Templates are complete and copy-paste ready
- [ ] Integration guide is actionable
