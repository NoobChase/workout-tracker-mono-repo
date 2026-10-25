# Project agents

One file per agent. Frontmatter sets the defaults (`model`, `effort`, `tools`);
the body is the role's standing orders. Root `CLAUDE.md` and the workspace
`CLAUDE.md` files still load for every agent, so these files only say what is
*specific to the role* — never repeat the non-negotiable rules.

| Agent | Owns | Default model |
|---|---|---|
| `orchestrator` | Planning, splitting, delegating, final verification | Opus, xhigh |
| `frontend` | `apps/web` | Sonnet, high (orchestrator may pick Opus) |
| `backend` | `apps/api`, `packages/shared`, service layer | Sonnet, high (orchestrator may pick Opus) |
| `db` | `packages/db`: schema, migrations, scoping, integration tests | Sonnet, high (orchestrator may pick Opus) |
| `infra` | `infra/` CDK stacks — diffs, never deploys | Sonnet, high (orchestrator may pick Opus) |
| `reviewer` | Read-only check against the definition of done | Sonnet, high (orchestrator may pick Opus) |

Model aliases (`opus`, `sonnet`) resolve to the current generation, Opus 5.5 and
Sonnet 5.5. Pin a full id (`claude-opus-5-5`) only if a later generation
misbehaves.

Agents rot like skills do: when a workspace is added or an agent's boundary
moves, fix the agent in the same commit.
