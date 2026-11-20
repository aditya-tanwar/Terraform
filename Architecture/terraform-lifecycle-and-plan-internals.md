# Terraform Lifecycle and What Happens During `terraform plan`

## Part 1: Terraform end-to-end lifecycle

Terraform takes infrastructure from declarative configuration to
provisioned and managed resources.

``` mermaid
flowchart TD
    A["Write HCL configuration"] --> B["terraform init"]
    B --> C["terraform fmt"]
    C --> D["terraform validate"]
    D --> E["terraform plan"]
    E --> F["Review and approval"]
    F --> G["terraform apply"]
    G --> H["Provider calls external APIs"]
    H --> I["State updated"]
```

### The major stages

1.  **Write configuration:** Define desired infrastructure in `.tf`
    files.
2.  **Initialize:** `terraform init` initializes the working directory,
    configures the backend, and downloads required providers and
    modules.
3.  **Format:** `terraform fmt` standardizes HCL formatting.
4.  **Validate:** `terraform validate` checks syntax and internal
    configuration consistency. It does not prove that credentials work
    or that infrastructure can be provisioned.
5.  **Refresh/read:** During normal planning and applying, Terraform
    reads remote objects through providers and compares their current
    values with state.
6.  **Build dependency graph:** Terraform identifies dependencies and
    determines which operations must happen before others.
7.  **Plan:** `terraform plan` calculates the proposed changes.
8.  **Review and approval:** A person or policy process reviews the
    proposed changes.
9.  **Apply:** `terraform apply` executes the planned operations through
    providers.
10. **Update state:** Terraform persists the resulting resource
    information to the configured backend.

The refresh, graph, and planning work is not necessarily a simple linear
sequence internally. Terraform constructs and walks graphs, and some
operations can be interleaved or deferred based on dependencies and
values that are not yet known.

## Part 2: What happens internally during `terraform plan`?

`terraform plan` does not merely compare the `.tf` files with the state
file. Terraform Core coordinates configuration evaluation, state access,
provider reads, dependency analysis, and change calculation.

### Main participants

  -----------------------------------------------------------------------
  Participant                         Responsibility
  ----------------------------------- -----------------------------------
  Terraform Core                      Coordinates the planning process

  Configuration                       Describes desired infrastructure

  State backend                       Provides the existing Terraform
                                      state and locking where supported

  Provider plugin                     Reads remote resources and supplies
                                      provider-specific resource behavior

  Cloud or SaaS APIs                  Return information about actual
                                      infrastructure
  -----------------------------------------------------------------------

### Step 1: Load and evaluate configuration

When you execute:

``` bash
terraform plan
```

Terraform loads and processes configuration such as:

-   `.tf` files
-   Input variables and local values
-   Resource definitions
-   Data sources
-   Modules
-   Provider configurations
-   Outputs

Example:

``` hcl
resource "aws_instance" "web" {
  ami           = "ami-12345678"
  instance_type = "t3.micro"
}
```

Terraform now has a representation of the desired infrastructure.
Expressions are evaluated where their inputs are available; some values
may remain unknown until later operations.

### Step 2: Initialize providers and read state

Terraform Core loads the configured backend, reads the current state,
and normally acquires a state lock when the backend supports locking and
locking has not been disabled.

It also starts the required provider plugin processes and configures
them.

``` text
Terraform Core
      |
      | Terraform Plugin Protocol
      v
AWS Provider process
      |
      v
Provider configured
```

The modern Terraform Plugin Protocol uses gRPC-based RPC. Providers are
separate processes from Terraform Core.

### Step 3: Refresh existing infrastructure

Terraform asks providers to read the current remote objects and return
their latest attributes.

For example:

``` text
Configuration: desired_instances = 3
Previous state: instances managed = 3
AWS API: actual instances found = 2
```

The provider reads the remote resources using the relevant AWS APIs and
returns the observed information to Terraform Core.

Terraform can now identify drift between the prior state and the actual
infrastructure.

Important details:

-   Normal `plan` and `apply` operations refresh managed resources by
    default.
-   `-refresh=false` disables this refresh behavior, but can produce an
    incomplete or misleading plan.
-   Refresh reads remote information; it does not itself perform the
    proposed create, update, or delete operations.
-   Data sources are read when their required inputs are available.
    Reads may be deferred until apply if they depend on values that are
    not yet known.

### Step 4: Build and walk dependency graphs

Terraform constructs dependency information from references and explicit
dependencies.

Example:

``` hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "web" {
  ami           = "ami-12345678"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id
}
```

The dependency relationship is:

``` text
VPC -> Subnet -> EC2 instance
```

Terraform uses dependency graphs for planning and execution. The
internal implementation has graph transformations and different graph
walks; it is more sophisticated than one static graph built once and
reused unchanged.

Independent operations can often run concurrently, subject to dependency
constraints and the configured parallelism limit.

``` bash
terraform plan -parallelism=10
```

This sets the maximum number of concurrent graph operations Terraform
walks; it does not guarantee that ten operations will always be active.

### Step 5: Calculate differences

Terraform considers:

1.  Desired configuration.
2.  Refreshed information about actual infrastructure.
3.  Prior Terraform state and resource identity.

It determines what actions are required to move from the observed
situation toward the declared configuration.

Example:

  Attribute        Desired configuration   Actual infrastructure
  ---------------- ----------------------- -----------------------
  Instance type    `t3.small`              `t3.micro`
  AMI              `ami-new`               `ami-old`
  Instance count   3                       2

