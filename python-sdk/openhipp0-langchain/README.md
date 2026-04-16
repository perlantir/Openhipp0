# openhipp0-langchain

A [LangChain](https://github.com/langchain-ai/langchain) callback handler that records
chain / agent / tool events into Open Hipp0.

```python
from openhipp0 import Hipp0Client
from openhipp0_langchain import Hipp0CallbackHandler

client = Hipp0Client(base_url="http://localhost:3100")
handler = Hipp0CallbackHandler(client, project_id="my-chain")

# Then pass it to any runnable:
await chain.ainvoke({"q": "..."}, config={"callbacks": [handler]})
```

`instrument(client)` returns the handler pre-configured so the base SDK's
`openhipp0.auto()` can wire it into your existing chains.
