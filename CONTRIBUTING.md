# Contributing to Zmind

Thank you for improving Zmind. By submitting a contribution, you agree that
it is licensed under [Apache-2.0](LICENSE).

```text
Issue or discussion -> Focused pull request -> Maintainer review -> Release
```

## Before you start

1. Read `LICENSE`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`.
2. Open an issue before making a large architectural or product change.
3. Do not include credentials, private data, copied proprietary code, or
   generated dependency caches.

## Development setup

```bash
python setup.py
docker compose up -d --build
```

See [the self-hosting guide](docs/SELF-HOSTING.md),
[backend development notes](backend/README.md), and
[frontend development notes](frontend/README.md) for component-specific setup.

## Contribution workflow

1. Fork the repository and create a focused branch.
2. Implement the change with appropriate tests and documentation.
3. Sign every commit with `git commit -s` to certify the Developer Certificate
   of Origin (DCO).
4. Run the relevant validation locally.
5. Open a pull request using the repository template.

The DCO sign-off is a statement that you have the right to submit the change;
it does not transfer ownership of your contribution.

## Validation

```bash
cd backend && uv run pytest -q
cd frontend && npm run lint && npm run type-check && npm run build
cd apps/mobile && npm run lint
```

## Security

Do not report vulnerabilities in public issues. Follow `SECURITY.md` instead.
