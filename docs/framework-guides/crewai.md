# CrewAI + Open Hipp0

Record every CrewAI task outcome as a decision in the Hipp0 decision graph.

## Install

```bash
pip install openhipp0-crewai
```

## Usage

```python
from crewai import Agent, Task, Crew
from openhipp0 import Hipp0Client
from openhipp0_crewai import Hipp0CrewCallback

hipp0 = Hipp0Client(base_url="http://localhost:3100")
cb = Hipp0CrewCallback(hipp0, project_id="my-crew")

researcher = Agent(role="Researcher", goal="...", backstory="...")

task = Task(
    description="Research the best embedding provider.",
    agent=researcher,
    callback=cb,          # ← every TaskOutput becomes a hipp0 decision
)

crew = Crew(agents=[researcher], tasks=[task], task_callback=cb)
crew.kickoff()
```

`cb` is fire-and-forget — the HTTP request to hipp0 happens in the
background so your crew runs at full speed.

## One-line auto-instrumentation

```python
import openhipp0
openhipp0.auto()   # hooks every installed integration, CrewAI included
```

`auto()` returns the callback; plug it into `Crew(..., task_callback=cb)`
explicitly when you instantiate the crew (CrewAI has no process-wide hook).

## What gets recorded

Each invocation generates a decision with:
- `title` = `TaskOutput.description` or first 100 chars of the string form
- `reasoning` = `TaskOutput.raw` (or `.result`, or `str(output)`)
- `made_by` = `"crewai"` (override via `agent_id` parameter)
- `tags` = `["crewai", "task"]`
- `confidence` = `"medium"`

## Troubleshooting

- **Callback never fires:** CrewAI calls task callbacks with a
  `TaskOutput` object. Check `hipp0` server logs — the most common issue
  is an unreachable `base_url`.
- **Pydantic validation errors:** the server response shape is versioned.
  Pin `openhipp0-sdk` to a known-good version.
