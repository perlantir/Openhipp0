# OpenAI Agents SDK + Open Hipp0

Ship every completed trace from the [OpenAI Agents SDK](https://github.com/openai/openai-agents-python)
to hipp0 as a decision.

## Install

```bash
pip install openhipp0-openai-agents
```

## Usage

```python
from agents import tracing
from openhipp0 import Hipp0Client
from openhipp0_openai_agents import Hipp0TraceProcessor

client = Hipp0Client(base_url="http://localhost:3100")
processor = Hipp0TraceProcessor(client)

tracing.add_trace_processor(processor)
```

Every `on_trace_end` hook fires a hipp0 decision with the trace's
`summary`/`result`/`output` (whichever is present) as the reasoning.

## Auto-instrumentation

```python
import openhipp0
openhipp0.auto()
```
