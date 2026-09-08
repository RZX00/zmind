# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚨 CRITICAL RESTRICTIONS - READ FIRST! 🚨

**⚠️ NEVER EXECUTE THESE COMMANDS ⚠️**

Claude Code must **NEVER** run the following commands:
- `npm run dev` - Do NOT start the development server
- `npm run build` - Do NOT run the build process
- `npm run start` - Do NOT start the production server
- `python api.py` - Do NOT start the backend server
- `python start.py` - Do NOT start the platform
- `docker-compose up` - Do NOT start Docker services
- Any server startup or build commands

**✅ ALLOWED COMMANDS (WITH USER PERMISSION):**
- `npm run lint` - Code linting only (ASK USER FIRST)
- `npm run format` - Code formatting only (ASK USER FIRST)
- `uv run pytest` - Running tests only (ASK USER FIRST)
- File operations (read, write, edit)
- Search and analysis operations

**⚠️ IMPORTANT: Even for allowed commands, ALWAYS ask the user for permission before executing any command that could modify the system or run processes. Never assume permission - always confirm first!**

**These restrictions exist to prevent system resource conflicts and maintain stability.**

## Project Overview

Zmind is an open-source platform for building, managing, and training AI agents. The flagship agent "Zmind" demonstrates the platform's capabilities as a generalist AI worker. This is a full-stack application with:

- **Frontend**: Next.js 15 with TypeScript, Tailwind CSS, shadcn/ui components
- **Backend**: Python 3.11+ with FastAPI, Supabase integration, Redis caching
- **Agent Runtime**: Docker-based isolated execution environments
- **Database**: Supabase (PostgreSQL) with Row Level Security

## Development Commands

### Frontend (Next.js)
```bash
cd frontend
npm run dev          # Start development server with Turbopack
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # ESLint code linting
npm run format       # Prettier code formatting
npm run format:check # Check formatting without changes
```

### Backend (Python)
```bash
cd backend
python api.py        # Start FastAPI development server
uv run python api.py # Alternative using uv
uv run pytest       # Run tests
python -m black .    # Format code with Black
python run_tests.py  # Run comprehensive test suite
```

### Docker Environment
```bash
python setup.py      # Interactive setup wizard (recommended)
python start.py      # Start the entire platform
docker-compose up    # Start services manually
```

### Agent Execution
- Agent execution environments using Docker containers
- Browser automation capabilities via MCP (Model Context Protocol)
- Isolated execution environments for security and scalability
- Tool execution system with structured responses and error handling

## Architecture Overview

### Frontend Structure (`frontend/src/`)
- `app/` - Next.js App Router pages and API routes
- `components/` - Reusable React components (uses shadcn/ui)
- `lib/` - Utilities, database clients, and configurations
- `hooks/` - Custom React hooks
- `providers/` - React context providers
- `contexts/` - React context definitions

### Backend Structure (`backend/`)
- `core/` - Core agent functionality and services
  - `agent_*.py` - Agent CRUD operations, runs, tools, and services
  - `tools/` - Agent tool implementations and registry
  - `services/` - Business logic services (billing, transcription, etc.)
  - `api_models/` - Pydantic models for API requests/responses
  - `auth.py` - Authentication and JWT handling
  - `utils/` - Shared utilities and configurations
  - `langgraph_engine/` - LangGraph runtime, tool registry, and execution nodes
  - `mcp_module/` - MCP (Model Context Protocol) integration
- `billing/` - Billing and subscription management
- `admin/` - Administrative functions and user management
- `services/` - External service integrations
- `supabase/` - Database migrations and configurations

### Key Technologies

**Frontend Stack:**
- Next.js 15+ with App Router and Turbopack
- TypeScript with strict configuration
- Tailwind CSS for styling
- shadcn/ui as the primary component library
- Radix UI primitives for accessibility
- TanStack Query for server state management
- React Hook Form with Zod for form validation

**Backend Stack:**
- FastAPI with async/await patterns
- Supabase for database, authentication, and real-time features
- Redis for caching and session management
- LiteLLM for multi-provider LLM integration
- Dramatiq for background job processing
- Docker for agent execution isolation

