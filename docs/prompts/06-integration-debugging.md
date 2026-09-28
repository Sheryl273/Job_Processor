# Integration / debugging

**Situation:** we merged our parts and something is wrong end to end.

**What I expected:** [e.g. flaky jobs retry with growing delays and end up Dead after 6 attempts]
**What actually happens:** [describe]
**Evidence:** [paste logs, failing test output, API response, SQL rows from `jobs` / `job_attempts` / `dead_letters`]
**Relevant code:** [paste the smallest set of files: worker, repository method, endpoint]
**What I already tried:** [list]

**Please:**
1. List the 3 most likely causes, ranked, given the architecture (claim token mismatches, status-enum string vs int, UTC vs local time, scoped service in a singleton, unhandled exception killing the loop, migrations not applied).
2. For each, give a quick check I can run (SQL query, log line, curl).
3. Then give the minimal fix for the most likely cause and tell me which teammate's file it touches.
