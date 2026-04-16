# AutoGen + Open Hipp0

Record every inter-agent message from an AutoGen conversation into
hipp0's decision graph so the multi-agent trace is searchable later.

## Install

```bash
pip install openhipp0-autogen
```

## Usage

```python
from autogen import AssistantAgent, UserProxyAgent
from openhipp0 import Hipp0Client
from openhipp0_autogen import record_message

client = Hipp0Client(base_url="http://localhost:3100")

# Wherever AutoGen calls your reply callback:
async def log_message(speaker, content):
    await record_message(client, project_id="team", speaker=speaker, content=content)
```

## Pre-bound partial

```python
from openhipp0_autogen import instrument
log = instrument(client)
await log(project_id="team", speaker="user_proxy", content="...")
```

## What gets recorded

- `title` = `"autogen: {speaker}"`
- `reasoning` = stringified message (truncated to 4000 chars)
- `made_by` = `speaker`
- `tags` = `["autogen", ...extra_tags]`
- `confidence` = `"low"` (AutoGen turns are ephemeral — upgrade manually
  when a turn becomes a lasting decision)
