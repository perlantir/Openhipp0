# LangChain + Open Hipp0

Forward chain / tool / agent events from LangChain into hipp0's decision graph.

## Install

```bash
pip install openhipp0-langchain
```

## Usage

```python
from langchain_core.runnables import RunnableLambda
from openhipp0 import Hipp0Client
from openhipp0_langchain import Hipp0CallbackHandler

client = Hipp0Client(base_url="http://localhost:3100")
handler = Hipp0CallbackHandler(client, project_id="my-chain")

# Pass through `config`:
await chain.ainvoke({"q": "..."}, config={"callbacks": [handler]})
```

## Hooks implemented

- `on_chain_end(outputs)`
- `on_tool_end(output)`
- `on_agent_finish(finish)`

Each fires a decision tagged with `langchain` + the event type. The
callback is async-safe: it schedules the hipp0 POST on the running event
loop; if there isn't one (rare, sync context), it creates a short-lived loop.

## Auto-instrumentation

```python
import openhipp0
openhipp0.auto()        # returns the list of picked-up integrations
```
