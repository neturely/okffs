<!-- okffs:type=Changed -->
- `create_issue` now injects the board's **real** Priority/Effort option names into its inference guidance (resolved at tools/list time), so Claude infers against the actual board options — e.g. a `P0/P1/P2` board — instead of the generic `Urgent/High/Medium/Low` scale. Falls back to the generic scale when the board is unreachable or the options can't be read (#133).