The provider's resource schema and planning behavior determine whether
an attribute change can be updated in place or requires replacement.
Terraform Core coordinates the resulting planned actions.

Common plan symbols:

  Symbol   Meaning
  -------- -----------------------------------------------------
  `+`      Create
  `-`      Destroy
  `~`      Update in place
  `-/+`    Destroy and then create replacement
  `+/-`    Create replacement before destroying the old object
  `<=`     Read a data source

Not every provider or resource supports in-place updates for every
attribute.

### Step 6: Produce the execution plan

Terraform produces a plan describing the proposed actions and their
dependencies.

Example:

``` text
Terraform will perform the following actions:

  # aws_instance.web will be created
  + resource "aws_instance" "web" {
      + instance_type = "t3.micro"
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

At this point, Terraform has proposed changes. It has not yet created
the EC2 instance.

You can save the plan:

``` bash
terraform plan -out=tfplan
```

A saved plan can be reviewed and then applied:

``` bash
terraform apply tfplan
```

Saved plan files can contain sensitive information. Protect them like
other sensitive infrastructure artifacts.

## Part 3: Refresh vs graph construction vs diff vs planning

These concepts are related, but they are not interchangeable.

  -----------------------------------------------------------------------
  Concept                 What it does            Main question
  ----------------------- ----------------------- -----------------------
  Refresh                 Reads current remote    What exists right now?
                          resource information    
                          through providers       

  Graph construction      Represents dependencies What depends on what?
                          and operation ordering  

  Diff calculation        Determines changes      What is different?
                          needed to move toward   
                          configuration           

  Planning                Combines proposed       What operations should
                          actions, dependencies,  be performed?
                          and ordering into a     
                          plan                    
  -----------------------------------------------------------------------

A useful simplified mental model:

``` text
Configuration + Prior State
          |
          v
  Read remote infrastructure
          |
          v
   Build dependency graph
          |
          v
   Calculate differences
          |
          v
    Produce execution plan
          |
          v
       Review plan
```

This is a learning model. Actual Terraform internals involve graph
transformations, provider planning callbacks, unknown values, deferred
data-source reads, and multiple graph walks.

## Part 4: What happens during `terraform apply`?

After approval, run:

``` bash
terraform apply
```

Or, for an approved saved plan:

``` bash
terraform apply tfplan
```

Terraform Core coordinates the planned operations and invokes provider
operations through the plugin protocol.

``` text
Terraform Core
      |
      | RPC / gRPC
      v
AWS Provider process
      |
      | AWS SDK / HTTPS
      v
AWS APIs
      |
      v
Infrastructure changed
      |
      v
Terraform state persisted
```

The provider performs platform-specific API operations. Terraform Core
coordinates dependencies, execution, and state management.

When applying a saved plan, Terraform uses that reviewed plan rather
than generating a new interactive plan. Terraform also checks that the
plan is still applicable to the current state; stale plans must be
regenerated.

## Part 5: Plan and apply in a DevOps CI/CD pipeline

``` mermaid
flowchart TD
    A["Developer pushes Terraform code"] --> B["Pull request"]
    B --> C["terraform fmt -check"]
    C --> D["terraform init"]
    D --> E["terraform validate"]
    E --> F["Security and policy checks"]
    F --> G["terraform plan -out=tfplan"]
    G --> H{"Approval"}
    H -->|Approved| I["Protected deployment pipeline"]
    H -->|Rejected| J["Stop deployment"]
    I --> K["terraform apply tfplan"]
    K --> L["Provider calls cloud APIs"]
    L --> M["State updated"]
```

Production recommendations:

-   Use OIDC federation for short-lived cloud credentials.
-   Store state remotely with encryption and locking or equivalent
    concurrency control.
-   Separate state by environment, account, region, or system boundary.
-   Review plans before production changes.
-   Apply the exact saved plan that was approved.
-   Protect saved plans and state because they may contain sensitive
    information.
-   Keep Terraform and provider versions controlled.
-   Maintain state backups and a tested recovery procedure.

## Part 6: Useful commands

  -----------------------------------------------------------------------
  Command                             Purpose
  ----------------------------------- -----------------------------------
  `terraform init`                    Initialize backend, providers, and
                                      modules

  `terraform fmt`                     Format HCL

  `terraform validate`                Validate configuration

  `terraform plan`                    Refresh and calculate proposed
                                      changes

  `terraform plan -out=tfplan`        Save a plan artifact

  `terraform show tfplan`             Inspect a saved plan

  `terraform apply`                   Plan interactively and apply after
                                      approval

  `terraform apply tfplan`            Apply a saved plan

  `terraform plan -refresh-only`      Preview state updates based on
                                      remote changes without proposing
                                      configuration-driven infrastructure
                                      changes

  `terraform apply -refresh-only`     Apply refresh-only state updates
  -----------------------------------------------------------------------

## Final mental model

> `terraform plan` reads configuration and state, consults providers for
> remote information, analyzes dependencies, and calculates a proposed
> set of infrastructure operations. `terraform apply` executes the
> approved operations through providers and persists the resulting
> state.

The key distinction:

-   **Refresh:** Discover the current remote situation.
-   **Graph:** Understand dependencies.
-   **Diff:** Identify required changes.
-   **Plan:** Describe the proposed operations.
-   **Apply:** Execute those operations.
