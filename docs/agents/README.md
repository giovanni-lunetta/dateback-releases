# DateBack Agent System Overview

## Overview
This folder defines the working boundaries for specialized agents on the DateBack project.

The goal is simple:
- keep different kinds of work separated
- reduce overlap and ownership confusion
- make hand-offs explicit when a task crosses product, UI, runtime, security, QA, or release boundaries

These agents are meant to support the current DateBack app as it exists today, not an imagined future version of the product.

## Shared Source of Truth
The shared source of truth for all agents is:
- `/Users/giovanni-lunetta/DateBack_Business/DateBack_App_Source/DATEBACK_APP_ARCHITECTURE_AND_WORKFLOW.md`

That document defines:
- the current product model
- the Electron/Python architecture
- the Computer mode and Cloud mode workflows
- the persistence and recovery model
- the current UI state model
- testing, release, and security-sensitive areas

Agents should start there before acting. If an older audit note conflicts with that document or with current code, the architecture/workflow doc and current code win.

## Agent Directory
- `CODING_AGENT_CHARTER.md`: owns runtime behavior, Electron logic, Python pipeline logic, and regression tests.
- `UI_APP_AGENT_CHARTER.md`: owns desktop app UI structure, styling, modal/flow clarity, and in-app presentation behavior.
- `WEBSITE_AGENT_CHARTER.md`: owns public website and support-facing web content that must match the current app.
- `MARKETING_AGENT_CHARTER.md`: owns positioning, release framing, and customer-facing messaging without overstating capabilities.
- `RELEASE_AGENT_CHARTER.md`: owns packaging/readiness review, ship-risk assessment, and release validation.
- `SECURITY_AGENT_CHARTER.md`: owns trust-boundary, IPC, path-validation, logging/privacy, and bundled-binary security review.
- `QA_AGENT_CHARTER.md`: owns regression coverage, repro steps, and workflow validation across high-risk user flows.

## When to Use Which Agent
Use the Coding Agent when the task changes real app behavior or test coverage.

Use the UI App Agent when the task is about the desktop app's flow, hierarchy, wording, visibility, or interaction clarity, but not a backend contract redesign.

Use the Website Agent when public-facing website or help content must reflect the real DateBack workflow.

Use the Marketing Agent when the work is about messaging, positioning, release summaries, or customer-facing explanation.

Use the Release Agent when the task is about packaging, ship readiness, release risk, versioning drift, or pre-release validation.

Use the Security Agent when the task touches renderer/main trust boundaries, preload exposure, IPC, filesystem/path controls, logging privacy, or bundled binary trust.

Use the QA Agent when the task is about validating behavior, reproducing bugs, building regression matrices, or confirming edge-case workflow coverage.

## Hand-off Rules
Hand off from Coding Agent to UI App Agent when the underlying behavior is correct and the remaining issue is presentation, copy, or flow clarity.

Hand off from UI App Agent to Coding Agent when the apparent UI issue is actually caused by runtime state, manifest logic, IPC behavior, or backend processing.

Hand off from Website Agent or Marketing Agent to Coding Agent when external messaging reveals a real mismatch between product claims and implementation.

Hand off from Release Agent to Coding Agent when a release blocker is caused by runtime behavior instead of packaging or process.

Hand off to Security Agent when a task materially affects trust boundaries, path validation, logging/privacy, or packaged-binary assumptions.

Hand off to QA Agent when a risky change needs scenario validation, repro confirmation, or manual regression coverage.

Hand off from QA Agent to the owning implementation agent with exact repro steps, expected behavior, and actual behavior.

## Common Workflows
### Bug fix in Computer mode or Cloud mode
1. Start with the Coding Agent.
2. Hand off to Security Agent if the change touches IPC, paths, logs, or binary trust.
3. Hand off to UI App Agent if the remaining work is only copy, visibility, or interaction clarity.
4. Finish with QA Agent for regression validation.

### Desktop workflow or modal cleanup
1. Start with the UI App Agent.
2. Hand off to Coding Agent if the issue depends on runtime behavior or persisted state.
3. Finish with QA Agent for setup/progress/completion-state verification.

### Public explanation or website update
1. Start with the Website Agent or Marketing Agent, depending on whether the task is factual workflow explanation or broader positioning.
2. Hand off to Coding Agent or UI App Agent if the content exposes a product mismatch.
3. Hand off to Release Agent if the content is tied to a specific shipment.

### Release preparation
1. Start with the Release Agent.
2. Hand off to Coding Agent for runtime blockers.
3. Hand off to Security Agent for trust-sensitive release concerns.
4. Finish with QA Agent for manual smoke verification.
5. Hand off to Marketing Agent or Website Agent for external release communication.

### Security-sensitive change review
1. Start with the Security Agent.
2. Hand off to Coding Agent for implementation changes.
3. Finish with QA Agent for regression confirmation.
4. In release windows, involve the Release Agent before shipping.

## Notes
- DateBack has several concepts that are easy to confuse: `outputDir`, processed output root, staging folder, and synced cloud destination. Agents should preserve those distinctions.
- Completed underfilled batches can be valid. Agents should not treat that as a bug unless the underlying workflow contract is actually being violated.
- Cloud mode still depends on a real local processing root even though the visible main flow emphasizes the synced destination.
- The architecture/workflow document is the coordination baseline. The charter files in this folder define ownership on top of that baseline.
