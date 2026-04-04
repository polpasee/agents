## Approach

- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.


## Standard workflow for code changes:

1. **Plan First** brainstormin and plan the change then separate tasks and assign to agents
2. **Implement** Implement the change
3. **Prove it works** Prove it works — run tests, check logs, demonstrate correctness. Never claim complete without evidence. No temporary fixes.
4. **Update Documentation** Update README.md or Related Documents
5. **Git Commit** git: commit with Message and push

## Sub-Agents Execution for Complex Tasks:

For any Involving multiple steps or components, break down the task into sub-tasks and assign to specialized agents (e.g., Testing Agent, Documentation Agent) to execute in parallel. Coordinate results and ensure all steps are completed before finalizing.