**Agent System:**
- Tool-based architecture with `AgentBuilderBaseTool` base class
- Dual schema decorators (OpenAPI + XML) for tool definitions
- OpenAPI schema definitions for tool registration
- Isolated Docker environments per agent instance
- MCP (Model Context Protocol) integration for external tool support
- Versioning system with `agent_versions` table
- Workflow management with `agent_workflows`
- File system access and code execution capabilities

## Development Patterns

### Component Development
- Use shadcn/ui components as defaults
- Follow component composition patterns from Radix UI
- Implement proper TypeScript interfaces
- Use `cn()` utility for conditional CSS classes

### API Development
- All endpoints should use Pydantic models for request/response validation
- Implement proper error handling with structured responses
- Use dependency injection for database connections and authentication
- Follow REST conventions for endpoint naming

### Database Integration
- Use Supabase client for database operations
- Implement Row Level Security (RLS) policies
- Follow migration patterns in `backend/supabase/migrations/`
- Use proper indexing for performance

### Agent Tool Development
- Extend `AgentBuilderBaseTool` or `Tool` base classes
- Use `@openapi_schema` decorator for tool definitions
- Return `ToolResult` objects with success/failure states
- Handle errors gracefully with user-friendly messages
- Use `AgentBuilderToolRegistry` pattern for registering tools
- Follow `MCPToolWrapper` patterns for external tool integration
- Use structured logging with context throughout tool execution

### Authentication
- JWT tokens validated without signature verification (Supabase pattern)
- User context available via dependency injection
- Implement proper role-based access control

## Testing and Quality

### Running Tests
```bash
# Backend tests
cd backend && uv run pytest

# Frontend linting and type checking
cd frontend && npm run lint
cd frontend && npm run build  # Includes type checking
```

### Code Quality Tools
- Backend: Black for formatting, type hints required, async/await patterns
- Frontend: ESLint + Prettier for linting and formatting
- TypeScript strict mode enabled throughout
- Use `uv` for Python package management and dependency resolution
- Structured logging with `structlog` for comprehensive observability

## Environment Setup

The project uses a setup wizard (`python setup.py`) that configures:
- Supabase project and database with Row Level Security
- LLM provider API keys (OpenAI, Anthropic, etc.) via LiteLLM
- Search capabilities (Tavily, Firecrawl)
- Redis for caching and session management
- QStash for background jobs
- MCP (Model Context Protocol) credentials for external tools
- Credential encryption using Fernet for sensitive data

Essential environment variables are defined in `.env.example` files in each directory.

## Deployment

- Frontend and backend have separate Dockerfiles
- Docker Compose configurations for different environments
- Uses `mise.toml` for tool version management
- Health checks implemented for service monitoring

## Key Dependencies

- **Agent Execution**: MCP protocol, Docker containers, tool orchestration
- **LLM Integration**: `litellm`, `openai`, `langfuse` for observability
- **Web Automation**: `tavily-python`, `beautifulsoup4`
- **Database**: `supabase` for PostgreSQL, authentication, real-time features
- **Background Processing**: `dramatiq`, `redis`, `qstash`
- **Development Tools**: `uv` for Python packages, `structlog` for logging
- **Security**: `cryptography` for credential encryption, JWT validation
- **Monitoring**: `sentry-sdk`, `prometheus-client`, Langfuse tracing

## Important Development Guidelines

### Type Safety Requirements
- Use TypeScript strictly on frontend - avoid `any` types
- Comprehensive Python type hints for all functions and classes
- Use `typing.Protocol` for interface definitions
- Leverage modern TypeScript features like `satisfies` operator

### Performance and Resource Management
- Use async/await patterns consistently for I/O operations
- Implement proper connection pooling for database and external APIs
- Use Redis caching for frequently accessed data
- Implement proper timeout handling and resource cleanup

### Security Best Practices
- Input validation using Pydantic models for all user inputs
- Credential encryption for sensitive API keys using Fernet
- Row Level Security (RLS) implementation for all user-accessible tables
- JWT validation following Supabase patterns (no signature verification)

### Tool and Agent Architecture
- Use dual schema decorators (OpenAPI + XML) for tool definitions
- Implement structured error responses with ToolResult objects
- Follow AgentBuilderToolRegistry patterns for tool registration
- Use MCPToolWrapper for external tool integration
