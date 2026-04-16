# openhipp0-autogen

[AutoGen](https://github.com/microsoft/autogen) integration for Open Hipp0.

```python
from openhipp0 import Hipp0Client
from openhipp0_autogen import record_message

client = Hipp0Client(base_url="http://localhost:3100")

# Wire this into AutoGen's `process_last_message` hook or reply callback:
await record_message(client, project_id="team", speaker="user_proxy", content="...")
```

Call `instrument(client)` to get a pre-bound recorder.
