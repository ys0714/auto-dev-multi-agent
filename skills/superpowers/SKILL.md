---
name: superpowers
description: Enhance your capabilities with structured brainstorming, planning, and execution workflows. Modeled after the Superpowers plugin for Claude Co·de. Use when the user asks for "superpowers", "brainstorm", "plan", or "execute".
---

# Superpowers Skill

You now have access to the "Superpowers" methodology for disciplined software development. This framework enforces a mandatory progression: **Brainstorm → Plan → Execute**.

## 1. Brainstorming (`/superpowers:brainstorm`)

**Goal:** Explore edge cases, validate requirements, and design the solution before writing any code.

**Process:**
1.  **Ask Socratic Questions:** Don't just accept the user's request. Ask "Why?", "What if?", "Have you considered...?"
2.  **Identify Edge Cases:** proactively look for boundary conditions, error states, and security implications.
3.  **Validate Assumptions:** Confirm your understanding of the user's constraints and goals.
4.  **Draft a High-Level Design:** Propose an architecture or approach and get user buy-in.

**Example Prompt to User:**
> "Before we start coding, let's brainstorm. I have a few questions about [Feature X]..."

## 2. Planning (`/superpowers:write-plan`)

**Goal:** Break the feature into small, verifiable tasks (2-5 minutes each).

**Process:**
1.  **Create a Task List:** Break the work down into granular steps.
2.  **Define Verification Criteria:** For each step, specify *how* you will verify it works (e.g., "Run test X", "Check file Y").
3.  **Specify File Paths:** Be exact about which files will be created or modified.
4.  **Review the Plan:** Ask the user to review and approve the plan before proceeding.

**Format:**
```markdown
## Implementation Plan: [Feature Name]

1. [ ] **Step 1: [Action]**
   - Files: `path/to/file.ext`
   - Verification: [Command or Check]
2. [ ] **Step 2: [Action]**
   - ...
```

## 3. Execution (`/superpowers:execute-plan`)

**Goal:** Implement the plan step-by-step, verifying each step before moving to the next.

**Process:**
1.  **Strict Adherence:** Follow the plan exactly. Do not skip steps.
2.  **TDD (Test-Driven Development):** Write the test *before* the code whenever possible.
    - Red: Write a failing test.
    - Green: Write the minimal code to pass the test.
    - Refactor: Clean up the code.
3.  **Verify Continuously:** Run the verification step after each task.
4.  **Update Status:** Mark tasks as completed in the plan.

**Rule:** If a step fails verification, stop and fix it. Do not proceed until the current step is solid.

## Usage Triggers

- **User says:** "add-plugin superpowers" -> You have now loaded this skill. Confirm to the user that Superpowers are active.
- **User says:** "brainstorm [topic]" -> Start the Brainstorming process.
- **User says:** "plan [feature]" -> Start the Planning process.
- **User says:** "execute" -> Start the Execution process.

---
**Motto:** "Brainstorm first, plan second, code last."
