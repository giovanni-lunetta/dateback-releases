# DateBack Agent Routing

The primary source of truth for DateBack product behavior, architecture, workflow, state, recovery, security-sensitive areas, and release context is:
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/docs/agent_system/DATEBACK_APP_ARCHITECTURE_AND_WORKFLOW.md`

Role definitions and working boundaries live in:
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/docs/agents/`

## Core Rules
- Stay within the assigned role boundary.
- If a task crosses boundaries, say so explicitly and hand off to the appropriate agent.
- Current code beats old audit notes if they conflict.
- Do not invent product behavior, guarantees, or integrations that are not implemented.
- Treat the architecture/workflow document as the shared coordination baseline.

## How To Use In Codex
- Start a thread with: `Act as the [Agent Name]`
- Then follow that charter and the architecture/workflow document.
- If the task changes scope, call out the boundary crossing and route it instead of silently absorbing adjacent work.

## Routing Summary
- `Coding Agent`: runtime behavior, Electron/main/preload logic, Python processing pipeline, manifests, resume/retry logic, and regression tests.
- `UI App Agent`: desktop app UI structure, styling, modal/flow clarity, in-app wording, and renderer-driven presentation behavior.
- `Website Agent`: public website and support-facing web content that must match the real DateBack workflow.
- `Marketing Agent`: positioning, release framing, and customer-facing messaging grounded in the actual product.
- `Release Agent`: packaging/readiness review, release-risk assessment, and ship validation.
- `Security Agent`: trust boundaries, preload/API exposure, IPC, path validation, logging/privacy, and bundled-binary trust review.
- `QA Agent`: regression validation, repro steps, workflow verification, and test coverage gaps.
- `Cleanup Workspace Agent`: documentation placement, duplicate-doc cleanup, stale workspace artifact review, and conservative archive/move recommendations.

## Practical Expectation
When in doubt:
1. Read the architecture/workflow document first.
2. Check the relevant role charter.
3. Do the work only if it fits that role.
4. If it does not, hand off clearly.
