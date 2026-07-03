---
name: extreme-router-refactor
description: |
  Code refactoring, tech debt cleanup, and code review expertise for ExtremeRouter.
  Use when cleaning up code, fixing bugs, reviewing PRs, identifying tech debt,
  or when the user asks to "improve this code", "fix this mess", "why is this broken",
  "make this cleaner", or mentions code smells, duplication, or poor architecture.
---

# Code Refactoring & Review Expertise

You are an expert in identifying and resolving technical debt, code smells, and architectural issues.

## Refactoring Philosophy

**Never stop after solving the visible issue.**

Always search for:
- Root cause (not just symptoms)
- Related issues (ripple effects)
- Future problems (what will break next?)
- Architectural improvements (how to prevent this class of issue)

Think two steps ahead. Fix the problem, then fix the system that allowed the problem.

## Code Review Checklist

When reviewing code, check for:

### Correctness
- Logic errors
- Edge cases (null, undefined, empty arrays, zero values)
- Error handling (what happens when things fail?)
- Race conditions (async/await, concurrent updates)
- Data validation (trust boundaries)

### Security
- Input sanitization (SQL injection, XSS, command injection)
- Authentication/authorization checks
- Secret exposure (hardcoded keys, logs, error messages)
- CORS/CSRF protection
- Rate limiting

### Performance
- Unnecessary re-renders (React components)
- Missing memoization (expensive computations)
- N+1 queries (database access patterns)
- Missing indexes (database queries)
- Large bundle imports (tree-shaking opportunities)
- Synchronous operations that should be async

### Maintainability
- Code duplication (DRY violations)
- Magic numbers/strings (use constants)
- Deep nesting (extract functions/components)
- Long functions (>50 lines = refactor)
- Complex conditionals (extract to named variables)
- Poor naming (unclear intent)

### Architecture
- Separation of concerns (UI vs business logic)
- Dependency direction (should flow inward)
- Coupling (tight vs loose)
- Cohesion (related things together)
- Abstraction level (too high-level or too low-level)

## Refactoring Process

When refactoring existing code:

1. **Explain what's wrong** — be specific, cite code
2. **Explain why it's wrong** — impact on maintainability/performance/security
3. **Show the impact** — what happens if we don't fix it?
4. **Propose the solution** — how to improve it
5. **Rewrite it cleanly** — provide the improved code

Never just say "this is bad" without explaining why and how to fix it.

## Common Patterns in ExtremeRouter

### Shim Files (src/lib/*.js)
Many files in `src/lib/` are shims that re-export from `src/lib/db/`. These should be:
- Removed after updating all imports
- Or kept only if they provide backward compatibility value

### God Components
Large UI components (>500 lines) should be split into:
- Container component (orchestration)
- Presentational components (rendering)
- Custom hooks (state/logic extraction)

### Duplicated Logic
Look for patterns like:
- `cli-tools/*-settings/route.js` — all follow similar patterns
- `open-sse/executors/*` — many share header/URL building logic
- `open-sse/translator/request/*` and `response/*` — mirror patterns

Extract to:
- Base classes (BaseExecutor pattern)
- Shared utilities
- Registry pattern (like `open-sse/providers/registry/`)

### Console.log Pollution
343+ `console.log` calls scattered in `src/app/` and `open-sse/`. Should:
- Use structured logger (`src/sse/utils/logger.js`)
- Be conditional based on log level
- Never log secrets or sensitive data

### Parameter Explosion
Functions with many parameters (like `handleChatCore` with 22 params) should:
- Use options object pattern
- Group related params into sub-objects
- Provide sensible defaults

## Tech Debt Priorities

When multiple issues exist, prioritize:

1. **Security vulnerabilities** — fix immediately
2. **Data loss risks** — fix before release
3. **Performance bottlenecks** — fix if user-facing
4. **Maintainability issues** — fix when touching the code
5. **Code style issues** — fix opportunistically

## Code Smells to Watch For

| Smell | Symptom | Fix |
|-------|---------|-----|
| Long function | >50 lines | Extract sub-functions |
| Deep nesting | >3 levels | Early returns, extract |
| Magic numbers | `if (status === 429)` | Use constants/enums |
| Duplicate code | Copy-paste patterns | Extract utility/base class |
| God component | >500 lines | Split into smaller components |
| Feature envy | Component uses other's data | Move logic to data owner |
| Data clumps | Groups of params always together | Extract to object/class |
| Speculative generality | Unused abstractions | YAGNI — remove |

## Testing Strategy

When refactoring:
- Write tests for current behavior first (characterization tests)
- Refactor in small steps
- Run tests after each step
- Ensure coverage doesn't decrease

## Example: Refactoring Output Format

When refactoring code, structure your response as:

```
## Issues Identified
1. [issue 1 with code location]
2. [issue 2 with code location]

## Impact
[what happens if we don't fix this]

## Refactoring Plan
1. [step 1]
2. [step 2]

## Before
[original code snippet]

## After
[refactored code snippet]

## Benefits
- [benefit 1]
- [benefit 2]

## Testing Notes
[what to test, edge cases to watch]
```
