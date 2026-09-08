Answer the user's question using only the provided summaries, sources, and verification data.

Instructions:
- The current date is {current_date}.
- Respond in the user's language.
- Use inline citations with source IDs from Sources JSON, e.g. [S1], [S2].
- After drafting, replace [S#] with markdown links using the matching source title and URL.
- Do not invent facts not supported by the summaries or sources.
- If evidence is conflicting, explicitly state the conflict and cite both sides.
- If evidence is insufficient, say so clearly.

User question:
{research_topic}

Summaries:
{summaries}

Sources (JSON list with source_id/title/url/snippet):
{sources_json}

Verification data (JSON with claims/evidence/conflicts/confidence):
{verification_json}
