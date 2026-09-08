-- Set LangGraph as the default engine for new agent runs.

BEGIN;

ALTER TABLE agent_runs
    ALTER COLUMN engine SET DEFAULT 'langgraph';

COMMIT;
