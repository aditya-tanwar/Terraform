# Terraform Backends: Storage, Locking, Security, Migration, and CI/CD

**Research checked against HashiCorp Terraform documentation on November
20, 2026.**

## Contents

- [1. What is a Terraform backend?](#1-what-is-a-terraform-backend)
- [2. What does a backend do?](#2-what-does-a-backend-do)
- [3. Types of Terraform backends](#3-types-of-terraform-backends)
- [4. State locking: why it matters](#4-state-locking-why-it-matters)
- [5. Deep dive: how S3 locking works today](#5-deep-dive-how-s3-locking-works-today)
- [6. What if Terraform gets stuck holding a lock?](#6-what-if-terraform-gets-stuck-holding-a-lock)
- [7. Terraform workspaces and backend state paths](#7-terraform-workspaces-and-backend-state-paths)
- [8. State storage, versioning, encryption, and security](#8-state-storage-versioning-encryption-and-security)
- [9. Backend credentials: a critical security detail](#9-backend-credentials-a-critical-security-detail)
- [10. Backend initialization: what does \`terraform init\` do?](#10-backend-initialization-what-does-terraform-init-do)
- [11. Migrating from local state to S3](#11-migrating-from-local-state-to-s3)
- [12. Recovering or inspecting remote state](#12-recovering-or-inspecting-remote-state)
- [13. Backend vs \`terraform_remote_state\`](#13-backend-vs-terraformremotestate)
- [14. What happens when two Jenkins pipelines run?](#14-what-happens-when-two-jenkins-pipelines-run)
- [15. Recommended AWS backend architecture](#15-recommended-aws-backend-architecture)
- [16. Common mistakes to avoid](#16-common-mistakes-to-avoid)
- [17. Quick comparison of backend options](#17-quick-comparison-of-backend-options)
- [18. Commands to remember](#18-commands-to-remember)
- [19. Recommended approach for an AWS + Jenkins environment](#19-recommended-approach-for-an-aws-jenkins-environment)
- [20. Final mental model](#20-final-mental-model)
- [Official HashiCorp references](#official-hashicorp-references)

---

This guide explains Terraform backends from fundamentals through
production operations. Examples focus on AWS S3, with Azure, GCP,
Kubernetes, PostgreSQL, and HCP Terraform comparisons.

------------------------------------------------------------------------

## 1. What is a Terraform backend?

A Terraform backend defines where Terraform stores its state and how
Terraform accesses that state. Depending on the backend, it may also
provide state locking.

Terraform state maps Terraform resource addresses to real infrastructure
objects and records attributes Terraform needs to manage those objects.

By default, Terraform uses the `local` backend and stores state in a
local `terraform.tfstate` file.

### Without a remote backend

Each engineer or CI agent might have a different local state copy:

```text
Engineer A -> local terraform.tfstate
Engineer B -> local terraform.tfstate
Engineer C -> local terraform.tfstate
Jenkins    -> local terraform.tfstate
```

These copies can diverge. A remote backend gives the team a shared state
location.

### With a remote backend

```text
Engineer A ----+
Engineer B ----+----> Shared remote state (for example, S3)
Engineer C ----+
Jenkins    ----+
```

A remote backend makes shared state possible. A backend that supports
locking can also coordinate concurrent operations on that state.

**Storage and locking are separate capabilities.** Not every backend
supports locking.

## 2. What does a backend do?

The backend primarily handles:

1.  **State storage:** Where Terraform reads and writes state.
2.  **State locking:** Whether Terraform can acquire a lock to prevent
    conflicting operations.

Some platforms, such as HCP Terraform, provide additional features such
as remote execution, centralized run management, and team access
controls.

A backend is not the same thing as a provider.

  -----------------------------------------------------------------------
  Component                           Responsibility
  ----------------------------------- -----------------------------------
  Backend                             Stores and retrieves Terraform
                                      state; may coordinate locks

  Provider                            Communicates with AWS, Azure, GCP,
                                      Kubernetes, etc. to manage
                                      infrastructure

  Terraform Core                      Builds plans, evaluates
                                      dependencies, coordinates providers
                                      and state
  -----------------------------------------------------------------------

Example:

```text
                Terraform CLI
                      |
                Terraform Core
                  /       \
                 /         \
          AWS Provider    Backend
               |             |
           AWS APIs         AWS S3
               |             |
          EC2, VPC, RDS   terraform.tfstate
```

The AWS provider manages EC2 instances. The S3 backend stores the state
Terraform uses to track them.

## 3. Types of Terraform backends

Terraform ships with built-in backends. Backends are built into
Terraform; they are not provider plugins.

### 3.1 Local backend

The default backend stores state on the local machine.

```hcl
terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}
```

If no backend is configured, Terraform uses the local backend.

Typical project layout:

```text
terraform-project/
├── main.tf
├── variables.tf
├── outputs.tf
├── terraform.tfstate
└── .terraform/
```

**How it works** - Terraform reads state from local disk. - It writes
updated state to local disk. - Local backend locking uses local system
mechanisms.

**Advantages** - Simple to configure. - No cloud storage infrastructure
required. - Useful for experiments and learning.

**Disadvantages** - Not ideal for team collaboration. - State can be
lost with the machine or workspace. - Sharing and backup are your
responsibility.

Use it for learning, local experiments, or isolated development---not as
the default for shared production workflows.

### 3.2 Amazon S3 backend

The S3 backend stores state as an object in an S3 bucket.

```hcl
terraform {
  backend "s3" {
    bucket       = "company-terraform-state"
    key          = "production/network/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

State location:

```text
s3://company-terraform-state/
    production/network/terraform.tfstate
```

The bucket must exist before Terraform initializes this backend.

**How it works** 1. Terraform reads the state object from S3. 2.
Terraform performs its operation. 3. When state needs to be persisted,
Terraform writes updated state to S3. 4. If locking is enabled,
Terraform acquires and releases a lock around operations that could
write state.

**Current locking detail:** The S3 backend supports native S3 lock files
through `use_lockfile = true`. DynamoDB-based locking is deprecated in
current HashiCorp documentation. Older tutorials may still show DynamoDB
as the primary mechanism.

### 3.3 AzureRM backend

Stores state in an Azure Blob Storage container.

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "terraform-state-rg"
    storage_account_name = "tfstatecompany"
    container_name       = "tfstate"
    key                  = "production/network.tfstate"
  }
}
```

State location:

```text
Azure Storage Account
    |
    +-- Container: tfstate
           |
           +-- production/network.tfstate
```

Azure Blob Storage supports locking using blob leases. Authentication
methods include managed identity, Azure CLI, and OIDC/workload identity
federation.

### 3.4 GCS backend

Stores state in Google Cloud Storage.

```hcl
terraform {
  backend "gcs" {
    bucket = "company-terraform-state"
    prefix = "production/network"
  }
}
```

The bucket must already exist. GCS supports state locking. Object
versioning is recommended for recovery.

### 3.5 HCP Terraform / Terraform Enterprise

HCP Terraform provides centralized state management and can also execute
Terraform runs remotely.

You can connect using a `cloud` block:

```hcl
terraform {
  cloud {
    organization = "my-company"

    workspaces {
      name = "production-network"
    }
  }
}
```

Alternatively, Terraform supports the `remote` backend for connecting to
HCP Terraform or Terraform Enterprise workspaces:

```hcl
terraform {
  backend "remote" {
    organization = "my-company"

    workspaces {
      name = "production-network"
    }
  }
}
```

Do not configure both a `cloud` block and a `backend` block in the same
root configuration.

Capabilities include: - Centralized state storage. - State locking. -
Team and workspace access controls. - Remote execution. - Run history
and approvals, depending on product and configuration.

### 3.6 Other built-in backends

  Backend        Storage                        Locking
  -------------- ------------------------------ ---------------------------------
  `consul`       Consul KV                      Yes
  `http`         HTTP REST service              Optional, if server supports it
  `kubernetes`   Kubernetes Secret              Yes, using Lease resources
  `pg`           PostgreSQL                     Yes, advisory locks
  `cos`          Tencent Cloud Object Storage   Yes
  `oss`          Alibaba Cloud OSS              Via TableStore configuration
  `swift`        OpenStack Swift                Backend-specific
  `manta`        Joyent Manta                   Backend-specific

The HTTP backend requires a server that implements the relevant locking
endpoints if locking is to be supported. Kubernetes uses Lease resources
for locking. PostgreSQL uses advisory locks.

Check the documentation for the exact Terraform version and backend you
deploy; supported backends and arguments can vary by version.

## 4. State locking: why it matters

Imagine two engineers are working on the same Terraform configuration
and state.

Engineer A runs:

```bash
terraform apply
```

At almost the same time, Engineer B runs:

```bash
terraform apply
```

Both processes could read the same starting state. Without coordination,
they could make conflicting changes or overwrite state based on stale
assumptions.

### What is state locking?

State locking prevents multiple Terraform operations from simultaneously
modifying the same state.

When Terraform starts an operation that could write state:

1.  Terraform asks the backend to acquire a lock.
2.  If the lock is available, Terraform acquires it.
3.  Terraform performs the operation.
4.  Terraform persists state as needed.
5.  Terraform releases the lock.

If another operation tries to acquire the same lock, it waits or fails
depending on the backend and lock timeout.

### With locking enabled

```text
Engineer A starts apply
       |
       v
Acquires state lock
       |
       v
Performs operation
       |
       v
Persists state
       |
       v
Releases lock
       |
       v
Engineer B can acquire lock
```

**Important:** Locking protects a state from concurrent Terraform
writers. It does not stop someone from manually changing AWS
infrastructure through the Console, CLI, or another tool.

Locking is scoped to a state. Two operations using different state files
can generally proceed concurrently.

## 5. Deep dive: how S3 locking works today

Example:

```hcl
terraform {
  backend "s3" {
    bucket       = "company-terraform-state"
    key          = "production/eks/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

Terraform uses two objects:

```text
S3 Bucket
    |
    +-- production/eks/
           |
           +-- terraform.tfstate
           |
           +-- terraform.tfstate.tflock
```

The `.tflock` object is the lock file.

### Locking sequence

1.  Terraform attempts to create the lock file.
2.  The S3 backend uses a conditional write so an existing lock cannot
    simply be overwritten by another operation.
3.  If the lock is acquired, Terraform proceeds.
4.  Other Terraform operations attempting to acquire the same lock
    cannot proceed.
5.  Terraform removes the lock file when the operation finishes.

The backend's IAM permissions must allow the required state-object and
lock-file operations.

### What about DynamoDB locking?

Older configurations commonly use:

```hcl
terraform {
  backend "s3" {
    bucket         = "company-terraform-state"
    key            = "production/eks/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "terraform-locks"
  }
}
```

This uses a DynamoDB table with a partition key named `LockID` of type
`String`.

However, **DynamoDB-based S3 backend locking is deprecated** in current
HashiCorp documentation. For new configurations, prefer:

```hcl
use_lockfile = true
```

For migration from older Terraform setups, HashiCorp documents that S3
lock-file and DynamoDB locking arguments can be configured
simultaneously to support older clients during a transition. Plan
migration and Terraform version compatibility carefully.

## 6. What if Terraform gets stuck holding a lock?

Suppose Jenkins starts an apply and its agent crashes before the lock is
released. A later run might report:

```text
Error acquiring the state lock

Error message: state is locked
Lock Info:
  ID:        12345678-...
  Operation: OperationTypeApply
  Who:       jenkins-agent
  Path:      company-terraform-state/production/eks/terraform.tfstate
```

Terraform cannot safely assume the lock is stale. The original process
might still be running.

### Troubleshooting

Inspect: - Lock ID - Operation - User or process (`Who`) - Lock creation
time - State path

Verify that no Terraform process is still operating on that state. Check
Jenkins builds, agent pods, and engineers' local terminals.

Only after establishing that the original operation has stopped and the
lock is stale should you consider force-unlocking.

```bash
terraform force-unlock <LOCK_ID>
```

Terraform requires the lock ID as a safety check.

**Danger:** Do not force-unlock just because an apply is taking a long
time. If the original process is still running, another process could
start modifying the same state.

### Lock timeout and disabling locking

```bash
# Wait up to five minutes to acquire the lock
terraform apply -lock-timeout=5m

# Disable locking (not recommended)
terraform apply -lock=false
```

`-lock=false` bypasses protection against concurrent writers. Avoid it
in shared environments.

## 7. Terraform workspaces and backend state paths

A workspace gives a Terraform configuration a separate state instance.

For example, one configuration might be used for: - Development - QA -
Production

S3 example:

```hcl
terraform {
  backend "s3" {
    bucket       = "company-terraform-state"
    key          = "application/terraform.tfstate"
    region       = "ap-south-1"
    use_lockfile = true
  }
}
```

The default workspace stores state at:

```text
application/terraform.tfstate
```

A non-default workspace such as `dev` uses the workspace prefix. The
default prefix is `env:`:

```text
env:/dev/application/terraform.tfstate
```

You can change the prefix with `workspace_key_prefix`.

Commands:

```bash
terraform workspace list
terraform workspace new dev
terraform workspace select dev
terraform workspace show
```

**Architecture advice:** Workspaces are useful for multiple state
instances from one configuration, but they are not a strong security
boundary. If development and production need different access
permissions, credentials, ownership, or blast-radius boundaries,
separate root configurations and state locations are often better.

## 8. State storage, versioning, encryption, and security

Terraform state can contain sensitive values, including passwords,
tokens, connection details, and infrastructure metadata. Marking an
output or variable as `sensitive` hides it in certain CLI output; it
does not mean the value is absent from state.

For S3, consider:

| Protection | Why it matters |
|---|---|
| Block Public Access | Prevents accidental public exposure |
| Least-privilege IAM | Limits who can read, write, or delete state |
| Bucket versioning | Allows recovery of earlier state versions |
| Server-side encryption | Protects stored state |
| KMS encryption | Adds customer-managed key control and auditability |
| TLS | Protects data in transit |
| CloudTrail data events | Can help audit S3 object access when configured |
| Separate state paths | Limits accidental cross-environment access |

Example:

```hcl
terraform {
  backend "s3" {
    bucket       = "company-terraform-state"
    key          = "production/network/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    kms_key_id   = "arn:aws:kms:ap-south-1:123456789012:key/example"
    use_lockfile = true
  }
}
```

Configure the bucket with versioning and public access blocked. The KMS
key policy and IAM permissions must allow the Terraform execution
identity to use the key.

## 9. Backend credentials: a critical security detail

Avoid hardcoding credentials in the backend block.

Bad example:

```hcl
terraform {
  backend "s3" {
    bucket     = "company-terraform-state"
    key        = "prod/terraform.tfstate"
    region     = "ap-south-1"
    access_key = "AKIA..."
    secret_key = "..."
  }
}
```

Terraform stores backend configuration locally under
`.terraform/terraform.tfstate`. Backend settings can also be captured in
saved plan files. Hardcoded credentials or secrets supplied through
`-backend-config` can therefore be exposed in local files or artifacts.

Prefer: - Normal AWS credential chain. - Environment variables where
appropriate. - Workload identity. - An IAM role attached to the
execution environment. - Secure role assumption for cross-account
access.

For Jenkins running in AWS, an IAM role for the agent or a securely
assumed role is generally preferable to long-lived access keys.

Example `.gitignore`:

``` gitignore
.terraform/
*.tfstate
*.tfstate.*
*.tfplan
```

Do not commit state files, local backend metadata, or saved plans to
Git.

## 10. Backend initialization: what does `terraform init` do?

When you add or change a backend configuration, Terraform needs to
initialize it.

```hcl
terraform {
  backend "s3" {
    bucket       = "company-terraform-state"
    key          = "production/network/terraform.tfstate"
    region       = "ap-south-1"
    use_lockfile = true
  }
}
```

Run:

```bash
terraform init
```

Terraform: 1. Reads the backend configuration. 2. Initializes the
configured backend. 3. Connects to it using the supplied credentials. 4.
Detects existing state or offers migration if appropriate. 5. Stores
local backend configuration metadata under `.terraform/`.

Run `terraform init` again when changing backend configuration.

### Partial backend configuration

Environment-specific backend details can be kept outside the Terraform
source.

`backend.tf`:

```hcl
terraform {
  backend "s3" {}
}
```

`prod.s3.tfbackend`:

```hcl
bucket       = "company-terraform-state"
key          = "production/network/terraform.tfstate"
region       = "ap-south-1"
use_lockfile = true
```

Initialize:

```bash
terraform init -backend-config=prod.s3.tfbackend
```

Backend blocks cannot use normal Terraform variables, locals, data
sources, or resource attributes. Partial configuration is useful for
supplying environment-specific settings.

Treat `.terraform` metadata as sensitive and keep it out of source
control.

## 11. Migrating from local state to S3

Suppose you started with local state and want to move to S3.

First, back up the local state:

```bash
cp terraform.tfstate terraform.tfstate.backup
```

Add the S3 backend:

```hcl
terraform {
  backend "s3" {
    bucket       = "company-terraform-state"
    key          = "production/network/terraform.tfstate"
    region       = "ap-south-1"
    use_lockfile = true
  }
}
```

Then run:

```bash
terraform init -migrate-state
```

Terraform will offer to migrate existing state to the new backend when
supported by the source and destination backends.

Verify:

```bash
terraform state list
terraform plan
```

The plan should not unexpectedly propose recreating all existing
infrastructure.

Do not delete the backup until you have verified the new backend and
state contents.

## 12. Recovering or inspecting remote state

Useful commands:

```bash
# Download current state to stdout
terraform state pull

# List resources tracked by the current state
terraform state list

# Inspect one resource
terraform state show aws_instance.app

# Push a local state snapshot to the backend
terraform state push backup.tfstate
```

`terraform state push` is dangerous because it can overwrite remote
state. Terraform checks state lineage and serial to protect against
writing an unrelated or older snapshot. Do not use `-force` casually.

For S3, bucket versioning provides another recovery option. You can
inspect and restore an earlier object version if a state object is
accidentally overwritten or deleted. Coordinate recovery carefully so
you do not roll state back behind real infrastructure changes.

## 13. Backend vs `terraform_remote_state`

These are related, but they do different jobs.

-   **Backend configuration** tells the current Terraform root module
    where its own state is stored.
-   **`terraform_remote_state` data source** lets one Terraform
    configuration read root outputs from another Terraform
    configuration's state.

Example architecture:

```text
Project A: Network
    |
    +-- Creates VPC
    +-- Creates Subnets
    +-- Exposes VPC ID as output

Project B: Application
    |
    +-- Reads Network outputs
    +-- Creates EC2/EKS resources
```

Project A:

```hcl
output "vpc_id" {
  value = aws_vpc.main.id
}
```

Project B:

```hcl
data "terraform_remote_state" "network" {
  backend = "s3"

  config = {
    bucket = "company-terraform-state"
    key    = "network/terraform.tfstate"
    region = "ap-south-1"
  }
}

resource "aws_subnet" "application" {
  vpc_id     = data.terraform_remote_state.network.outputs.vpc_id
  cidr_block = "10.20.1.0/24"
}
```

Project B reads the output from Project A's state. It does not manage
Project A's state.

**Security warning:** Access to a remote state file can expose more
information than just the outputs you consume. Treat remote state access
as sensitive and grant it only to trusted configurations and identities.

## 14. What happens when two Jenkins pipelines run?

Suppose: - Jenkins pipeline A deploys EKS infrastructure. - Jenkins
pipeline B updates EKS networking. - Both use the same S3 state key.

Both pipelines start at nearly the same time.

If Pipeline A acquires the lock first, Pipeline B cannot acquire the
same lock until A releases it.

Example shell steps:

```bash
terraform init
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

If the pipelines use different state keys, they have separate locking
scopes and may run concurrently.

This is why state boundaries matter: - One state for an entire
organization can create unnecessary contention. - Too many tiny states
can create complicated dependencies and operational overhead.

## 15. Recommended AWS backend architecture

A common multi-account AWS pattern is to keep Terraform state in a
dedicated administrative or shared-services account.

```text
Shared Services / Management AWS Account
    |
    +-- S3 Terraform State Bucket
    |      |
    |      +-- Versioning
    |      +-- Encryption / KMS
    |      +-- Public access blocked
    |      +-- State objects
    |      +-- Lock files
    |
    +-- IAM roles and policies

Development AWS Account
    +-- IAM deployment role

Production AWS Account
    +-- IAM deployment role

Jenkins / Terraform agents
    +-- Assume authorized roles
    +-- Access only approved state paths
```

Example state key layout:

```text
s3://company-terraform-state/
    dev/
        networking/terraform.tfstate
        eks/terraform.tfstate
        rds/terraform.tfstate

    qa/
        networking/terraform.tfstate
        eks/terraform.tfstate
        rds/terraform.tfstate

    prod/
        networking/terraform.tfstate
        eks/terraform.tfstate
        rds/terraform.tfstate
```

This gives separate state boundaries for different environments and
infrastructure domains.

For production, consider separate AWS accounts, IAM roles, KMS keys, and
restrictive bucket policies.

## 16. Common mistakes to avoid

1.  **Using local state for shared production infrastructure.** Team
    members and CI agents can end up with divergent state copies.
2.  **Assuming every remote backend supports locking.** Verify the exact
    backend's locking capability and enable it where supported.
3.  **Using `-lock=false` to get past a lock error.** This can permit
    concurrent writers.
4.  **Force-unlocking without checking the original process.** The
    original apply may still be running.
5.  **Treating workspaces as security boundaries.** Separate accounts,
    configurations, and state locations may be more appropriate for
    production isolation.
6.  **Committing `.terraform`, state, or saved plan files.** They can
    contain sensitive information.
7.  **Hardcoding backend credentials.** Backend configuration and saved
    plans can persist credentials.
8.  **Skipping state backups and verification during migration.** A
    migration mistake can make infrastructure appear unmanaged.
9.  **Giving every engineer broad read/write access to all state
    files.** Apply least privilege to state and lock objects.
10. **Assuming a remote state output exposes only that output.** Access
    to the state can expose sensitive state contents.
11. **Sharing one state key across unrelated pipelines without a
    reason.** This creates unnecessary contention and couples
    deployments.
12. **Restoring an old state version without reconciling real
    infrastructure.** State rollback can cause Terraform to
    misunderstand what it manages.

## 17. Quick comparison of backend options

  ---------------------------------------------------------------------------
  Backend           State storage     Locking            Typical use
  ----------------- ----------------- ------------------ --------------------
  Local             Local file        Local mechanism    Learning, isolated
                                                         work

  S3                AWS S3 object     S3 lock file       AWS infrastructure
                                      (`use_lockfile`)

  AzureRM           Azure Blob        Blob lease         Azure infrastructure

  GCS               Google Cloud      Supported          GCP infrastructure
                    Storage

  HCP Terraform /   HCP Terraform     Supported          Centralized state
  remote            workspace                            and remote execution

  Consul            Consul KV         Supported          Consul-based
                                                         environments

  Kubernetes        Kubernetes Secret Lease              Kubernetes-centric
                                                         environments

  PostgreSQL (`pg`) PostgreSQL        Advisory locks     PostgreSQL-backed
                                                         state

  HTTP              REST service      Optional server    Custom state service
                                      support
  ---------------------------------------------------------------------------

## 18. Commands to remember

```bash
# Initialize backend
terraform init

# Reconfigure backend without migrating existing state
terraform init -reconfigure

# Migrate state to the configured backend
terraform init -migrate-state

# Pull current state
terraform state pull

# List state resources
terraform state list

# Inspect one resource
terraform state show aws_instance.app

# Wait for a lock
terraform apply -lock-timeout=5m

# Force-unlock only a verified stale lock
terraform force-unlock <LOCK_ID>

# Workspaces
terraform workspace list
terraform workspace show
terraform workspace new dev
terraform workspace select dev
```

## 19. Recommended approach for an AWS + Jenkins environment

For a shared production AWS environment, a strong starting design is:

-   Use an S3 backend in a dedicated state-management account.
-   Enable S3 bucket versioning.
-   Enable server-side encryption, preferably with a managed KMS key
    where required.
-   Block public access.
-   Use `use_lockfile = true` for S3 state locking with a compatible
    Terraform version.
-   Use IAM roles and role assumption rather than long-lived access
    keys.
-   Scope permissions to the required state object and lock object
    paths.
-   Separate state by environment and infrastructure domain where it
    makes operational sense.
-   Use Jenkins plan and approval stages before applying saved plans.
-   Protect saved plans and state backups as sensitive artifacts.
-   Test backend migration and recovery procedures before relying on
    them in production.

Example:

```hcl
terraform {
  backend "s3" {
    bucket       = "company-terraform-state"
    key          = "prod/eks/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

## 20. Final mental model

```text
Terraform configuration
        |
        v
Terraform Core
        |
        +---- Provider ----> Cloud APIs
        |                    (create/update/delete resources)
        |
        +---- Backend -----> State storage
                             (read/write state)
                             (lock/unlock when supported)
```

-   **Provider:** Manages the actual infrastructure.
-   **Backend:** Stores Terraform state and may provide locking.
-   **State locking:** Coordinates Terraform writers to protect a shared
    state.
-   **Workspace:** Selects a separate state instance within a
    configuration/backend.
-   **Remote state data source:** Reads outputs from another Terraform
    state.
-   **HCP Terraform:** Adds centralized workflow and execution
    capabilities beyond simple state storage.

The central lesson: a backend is not merely a place to upload
`terraform.tfstate`. It is a critical part of Terraform's collaboration,
concurrency, security, and recovery architecture.

------------------------------------------------------------------------

## Official HashiCorp references

-   [Backend configuration
    overview](https://developer.hashicorp.com/terraform/language/backend)
-   [State storage and
    backends](https://developer.hashicorp.com/terraform/language/state/backends)
-   [State
    locking](https://developer.hashicorp.com/terraform/language/state/locking)
-   [S3
    backend](https://developer.hashicorp.com/terraform/language/backend/s3)
-   [AzureRM
    backend](https://developer.hashicorp.com/terraform/language/backend/azurerm)
-   [GCS
    backend](https://developer.hashicorp.com/terraform/language/backend/gcs)
-   [HTTP
    backend](https://developer.hashicorp.com/terraform/language/backend/http)
-   [Kubernetes
    backend](https://developer.hashicorp.com/terraform/language/backend/kubernetes)
-   [PostgreSQL
    backend](https://developer.hashicorp.com/terraform/language/backend/pg)
-   [Collaborate with
    Terraform](https://developer.hashicorp.com/terraform/intro/phases/collaborate)
