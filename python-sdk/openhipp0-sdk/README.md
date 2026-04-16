# openhipp0-sdk

Base Python client for [Open Hipp0](https://github.com/openhipp0/openhipp0).

```python
from openhipp0 import Hipp0Client

client = Hipp0Client(base_url="http://localhost:3100")

await client.decisions.create(
    project_id="demo",
    title="Use Postgres for production",
    reasoning="pgvector is needed for scale",
    made_by="architect",
    confidence="high",
)

hits = await client.memory.search(project_id="demo", query="postgres")
```

See the [monorepo README](../README.md) for the full package list.
