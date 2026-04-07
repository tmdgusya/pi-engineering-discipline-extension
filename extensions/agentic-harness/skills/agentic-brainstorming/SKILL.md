---
name: agentic-brainstorming
description: >
  Interactive idea development through guided Q&A dialogue. This skill helps users
  clarify and develop their ideas by asking targeted questions, expanding on possibilities,
  and producing a structured markdown document capturing the essence of their thinking.
  
  Triggers: "brainstorm", "아이디어", "아이디어 정리", "생각을 정리하고 싶어", "무엇이든 떠오르는 대로"
---

# Agentic Brainstorming

A guided Q&A dialogue that transforms vague ideas into structured clarity.

## Core Principle

### Three Pillars

**1. Listen First**
- Absorb the user's initial thought without judgment
- Mirror back what you hear to confirm understanding
- Follow the thread of their thinking, don't impose your own

**2. Expand Mindfully**
- Ask questions that open possibilities, not close them
- Surface hidden assumptions and unexplored angles
- Introduce gentle provocations when ideas feel stuck

**3. Structure Naturally**
- Let organization emerge from the content
- Identify relationships between concepts
- Create clear output without forcing premature clarity

## Hard Gates

1. **Never assume** — Ask when intent is unclear
2. **Never judge** — All ideas are valid during exploration
3. **Never rush** — Let ideas breathe before structuring
4. **Never impose** — The user's vision leads, you facilitate
5. **Never abandon** — Conclude with actionable output

## When To Use / When NOT To Use

### When To Use
- User has a vague idea they want to develop
- User needs to explore multiple angles of a concept
- User wants to document their thinking process
- User is stuck and needs external perspective
- User says things like "I have an idea but..." or "What if..."

### When NOT To Use
- User already has a fully formed spec or requirements document
- User wants immediate code implementation (redirect to planning)
- User is asking a factual question with a definitive answer
- User wants to vent without seeking structure

## Q&A Process

### Phase 1: Discovery

Understand the seed idea without judgment.

**Goal:** Capture the raw thought in the user's words.

**Example Questions:**
- "What's on your mind right now?"
- "Can you tell me more about that initial thought?"
- "What's the core of what you're trying to achieve?"
- "Why does this idea matter to you?"

### Phase 2: Expansion

Open up possibilities and explore angles.

**Goal:** Surface dimensions the user hadn't considered.

**Example Questions:**
- "What would success look like if this worked perfectly?"
- "Who would benefit from this, and how?"
- "What are you assuming might be true here?"
- "What's the opposite perspective on this?"
- "What would you do if you had unlimited resources for this?"

### Phase 3: Structure

Identify relationships and create order.

**Goal:** Find the natural architecture within the ideas.

**Example Questions:**
- "How do these ideas connect to each other?"
- "If you had to prioritize, what comes first?"
- "What's the single most important element?"
- "What can be removed without losing the essence?"
- "Are there any dependencies between these points?"

### Phase 4: Output

Synthesize into a clear document.

**Goal:** Create a lasting artifact the user can reference.

**Example Questions:**
- "Does this summary capture what you meant?"
- "What should we call this to remember it later?"
- "What's the next step you're most excited about?"
- "Is there anything critical we missed?"

## Output Format

```markdown
# [Idea Name]

## Idea Core
*One paragraph that captures the essence of the idea.*

## Relationship Map
- **Primary Element** → leads to → **Secondary Element**
- **Key Insight** → enables → **Desired Outcome**
- *Pattern or connection observed*

## Key Insights
1. **Insight One**: What makes this significant
2. **Insight Two**: The unexpected angle
3. **Insight Three**: The actionable core

## Next Steps
- [ ] First concrete action
- [ ] Secondary consideration
- [ ] Open question to resolve

---
*Brainstormed on [date]*
```

## Anti-Patterns

| Pattern | What It Looks Like | How To Recover |
|---------|-------------------|----------------|
| **Rushing to Solutions** | Skipping discovery phase, jumping to "here's what you should do" | Pause and ask "Before we get to solutions, can you tell me more about the starting point?" |
| **Leading Questions** | "Don't you think it would be better if..." or "Have you considered..." as statements | Reframe as genuine questions: "What role does X play in your vision?" |
| **Imposing Structure** | "Let's put this in a table" or "We should organize it this way" before ideas are ready | Ask the user how they'd like to see it organized |
| **Topic Shifting** | Moving to implementation details before exploration is complete | Acknowledge the tangent: "That's interesting—let's note it and come back to it" |
| **Over-Documentation** | Writing verbose output when user wants a quick chat | Match the output format to the idea's complexity |

## Minimal Checklist

- [ ] User's initial idea is captured in their own words
- [ ] At least one assumption has been surfaced
- [ ] At least one new angle has been explored
- [ ] Key elements have been identified and named
- [ ] Relationships between elements are noted
- [ ] Output document is complete and matches user's intent
- [ ] User confirms the output is satisfactory

## Transition

When the brainstorming session is complete:

**If the user wants to proceed:**
> "Now that you have a clear picture, would you like to create a plan for implementing this? I can start a planning session."

**If the user needs time:**
> "Take this document with you. When you're ready to move forward, just ask me to help you plan."

**If the idea needs more work:**
> "Let's keep this document and revisit it when you have more information. The structure is here whenever you're ready to expand."

---


