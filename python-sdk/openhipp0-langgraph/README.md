# openhipp0-langgraph

[LangGraph](https://github.com/langchain-ai/langgraph) integration for Open Hipp0.

```python
from openhipp0 import Hipp0Client
from openhipp0_langgraph import record_checkpoint

client = Hipp0Client(base_url="http://localhost:3100")

# Inside a LangGraph node:
await record_checkpoint(
    client,
    project_id="my-graph",
    node="plan",
    state={"plan": "scrape then summarize"},
)
```

`instrument(client)` currently returns a partial that wraps the helper with
a pre-bound client for use from anywhere in the graph.
