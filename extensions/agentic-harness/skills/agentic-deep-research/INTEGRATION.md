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

## CLI Reference

Complete CLI documentation: https://github.com/vercel-labs/agent-browser

### Core Commands for Deep Research

```bash
# Navigation
agent-browser open <url>                    # Navigate to URL
agent-browser snapshot                       # Get accessibility tree with refs
agent-browser close                          # Close browser
agent-browser close --all                    # Close all sessions

# Session Management
agent-browser --session <name> open <url>    # Open in named session
agent-browser --state <file.json> open <url> # Open with auth state

# Interaction
agent-browser click <selector>               # Click element
agent-browser fill <selector> <text>        # Fill input
agent-browser screenshot [path]              # Take screenshot
agent-browser scroll <direction> [px]       # Scroll (up/down/left/right)

# Info Gathering
agent-browser get text <selector>           # Get text content
agent-browser get title                     # Get page title
agent-browser get url                      # Get current URL
```

### Semantic Locators

```bash
# Find by role, text, label
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "test@test.com"

# Find by position
agent-browser find first ".item" click
agent-browser find nth 2 "a" text
```

### Session & Auth

```bash
# Create auth session (after login)
agent-browser state save ~/.agent-browser/sessions/twitter.json

# Use auth session
agent-browser --session twitter --state ~/.agent-browser/sessions/twitter.json open https://twitter.com

# List sessions
agent-browser sessions list

# Delete session
agent-browser sessions delete <name>
```

### Wait & Retry

```bash
agent-browser wait <selector>           # Wait for element
agent-browser wait <ms>                 # Wait for time (ms)
agent-browser wait --url "**/dash"    # Wait for URL pattern
```

### Advanced

```bash
# Set viewport
agent-browser set viewport 1920 1080

# Emulate device
agent-browser set device "iPhone 14"

# Clipboard
agent-browser clipboard read
agent-browser clipboard write "text"

# PDF export
agent-browser pdf output.pdf

# JavaScript execution
agent-browser eval "document.title"
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
