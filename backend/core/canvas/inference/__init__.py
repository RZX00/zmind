"""Canvas thinking-layer inference core.

Deterministic, LLM-free primitives the AI inference layer builds on: graph diagnostics
(``diagnostics``) and the propose-don't-impose suggestion model + op compilation
(``suggestions``). Pure / stdlib + canvas op-contract only — offline unit-testable, no
dependency on the agent runtime or any running service.

Capture-first invariant: nothing here ever asks the user to classify anything. Roles
(claim/evidence/...) are read ONLY from AI-derived ``node.metadata.role`` and are never a
user-authored or user-editable field; suggestions are accept/ignore proposals, never
forced mutations.
"""
