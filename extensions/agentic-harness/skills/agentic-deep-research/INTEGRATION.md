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

### For Korean-Local Topics

```
deep research on 서울 맛집 추천
deep research on 한국 브랜드 트렌드
deep research on 부산 여행 코스
```

The skill automatically selects Naver for these topics.

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

## Search Engine Selection

The skill automatically selects search engines based on topic:

| Topic Type | Engine | Example |
|------------|--------|---------|
| Korean-local (food, brands, maps) | Naver | "서울 맛집", "한국 브랜드" |
| Tech, coding, international | Google | "React hooks", "AI trends" |
| Academic/research | Google Scholar | "machine learning paper" |
| Specific sites | Direct | "reddit discussion" |

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

### Naver Search Not Working

```bash
# Verify Naver URL format
agent-browser open "https://search.naver.com/search.naver?query=test"

# Check for CAPTCHA (may need auth session)
```

## File Structure

```
agentic-deep-research/
├── SKILL.md           # Main skill
├── SEARCH.md          # Search engine patterns
├── INTEGRATION.md     # This file
├── templates/
│   ├── research-template.md
│   └── report-template.md
└── scripts/
    └── cleanup.sh
```

## Cleanup

After research completes, temp files are stored at:
```
./deep-research-{run_id}/
```

To manually clean up:
```bash
./scripts/cleanup.sh {run_id}
```
