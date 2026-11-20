# Terraform Core: Internal Components and Architecture

## What is Terraform Core?

**Terraform Core is the main Terraform executable (`terraform`
binary).** It interprets configuration, coordinates providers, builds
dependency graphs, calculates infrastructure changes, and orchestrates
operations.

A useful mental model is to think of Terraform Core as Terraform's
orchestration engine or control plane.

## 1. Conceptual components of Terraform Core

The following are major responsibilities and conceptual subsystems. They
are not necessarily separate binaries or one-to-one internal packages.

  -----------------------------------------------------------------------
  Component                           Responsibility
  ----------------------------------- -----------------------------------
  HCL Parser                          Parses `.tf` files and converts HCL
                                      into structured representations

  Configuration Loader                Loads modules, variables,
                                      resources, data sources, and
                                      provider configurations

  Expression Evaluator                Evaluates expressions, locals,
                                      variables, functions, and
                                      references

  Dependency Graph Engine             Builds resource dependency graphs
                                      and determines execution ordering

  Planning Engine                     Compares desired configuration with
                                      refreshed state and calculates
                                      proposed changes

  State Manager                       Reads, tracks, and updates
                                      Terraform state

  Backend Interface                   Coordinates state storage and state
                                      locking where supported

  Provider Plugin Manager             Starts provider processes and
                                      establishes plugin communication

  Apply Engine                        Executes planned operations and
                                      coordinates resource changes

  CLI                                 Handles commands such as `init`,
                                      `plan`, `apply`, `destroy`, and
                                      `validate`
  -----------------------------------------------------------------------

## 2. How the components work together

Consider this Terraform configuration:

``` hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
```

When you execute:

``` bash
terraform plan
```

Terraform Core coordinates several activities:

1.  **HCL Parser:** Reads and parses the `.tf` files.
2.  **Configuration Loader:** Loads resources, modules, variables, and
    provider configurations.
3.  **Expression Evaluator:** Resolves expressions and references such
    as `aws_vpc.main.id`.
4.  **Dependency Graph Engine:** Builds the dependency `VPC -> Subnet`.
5.  **Provider Plugin Manager:** Starts the AWS provider and establishes
    communication through the Terraform Plugin Protocol.
6.  **State Manager and Backend:** Reads existing state and coordinates
    access to it.
7.  **Planning Engine:** Refreshes resource information and calculates
    the proposed changes.
8.  **Apply Engine:** During `terraform apply`, coordinates execution of
    the approved operations and state updates.

The exact internal ordering and graph construction are more nuanced than
a simple linear pipeline; this sequence is a learning model.

## 3. What Terraform Core does not contain

It is important to distinguish Core responsibilities from provider
responsibilities.

  -----------------------------------------------------------------------
  Responsibility                      Who handles it?
  ----------------------------------- -----------------------------------
  Understanding AWS resource schemas  AWS provider

  AWS provider authentication and     AWS provider configuration and
  configuration                       credential chain

  Making AWS API calls                AWS provider and AWS SDK

  Understanding Kubernetes resources  Kubernetes provider

  Parsing HCL                         Terraform Core

  Building the dependency graph       Terraform Core

  Calculating infrastructure changes  Terraform Core

  Managing Terraform state            Terraform Core, working with the
                                      configured backend
  -----------------------------------------------------------------------

For example, Terraform Core does not know how to create an EC2 instance
at the AWS API level. It determines that a resource operation is
required and delegates the platform-specific work to the AWS provider.

## 4. Complete conceptual architecture

``` mermaid
flowchart TB
    HCL["Terraform Configuration (.tf)"]

    subgraph CORE["Terraform Core - terraform binary"]
       PARSE["HCL Parser"]
       CONFIG["Configuration Loader"]
       EVAL["Expression Evaluator"]
       GRAPH["Dependency Graph Engine"]
       PLAN["Planning Engine"]
       STATE["State Manager"]
       APPLY["Apply Engine"]
       CLI["CLI"]

       PARSE --> CONFIG --> EVAL --> GRAPH --> PLAN
       STATE <--> PLAN
       PLAN --> APPLY
       CLI --> PARSE
    end

    BACKEND["Remote Backend (S3 / HCP Terraform)"]
    PLUGIN["Provider Plugin Manager"]
    AWS["AWS Provider Process"]
    API["AWS APIs"]

    HCL --> PARSE
    STATE <--> BACKEND
    APPLY <--> PLUGIN
    PLUGIN <-->|"Plugin Protocol / gRPC"| AWS
    AWS <-->|"AWS SDK / HTTPS"| API
```

This is a conceptual view of the responsibilities and interactions, not
a literal source-code package diagram.

## 5. Three important architectural boundaries

### Boundary 1: Terraform Core

Understands: - Terraform configuration - Expressions and references -
Dependencies and execution graphs - State coordination - Planning and
execution orchestration

### Boundary 2: Provider

Understands: - External platform resource schemas - Platform-specific
authentication and configuration - Read, create, update, and delete
operations - API calls and provider-specific error handling

### Boundary 3: Backend

Provides: - Persistent state storage - State retrieval and persistence -
Locking or concurrency coordination, depending on backend support

## 6. Dependency graph and parallelism

Terraform does not simply execute resources sequentially. It uses its
dependency graph to coordinate operations.

For example:

``` text
             VPC
              |
           Subnet
              |
             EC2

    S3 bucket       IAM role
       |               |
    Independent resources
```

Resources without dependency relationships can often be processed
concurrently. Dependencies determine which operations must wait for
others.

The `-parallelism` option controls the maximum number of concurrent
resource operations Terraform walks during planning or applying.

Example:

``` bash
terraform apply -parallelism=10
```

This sets the operation concurrency limit to 10; it does not guarantee
that ten operations will always run simultaneously.

## 7. Senior-level takeaway

Remember these three boundaries:

1.  **Terraform Core:** Understands configuration, dependencies, state,
    planning, and execution orchestration.
2.  **Provider:** Understands the external platform and translates
    Terraform operations into API calls.
3.  **Backend:** Provides persistent state storage and concurrency
    coordination.

Terraform Core uses its dependency graph and parallel execution
machinery to coordinate independent operations while respecting
dependencies.

## Suggested next topic: Terraform dependency graph internals

To go deeper, explore:

-   How Terraform converts configuration into graph nodes
-   How graph transformations and graph walking work
-   How implicit and explicit dependencies are represented
-   How `-parallelism=10` affects concurrent resource operations
-   How Terraform handles create, destroy, and replacement ordering
