# Backend Testing Guide

## Overview

The backend uses `pytest` with configuration in `backend/pytest.ini`.

Default discovery behavior:

- `uv run pytest` (no args) runs tests under `backend/tests` only (see `testpaths`).
- `./test` (or `uv run python run_tests.py`) finds all `test_*.py` and `*.test.py` files under `backend/`, including colocated tests.

## Test Organization

- Test filenames: `test_*.py` or `*.test.py`.
- Primary location: `backend/tests/`.
- Colocated tests exist for some modules (example: `backend/core/canvas/test_canvas_models.py`).

## Running Tests

### Quick Start (from `backend/`)

```bash
# Run all tests (all matching files under backend/)
./test

# Run only tests under backend/tests (pytest defaults)
uv run pytest

# Run only unit tests (fast, no external dependencies)
./test --unit

# Run integration tests
./test --integration

# Run LLM tests (requires API keys)
./test --llm

# Run tests in a specific path
./test --path tests
./test --path core/canvas

# Stop on first failure
./test -x
```

### Using Python directly

```bash
# Run the test runner
uv run python run_tests.py

# See all options
uv run python run_tests.py --help
```

### Using pytest directly

```bash
# Run all default tests (backend/tests)
uv run pytest

# Run a specific test file
uv run pytest tests/test_skills_import.py
uv run pytest core/canvas/test_canvas_models.py

# Run with specific marker
uv run pytest -m unit
uv run pytest -m integration
uv run pytest -m llm
```

## Test Markers

Tests are marked with categories:

- `@pytest.mark.unit` - Fast unit tests with no external dependencies
- `@pytest.mark.integration` - Integration tests that may require database/services
- `@pytest.mark.llm` - Tests that make real LLM API calls (costs money!)
- `@pytest.mark.api` - API endpoint tests
- `@pytest.mark.slow` - Slow tests
- `@pytest.mark.asyncio` - Async tests (automatically handled)

## Writing Tests

### Basic Test Structure

```python
import pytest
from core.services.llm import some_function

class TestLLMFeature:
    """Test suite for LLM features."""

    @pytest.fixture
    def setup_data(self):
        """Fixture to set up test data."""
        return {"key": "value"}

    @pytest.mark.unit
    def test_basic_functionality(self, setup_data):
        """Test basic functionality."""
        result = some_function(setup_data)
        assert result is not None

    @pytest.mark.asyncio
    @pytest.mark.llm
    async def test_llm_call(self):
        """Test real LLM API call."""
        response = await make_llm_api_call(...)
        assert response.choices[0].message.content
```

### Test File Naming

- Use `test_*.py` or `*.test.py`
- Prefer `backend/tests/` for new tests; colocate only when needed
- Keep tests close to the code they test

## Coverage

Coverage is enabled by default via `backend/pytest.ini`:

- Terminal output shows missing lines
- HTML report: `htmlcov/index.html`
- XML report: `coverage.xml`
- Minimum coverage: 60%

`./test --coverage` keeps the same reports when using the test runner.

## Environment Variables

For LLM tests, set these environment variables:

```bash
export ANTHROPIC_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
export DEEPSEEK_API_KEY="your-key"
```

## CI/CD Integration

The test runner returns proper exit codes:
- 0: All tests passed
- 1: Test failures

Example GitHub Actions:

```yaml
- name: Run tests
  run: |
    cd backend
    ./test --unit --coverage
```

## Troubleshooting

### Tests not discovered

- Ensure file name matches `test_*.py` or `*.test.py`
- If using `uv run pytest` with no args, only `backend/tests` is searched
- Run from backend directory
- Ensure file is not in `.venv` or `__pycache__`
- Verify proper Python syntax

### Import errors

- Run from backend directory
- Ensure dependencies are installed: `uv sync`

### API tests failing

- Check API keys are set
- Verify you have credits/quota
- Use `--unit` to skip API tests

## Best Practices

1. **Write tests near code** - Prefer `backend/tests/`, colocate only when necessary
2. **Use markers** - Categorize tests with appropriate markers
3. **Mock external services** - Use mocks for unit tests
4. **Test edge cases** - Don't just test happy paths
5. **Keep tests fast** - Unit tests should run in milliseconds
6. **Use fixtures** - Share setup code between tests
7. **Assert specific things** - Make assertions clear and specific
