# openhipp0-openai-agents

[OpenAI Agents SDK](https://github.com/openai/openai-agents-python) integration for Open Hipp0.

Forwards each completed agent trace into hipp0 as a decision + session row,
so the decision graph captures everything your agents have done.

```python
from openhipp0 import Hipp0Client
from openhipp0_openai_agents import Hipp0TraceProcessor

client = Hipp0Client(base_url="http://localhost:3100")

# Register the processor with the Agents SDK's tracing system:
from agents import tracing
tracing.add_trace_processor(Hipp0TraceProcessor(client))
```
