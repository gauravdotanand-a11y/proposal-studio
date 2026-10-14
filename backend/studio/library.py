"""Reusable assumption library (generic, no client data)."""

LIBRARY: dict[str, list[str]] = {
    "Scope": [
        "The automation scope is limited to the SOPs listed in the in-scope section only.",
        "Nested / non-nested SOPs not listed are out of scope for the current implementation.",
        "Cases outside the defined criteria will be routed to manual review.",
    ],
    "Data & Integration": [
        "The bot retrieves details from the agreed data source and creates records in the target application.",
        "Extracted data (OCR / GenAI) will be provided by the data team for processing.",
        "APIs and mainframe access will be made available; otherwise UI automation will be used.",
    ],
    "Exception handling": [
        "Unhandled validation errors from the target system move the record to the manual queue.",
        "When a record needs routing, the bot only handles routing; further processing is manual.",
    ],
    "Environment & Access": [
        "Test data and access to lower environments will be provided, fully synchronized across applications in scope.",
        "User IDs (NUIDs) with production access will be provided.",
        "Developers will be granted access to all relevant applications during development readiness.",
    ],
    "Delivery": [
        "Effort is based on the high-level understanding and may be reassessed after BRD sign-off.",
        "Adequate SME time will be provided during BRD creation; BRD sign-off aligns with the project plan.",
        "UAT follows the agreed plan with daily feedback and support from SMEs.",
        "Phases executed in parallel require simultaneous SME involvement.",
    ],
    "Cost": [
        "Infrastructure and bot licence costs are based on actual expenses; an approximate cost is considered.",
        "Production deployment dates may change per the peak-season calendar.",
    ],
}
