import asyncio
from core.services.llm import make_llm_api_call

async def main():
    msgs = [
        {"role": "system", "content": "You are a concise assistant."},
        {"role": "user", "content": "ping"},
    ]
    try:
        await make_llm_api_call(messages=msgs, model_name="habitat/claude-sonnet-4-6", temperature=0, max_tokens=16)
        print("OK-no-tools")
    except Exception as e:
        print("FAIL-no-tools", type(e), e)

    tools = [
        {
            "type": "function",
            "function": {
                "name": "noop",
                "description": "no-op",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        }
    ]
    try:
        await make_llm_api_call(messages=msgs, model_name="habitat/claude-sonnet-4-6", temperature=0, max_tokens=16, tools=tools, tool_choice="auto")
        print("OK-with-tools")
    except Exception as e:
        print("FAIL-with-tools", type(e), e)

asyncio.run(main())
