import json

import httpx
import pytest

from studio import llm


def _client(*replies, seen=None):
    it = iter(replies)

    def handler(request: httpx.Request):
        if seen is not None:
            seen.append(json.loads(request.content))
        content = next(it)
        return httpx.Response(200, json={"choices": [{"message": {"content": content if isinstance(content, str) else json.dumps(content)}}]})

    return httpx.Client(transport=httpx.MockTransport(handler))


def _prov():
    return llm.OpenAICompatible("http://x/v1", "k", "gpt-4o-mini")


# ---------------------------------------------------------------- prompts
def test_context_existing_and_library_in_assumptions_prompt():
    msgs = llm.build_messages("assumptions", "bot reads mail", True, [], existing=["Test data will be provided."],
                              context="Deck: Invoice intake. In scope: standard invoices", library={"Scope": ["Scope is limited to listed SOPs."]})
    body = msgs[1]["content"]
    assert "do not repeat" in body.lower() and "- Test data will be provided." in body
    assert "Deck context" in body and "Invoice intake" in body
    assert "Style examples" in body and "Scope is limited to listed SOPs." in body


def test_context_and_existing_are_redacted():
    msgs = llm.build_messages("assumptions", "x", True, ["Acme"], existing=["Mail bob@corp.com"], context="Acme project 12345678")
    body = msgs[1]["content"]
    assert "bob@corp.com" not in body and "Acme" not in body and "12345678" not in body


def test_tobe_prompt_mentions_lanes_and_no_invented_figures():
    body = llm.build_messages("tobe", "manual process", False)[1]["content"]
    assert "lanes" in body and "never invent" in body.lower()


# ------------------------------------------------------------ post-checks
def test_assumptions_dedupe_cap_and_existing():
    items = ["Test data will be provided.", "Test data will be provided!", "The bot has read access to the mailbox.",
             "short", "UAT will have SME support each day.", "Costs follow actual infrastructure spend."]
    res, warn = llm.finalize("assumptions", {"items": items}, existing=["Test data will be provided by the client."])
    assert "Test data will be provided." not in res["items"]  # near-duplicate of existing
    assert "short" not in res["items"] and len(res["items"]) == 3
    assert warn


def test_flow_gets_start_end_and_yes_no():
    flow = {"title": "t", "nodes": [{"id": "a", "label": "Read", "kind": "bot"}, {"id": "b", "label": "Valid?", "kind": "decision"},
                                    {"id": "c", "label": "Create", "kind": "bot"}, {"id": "d", "label": "Manual", "kind": "human"}],
            "edges": [{"src": "a", "dst": "b"}, {"src": "b", "dst": "c"}, {"src": "b", "dst": "d"}]}
    res, warn = llm.finalize("flow", flow, "x")
    kinds = [n["kind"] for n in res["nodes"]]
    assert kinds[0] == "start" and kinds[-1] == "end"
    labels = {(e["src"], e["dst"]): e["label"] for e in res["edges"]}
    assert labels[("b", "c")] == "Yes" and labels[("b", "d")] == "No"
    assert any("Start" in w for w in warn) and any("End" in w for w in warn)


def test_flow_rejects_orphans_duplicates_and_too_many():
    base = {"title": "t", "nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}, {"id": "z", "label": "Z"}],
            "edges": [{"src": "a", "dst": "b"}]}
    with pytest.raises(llm.LLMValidationError, match="connected"):
        llm.finalize("flow", base)
    with pytest.raises(llm.LLMValidationError, match="unique"):
        llm.finalize("flow", {"title": "t", "nodes": [{"id": "a", "label": "A"}, {"id": "a", "label": "B"}], "edges": []})
    many = {"title": "t", "nodes": [{"id": f"n{i}", "label": str(i)} for i in range(15)],
            "edges": [{"src": f"n{i}", "dst": f"n{i+1}"} for i in range(14)]}
    with pytest.raises(llm.LLMValidationError, match="at most 14"):
        llm.finalize("flow", many)


