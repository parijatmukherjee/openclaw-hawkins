---
name: vision-agent-skill
description: Vision-capable agent for image analysis, screenshot interpretation, OCR, and visual tasks. Uses kimi-k2.5 for its vision capabilities (text+image input, 125k context).
---

# Vision Agent

## Purpose
Specialized agent for tasks requiring image understanding and visual analysis.

## When to Use
Spawn this agent when the task involves:
- Analyzing screenshots or images
- Reading text from images (OCR)
- Interpreting charts, graphs, or diagrams
- Visual debugging (UI layouts, error screenshots)
- Image comparison or quality assessment
- Any task where "seeing" the image matters

## Model
- **Primary:** `ollama/kimi-k2.5:cloud` (text+image, 125k context)
- **Why:** kimi-k2.5 is vision-capable via Ollama cloud. It can accept image inputs and analyze them.

## Data handling (read first)
Images and screenshots are sent to a **cloud-hosted** vision model — they leave
this host. Screenshots in particular routinely contain **sensitive data**:
credentials or tokens on screen, API keys, personal/customer information, internal
URLs and hostnames, or private messages. Before sending an image:
- Confirm the operator is OK with this specific image going to the cloud model.
- Prefer redacting or cropping out anything sensitive that isn't needed for the task.
- Never upload an image solely to extract a secret from it.

## How to Spawn

```python
sessions_spawn(
    task="[VISION] Analyze this screenshot and tell me what's wrong with the layout",
    mode="run",
    model="ollama/kimi-k2.5:cloud",
    timeoutSeconds=300
)
```

## Task Prefix
Always prefix vision tasks with `[VISION]` so the Nexus routes them correctly:
- `[VISION]` — Image analysis, screenshot reading, visual tasks → routes to `vision-agent`

## Examples

```python
# Analyze a screenshot
sessions_spawn(
    task="[VISION] Look at this screenshot and identify any UI errors or layout issues",
    mode="run"
)

# Read text from image
sessions_spawn(
    task="[VISION] Extract all text from this image and format it as markdown",
    mode="run"
)

# Compare images
sessions_spawn(
    task="[VISION] Compare these two screenshots and list the differences",
    mode="run"
)
```

## Communication
- The Nexus stays conversational
- Acknowledge before spawning: "I'll delegate this image analysis to the vision agent."
- Synthesize results when complete
