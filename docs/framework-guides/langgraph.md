# LangGraph + Open Hipp0

Persist graph state at every node as decisions in the Hipp0 graph, so
future runs can recall how prior graphs evolved.

## Install

```bash
pip install openhipp0-langgraph
```

## Usage

```python
from langgraph.graph import StateGraph
from openhipp0 import Hipp0Client
from openhipp0_langgraph import record_checkpoint

client = Hipp0Client(base_url="http://localhost:3100")

async def plan_node(state):
    new_state = {**state, "plan": "scrape then summarize"}
    await record_checkpoint(client, project_id="my-graph", node="plan", state=new_state)
    return new_state

graph = StateGraph(State)
graph.add_node("plan", plan_node)
# ...
```

## Pre-bound helper

```python
from openhipp0_langgraph import instrument

record = instrument(client)     # partial with client pre-bound
await record(project_id="my-graph", node="plan", state=new_state)
```

## What gets recorded

Each checkpoint generates a decision:
- `title` = `"checkpoint: {node}"`
- `reasoning` = JSON-serialized state (truncated to 4000 chars)
- `made_by` = `"langgraph"`
- `tags` = `["langgraph", "checkpoint", <node>]`
- `confidence` = `"medium"`
