import json

import httpx
import pytest
from fastapi.testclient import TestClient

from studio import api, llm

client = TestClient(api.app)


def test_redact():
    t = llm.redact("Mail bob@corp.com, call +1 (555) 123-4567, acct 12345678, Acme Health", ["acme health"])
    assert "bob@corp.com" not in t and "12345678" not in t and "555" not in t
    assert "[REDACTED]" in t and "[EMAIL]" in t


def test_prepare_has_no_network_and_redacts(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "azure")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "SECRET")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt")
    r = client.post("/api/llm/prepare", json={"task": "bullets", "text": "mail a@b.co", "redact": True})
    body = r.json()
    assert r.status_code == 200 and body["host"] == "example.openai.azure.com"
    assert "a@b.co" not in json.dumps(body) and "SECRET" not in json.dumps(body)


def test_run_requires_provider(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert client.post("/api/llm/run", json={"task": "bullets", "text": "x"}).status_code == 409


def _mock(content):
    def handler(request: httpx.Request):
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_provider_and_parse_flow():
    p = llm.OpenAICompatible("http://localhost:11434/v1", "", "m")
    raw = p.complete([{"role": "user", "content": "x"}], _mock(
        '```json\n{"title":"T","nodes":[{"id":"n1","label":"A","kind":"start"}],"edges":[]}\n```'))
    out = llm.parse_output("flow", raw)
    assert out["nodes"][0]["id"] == "n1"


def test_bad_output_rejected():
    with pytest.raises(llm.LLMError):
        llm.parse_output("flow", '{"title":"T","nodes":[],"edges":[{"src":"a","dst":"b"}]}')
    with pytest.raises(llm.LLMError):
        llm.parse_output("assumptions", "not json")


def test_http_error_does_not_leak_body():
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(401, text="key=SECRET")))
    with pytest.raises(llm.LLMError) as e:
        llm.AzureOpenAI("https://x", "k", "d", "v").complete([], c)
    assert "SECRET" not in str(e.value)


def test_http_error_surfaces_code_and_hint_only():
    body = {"error": {"message": "prompt was: SECRET-TEXT", "type": "invalid_request_error", "code": "model_not_found"}}
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403, json=body)))
    with pytest.raises(llm.LLMError) as e:
        llm.OpenAICompatible("http://x/v1", "k", "m").complete([], c)
    text = str(e.value)
    assert "403" in text and "model_not_found" in text and "access denied" in text
    assert "SECRET-TEXT" not in text and "prompt was" not in text


def test_http_error_unsafe_code_is_dropped():
    body = {"error": {"code": "<script>alert(1)</script> sk-live-abc"}}
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429, json=body)))
    with pytest.raises(llm.LLMError) as e:
        llm.OpenAICompatible("http://x/v1", "k", "m").complete([], c)
    assert "script" not in str(e.value) and "sk-live" not in str(e.value) and "rate limit" in str(e.value)


def test_reasoning_models_get_no_temperature():
    seen = []

    def handler(request: httpx.Request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    c = httpx.Client(transport=httpx.MockTransport(handler))
    llm.OpenAICompatible("http://x/v1", "k", "gpt-5-mini").complete([], c)
    llm.OpenAICompatible("http://x/v1", "k", "gpt-4o-mini").complete([], c)
    assert "temperature" not in seen[0] and seen[1]["temperature"] == 0.2
