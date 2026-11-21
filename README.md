# Terraform Learning and Infrastructure Modules

A practical Terraform learning repository covering Terraform internals, state management, execution planning, provider communication, backends, and reusable infrastructure modules.

The material is organized to support both hands-on learning and senior DevOps interview preparation. Examples primarily use AWS and CI/CD workflows, with Kubernetes and other platform references where relevant.

## Repository structure

| Directory | What you'll find |
|---|---|
| [Architecture & Internals](./Architecture%20%26%20Internals/) | Terraform architecture, planning, state, providers, backends, and advanced operational concepts |
| [Modules](./Modules/) | Hands-on Terraform module examples |

## Architecture and internals guides

| # | Guide | Focus |
|---|---|---|
| 1 | [Terraform Architecture and Execution Model](./Architecture%20%26%20Internals/1-terraform-architecture-and-execution-model.md) | Core components, providers, state, dependency graphs, and CI/CD |
| 2 | [Terraform Core: Internal Components and Architecture](./Architecture%20%26%20Internals/2-terraform-core-internal-architecture.md) | Terraform Core responsibilities, graph execution, and resource ordering |
| 3 | [Terraform Lifecycle and Plan Internals](./Architecture%20%26%20Internals/3-terraform-lifecycle-and-plan-internals.md) | What happens during init, plan, refresh, and apply |
| 4 | [Terraform State vs Actual Infrastructure](./Architecture%20%26%20Internals/4-terraform-state-vs-actual-infrastructure.md) | State, refresh, drift detection, and correction |
| 5 | [Advanced Terraform Internals — Senior DevOps Guide](./Architecture%20%26%20Internals/5-advanced-terraform-internals-senior-devops-guide.md) | State internals, graph behavior, providers, lifecycle, refactoring, and production CI/CD |
| 5.1 | [Protocol Buffers, RPC, and gRPC](./Architecture%20%26%20Internals/5.1-protobuf-rpc-grpc-terraform-combined-guide.md) | How provider plugin communication works |
| 6 | [Terraform Backends Deep Dive](./Architecture%20%26%20Internals/6-terraform-backends-deep-dive.md) | Remote state, locking, security, migration, and Jenkins workflows |
| 7 | [Terraform State Internals and Remote State Operations](./Architecture%20%26%20Internals/7-terraform-state-internals-and-remote-state-operations.md) | Lineage, serial, snapshots, locking, pull, and push |
| 8 | [Terraform Variables and Data Types](./Architecture%20%26%20Internals/8-terraform-variables-and-data-types.md) | Input variables, locals, outputs, data sources, and type constraints |
| 9 | [Terraform Policies: Beginner to Production Guide](./9-terraform-policies-beginner-to-production-guide.md) | Policy validation, OPA, Sentinel, Jenkins integration, and production guardrails |

## Suggested learning path

1. Start with **Architecture and Execution Model**.
2. Continue with **Terraform Core** and the **Lifecycle and Plan** guide.
3. Learn how **state, refresh, and drift** work.
4. Study **provider communication** and **backends**.
5. Finish with the **Advanced Terraform Internals** guide and the hands-on modules.

## Working with the examples

- Review each example before running it in an AWS account.
- Replace example resource IDs, names, regions, and account-specific values with values from your own environment.
- Run `terraform fmt`, `terraform validate`, and `terraform plan` before applying changes.
- Use remote state, locking, least-privilege credentials, and reviewed plans for shared or production environments.
- Never commit credentials, secrets, or sensitive state files.

## Contributing

Keep examples focused and reproducible. Use descriptive headings, fenced code blocks with language identifiers, and links between related guides. When a command or behavior is version-dependent, state the Terraform version or link to the relevant official documentation.