def test_tobe_requires_lanes_and_strips_invented_figures():
    nodes = [{"id": "a", "label": "Read", "kind": "bot", "lane": "RPA Bot"},
             {"id": "b", "label": "Extract", "kind": "ai", "lane": "RPA Bot"},
             {"id": "c", "label": "Check", "kind": "human", "lane": "Analyst"}]
    edges = [{"src": "a", "dst": "b", "note": "~90% success"}, {"src": "b", "dst": "c", "note": "~60-70% success expected"}]
    res, warn = llm.finalize("tobe", {"title": "t", "lanes": ["RPA Bot", "Analyst"], "nodes": nodes, "edges": edges},
                             source_text="We expect about 60-70% to succeed")
    notes = {(e["src"], e["dst"]): e["note"] for e in res["edges"]}
    assert notes[("a", "b")] == "" and notes[("b", "c")] == "~60-70% success expected"
    assert res["lanes"] == ["RPA Bot", "Analyst"] and any("Removed arrow tag" in w for w in warn)
    with pytest.raises(llm.LLMValidationError, match="lanes"):
        llm.finalize("tobe", {"title": "t", "nodes": [{"id": "a", "label": "A"}], "edges": []})


# ------------------------------------------------------------ repair retry
def test_repair_retry_once_then_success():
    seen: list = []
    bad = {"items": ["too short"]}
    good = {"items": ["The bot has read access to the shared mailbox.", "UAT is supported by SMEs daily.",
                      "Test data and lower environments are provided."]}
    res, _ = llm.run_task(_prov(), "assumptions", "x", client=_client(bad, good, seen=seen))
    assert len(res["items"]) == 3 and len(seen) == 2
    retry_msgs = seen[1]["messages"]
    assert retry_msgs[-1]["role"] == "user" and "rejected" in retry_msgs[-1]["content"]
    assert retry_msgs[-2]["role"] == "assistant"


def test_repair_retry_gives_up_after_one_retry():
    with pytest.raises(llm.LLMValidationError):
        llm.run_task(_prov(), "assumptions", "x", client=_client({"items": []}, {"items": []}))


def test_http_errors_are_not_retried():
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(401, json={})))
    with pytest.raises(llm.LLMError) as e:
        llm.run_task(_prov(), "assumptions", "x", client=c)
    assert not isinstance(e.value, llm.LLMValidationError)


# ----------------------------------------------------- response_format fallback
def test_falls_back_without_response_format_on_400():
    calls = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        calls.append("response_format" in body)
        if "response_format" in body:
            return httpx.Response(400, json={"error": {"code": "invalid_request"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    out = llm.OpenAICompatible("http://x/v1", "k", "local-model").complete([], httpx.Client(transport=httpx.MockTransport(handler)))
    assert out == "{}" and calls == [True, False]


def test_decision_only_lane_is_merged_into_actor_lane():
    nodes = [{"id": "a", "label": "Extract", "kind": "ai", "lane": "RPA Bot"},
             {"id": "b", "label": "Valid?", "kind": "decision", "lane": "Decision"},
             {"id": "c", "label": "Fix", "kind": "human", "lane": "Analyst"},
             {"id": "d", "label": "Create", "kind": "bot", "lane": "RPA Bot"}]
    edges = [{"src": "a", "dst": "b"}, {"src": "b", "dst": "c", "label": "No"}, {"src": "b", "dst": "d", "label": "Yes"}]
    res, warn = llm.finalize("tobe", {"title": "t", "lanes": ["RPA Bot", "Decision", "Analyst"], "nodes": nodes, "edges": edges}, "x")
    lanes = {n["id"]: n["lane"] for n in res["nodes"] if n["id"] in "abcd"}
    assert lanes["b"] == "RPA Bot" and "Decision" not in res["lanes"]
    assert any('Removed lane "Decision"' in w for w in warn)


def test_warns_when_stated_success_rate_is_not_placed_and_on_duplicate_branches():
    nodes = [{"id": "a", "label": "Extract", "kind": "ai", "lane": "RPA Bot"},
             {"id": "b", "label": "Valid?", "kind": "decision", "lane": "RPA Bot"},
             {"id": "c", "label": "Fix", "kind": "human", "lane": "Analyst"},
             {"id": "d", "label": "Escalate", "kind": "human", "lane": "Analyst"}]
    edges = [{"src": "a", "dst": "b"}, {"src": "b", "dst": "c", "label": "No"}, {"src": "b", "dst": "d", "label": "No"}]
    _, warn = llm.finalize("tobe", {"title": "t", "lanes": ["RPA Bot", "Analyst"], "nodes": nodes, "edges": edges},
                           "Expected success is about 60-70% for record creation.")
    assert any("60-70%" in w and "no arrow carries it" in w for w in warn)
    assert any("same label" in w for w in warn)
    # no warning when the tag is present
    edges[1]["note"] = "~60-70% success expected"
    _, warn2 = llm.finalize("tobe", {"title": "t", "lanes": ["RPA Bot", "Analyst"], "nodes": nodes, "edges": edges},
                            "Expected success is about 60-70% for record creation.")
    assert not any("no arrow carries it" in w for w in warn2)
