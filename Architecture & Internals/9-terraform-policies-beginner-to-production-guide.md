# Terraform Policies: Beginner to Production Guide

## Contents

- [1. What is a Terraform policy?](#1-what-is-a-terraform-policy)
- [2. Are Terraform policies the same as variable validation?](#2-are-terraform-policies-the-same-as-variable-validation)
- [3. Policy frameworks](#3-policy-frameworks)
- [4. How do you create and use a policy?](#4-how-do-you-create-and-use-a-policy)
- [5. Four examples: beginner to production](#5-four-examples-beginner-to-production)
- [6. Integrate OPA into Jenkins](#6-integrate-opa-into-jenkins)
- [7. Enforcement levels: warning versus blocking](#7-enforcement-levels-warning-versus-blocking)
- [8. How to create a policy set in HCP Terraform](#8-how-to-create-a-policy-set-in-hcp-terraform)
- [9. What else can Terraform policies enforce?](#9-what-else-can-terraform-policies-enforce)
- [10. Production considerations and limitations](#10-production-considerations-and-limitations)
- [11. Recommended learning path](#11-recommended-learning-path)
- [Final takeaway](#final-takeaway)


## 1. What is a Terraform policy?

A Terraform policy is a rule that defines what infrastructure is allowed
or not allowed.

Examples:

-   EC2 instances must use approved instance types.
-   Security groups must not expose SSH to `0.0.0.0/0`.
-   Production resources must have mandatory tags.
-   EBS volumes and RDS databases must use encryption.
-   Infrastructure must be deployed only in approved regions.

Policies turn infrastructure standards into code so they can be checked
automatically.

### Where policy enforcement fits

```text
Terraform configuration
        |
        v
Terraform plan
        |
        v
Policy engine evaluates planned changes
        |
      +---+
      |   |
     Pass Fail
      |   |
      v   v
   Apply Block / warn
```

In HCP Terraform and Terraform Enterprise, policy evaluation is
integrated into the run workflow after planning and before applying. The
exact behavior depends on the framework and enforcement configuration.

------------------------------------------------------------------------

## 2. Are Terraform policies the same as variable validation?

No. Terraform has several validation mechanisms, and they serve
different purposes.

  -----------------------------------------------------------------------
| Feature | What it checks | Typical use |
| --- | --- | --- |
| Variable validation | Input variable values | Approved regions, naming formats |
| Preconditions | Assumptions before an operation | Check a selected AMI architecture |
| Postconditions | Expected results after an operation | Check a resulting resource attribute |
| Check blocks | Infrastructure assertions; failures produce warnings | Health and operational checks |
| Policy as code | Organization or platform-wide rules | Security, compliance, cost, governance |

### Example: input variable validation

```hcl
variable "region" {
  type = string

  validation {
    condition = contains(
      ["ap-south-1", "ap-southeast-1"],
      var.region
    )

    error_message = "Only approved AWS regions are allowed."
  }
}
```

This prevents a consumer of this module from providing an unapproved
region.

However, another team could use a different Terraform module without
this validation. The rule is not automatically applied across the
organization.

**Remember:**

-   Variable validation protects the inputs of a particular module.
-   Centrally managed policy enforcement can apply rules across many
    Terraform workspaces and projects.

Terraform validation features and policy frameworks complement each
other; they are not interchangeable.

------------------------------------------------------------------------

## 3. Policy frameworks

HashiCorp documents three policy frameworks for HCP Terraform:

  -----------------------------------------------------------------------
| Framework | Language | Description |
| --- | --- | --- |
| Terraform policy | HCL | Native HCL-based policy framework integrated with Terraform providers |
| Sentinel | Sentinel | HashiCorp's dedicated policy-as-code language and framework |
| Open Policy Agent (OPA) | Rego | General-purpose policy engine that evaluates structured input |

### Terraform policy

-   Uses HCL, familiar to Terraform practitioners.
-   Integrates with Terraform providers and resources.
-   Has built-in policy testing support.
-   The current HashiCorp documentation identifies this framework as
    beta. Check its current maturity and support status before adopting
    it for production.

### Sentinel

-   HashiCorp's dedicated policy language.
-   Integrated with HCP Terraform and Terraform Enterprise.
-   Can evaluate Terraform plan, state, and configuration data.
-   Particularly relevant when an organization uses HashiCorp's
    enterprise Terraform workflow.

### OPA

-   Open-source policy engine.
-   Uses Rego.
-   Can evaluate Terraform plan data.
-   Can also be used beyond Terraform, including other platform and
    application systems.
-   Can run in a CI/CD pipeline or be integrated with HCP Terraform.

**Suggested learning path:** Start with Terraform's built-in validation,
then learn OPA and Rego. Learn Sentinel if your organization uses HCP
Terraform or Terraform Enterprise.

------------------------------------------------------------------------

## 4. How do you create and use a policy?

The general process is:

1.  Decide the rule you want to enforce.
2.  Choose the policy framework.
3.  Write the policy code.
4.  Test it against representative Terraform plans.
5.  Store the policy in version control.
6.  Connect it to the Terraform execution workflow.
7.  Choose how strictly to enforce it.
8.  Review violations and update the policy as requirements change.

Example organization rules:

  -----------------------------------------------------------------------
| Rule | Reason |
| --- | --- |
| Only approved AWS regions | Governance |
| Mandatory resource tags | Ownership and cost allocation |
| No public SSH access | Security |
| EBS volumes must be encrypted | Data protection |
| Production instances must use | Cost control |
| approved sizes |  |
| Protect critical resources from | Availability |
| accidental destruction |  |

### Two common enforcement approaches

#### Approach A: HCP Terraform / Terraform Enterprise

```text
Terraform creates a plan
        |
HCP Terraform evaluates policy sets
        |
Policy passes or fails
        |
Failed policy warns or blocks, depending on enforcement
        |
Permitted run can proceed to apply
```

Policy sets can target an organization, projects, workspaces, or
supported Stack scopes, depending on the framework and configuration.

#### Approach B: Your own CI/CD pipeline

```text
Jenkins runs terraform plan
        |
Convert saved plan to JSON
        |
OPA evaluates JSON against Rego policies
        |
Pass ---------------- Fail
 |                      |
Approval              Fail pipeline
 |
Apply the same saved plan
```

This is a CI/CD implementation you build and maintain. Running OPA
locally is not the same as attaching a managed HCP Terraform policy set.

------------------------------------------------------------------------

## 5. Four examples: beginner to production

The first two examples use Terraform's built-in validation mechanisms.
The last two demonstrate centralized policy-as-code using OPA.

## Example 1 --- Beginner: allow only approved AWS regions

**Requirement:** Engineers can deploy only to `ap-south-1` and
`ap-southeast-1`.

In `variables.tf`:

```hcl
variable "region" {
  type        = string
  description = "AWS region for deployment"

  validation {
    condition = contains(
      ["ap-south-1", "ap-southeast-1"],
      var.region
    )

    error_message = "Only approved AWS regions are allowed."
  }
}
```

In `provider.tf`:

```hcl
provider "aws" {
  region = var.region
}
```

If someone supplies:

```hcl
region = "us-east-1"
```

Terraform fails validation and does not proceed with the operation.

**What you learned:** This is an in-module guardrail, not a centrally
managed policy set. It is an excellent starting point for learning
policy logic.

## Example 2 --- Beginner/intermediate: prevent an invalid EC2 configuration

**Requirement:** The EC2 instance must use an approved AMI architecture.

Suppose the AMI is selected through a data source:

```hcl
data "aws_ami" "selected" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}
```

Add a resource precondition:

```hcl
resource "aws_instance" "web" {
  ami           = data.aws_ami.selected.id
  instance_type = "t3.micro"

  lifecycle {
    precondition {
      condition = (
        data.aws_ami.selected.architecture == "x86_64"
      )

      error_message = "Only x86_64 AMIs are allowed."
    }
  }
}
```

Terraform evaluates the precondition and stops the operation if it
fails.

Why use a precondition? Because you are checking an assumption that must
be true before Terraform creates the EC2 instance.

The AMI filter already narrows the results. The precondition is an
additional explicit guardrail and demonstrates the mechanism.

Other built-in options:

-   `postcondition` checks a result after a resource is created or a
    data source is read.
-   `check` performs an assertion that reports a warning rather than
    blocking the operation when it fails.

These are Terraform configuration validation features, not replacements
for organization-wide policy enforcement.

## Example 3 --- Intermediate: block public SSH access using OPA

**Requirement:** No AWS security group may allow SSH (port 22) from the
entire internet (`0.0.0.0/0`).

Create a file:

```text
policies/no_public_ssh.rego
```

Policy:

```rego
package terraform

import rego.v1
import input.plan as plan

deny contains msg if {
    some rc in plan.resource_changes

    rc.type == "aws_security_group"
    rc.mode == "managed"

    after := object.get(rc.change, "after", {})
    ingress_rules := object.get(after, "ingress", [])

    some rule in ingress_rules

    rule.from_port <= 22
    rule.to_port >= 22

    cidrs := object.get(rule, "cidr_blocks", [])
    some cidr in cidrs

    cidr == "0.0.0.0/0"

    msg := sprintf(
        "%s allows public SSH access from 0.0.0.0/0",
        [rc.address]
    )
}
```

### How it works

1.  `plan.resource_changes` contains resources Terraform plans to
    create, update, or destroy.
2.  The policy looks for managed `aws_security_group` resources.
3.  It inspects their planned ingress rules.
4.  It checks whether a rule covers port 22.
5.  It checks whether the IPv4 CIDR is `0.0.0.0/0`.
6.  If so, it returns a violation message.

Example violation:

```text
aws_security_group.web allows public SSH
access from 0.0.0.0/0
```

A policy configured as mandatory can prevent the planned deployment from
proceeding.

### Limitations of this example

-   It checks IPv4 CIDR rules. It does not check IPv6 `::/0`.
-   It checks inline ingress rules in `aws_security_group`. If ingress
    is managed with separate `aws_vpc_security_group_ingress_rule`
    resources, add checks for those resource types too.
-   Test the policy against representative plan JSON, including create,
    update, and destroy cases.

### Connect it to HCP Terraform

For an HCP Terraform OPA policy:

-   The policy input contains a `plan` object and a `run` object.
-   This example reads `input.plan.resource_changes`.
-   Configure the policy query as:

```text
data.terraform.deny
```

HCP Terraform expects the query result to be an array. An empty result
means the policy passes; returned violations mean it fails.

## Example 4 --- Production: mandatory tags and storage encryption

Imagine creating platform-wide guardrails for a company.

Requirements:

1.  Every EC2 instance must have an `Environment` tag.
2.  Every EC2 instance must have an `Owner` tag.
3.  Every managed EBS volume must have encryption enabled.
4.  Every RDS DB instance must have storage encryption enabled.

Create:

```text
policies/production_guardrails.rego
```

Policy:

```rego
package terraform

import rego.v1
import input.plan as plan

# Check mandatory tags on EC2 instances.
deny contains msg if {
    some rc in plan.resource_changes

    rc.type == "aws_instance"
    rc.mode == "managed"

    some action in rc.change.actions
    action in {"create", "update"}

    after := object.get(rc.change, "after", {})
    tags := object.get(after, "tags", {})

    object.get(tags, "Environment", "") == ""

    msg := sprintf(
        "%s is missing the mandatory Environment tag",
        [rc.address]
    )
}

deny contains msg if {
    some rc in plan.resource_changes

    rc.type == "aws_instance"
    rc.mode == "managed"

    some action in rc.change.actions
    action in {"create", "update"}

    after := object.get(rc.change, "after", {})
    tags := object.get(after, "tags", {})

    object.get(tags, "Owner", "") == ""

    msg := sprintf(
        "%s is missing the mandatory Owner tag",
        [rc.address]
    )
}

# Check EBS volume encryption.
deny contains msg if {
    some rc in plan.resource_changes

    rc.type == "aws_ebs_volume"
    rc.mode == "managed"

    some action in rc.change.actions
    action in {"create", "update"}

    after := object.get(rc.change, "after", {})

    object.get(after, "encrypted", false) != true

    msg := sprintf(
        "%s must have EBS encryption enabled",
        [rc.address]
    )
}

# Check RDS storage encryption.
deny contains msg if {
    some rc in plan.resource_changes

    rc.type == "aws_db_instance"
    rc.mode == "managed"

    some action in rc.change.actions
    action in {"create", "update"}

    after := object.get(rc.change, "after", {})

    object.get(after, "storage_encrypted", false) != true

    msg := sprintf(
        "%s must have RDS storage encryption enabled",
        [rc.address]
    )
}
```

This is a platform engineering policy. If 30 teams deploy Terraform
infrastructure, the same policy set can be attached to their applicable
workspaces.

### Production caveats

-   Extend tag checks to every resource type your organization requires,
    not just EC2.
-   Add checks for separately managed resources where relevant.
-   Decide how to handle unknown or computed plan values. A policy must
    fail safely for controls that cannot be verified; do not assume an
    unknown value is compliant.
-   Test policy behavior for create, update, delete, replacement, and
    import-related scenarios.
-   Confirm that the policy covers the actual provider resource schemas
    and versions used by your modules.

These examples are starting templates, not a complete compliance
framework.

------------------------------------------------------------------------

## 6. Integrate OPA into Jenkins

A Jenkins workflow could look like this:

```text
Checkout Terraform code
        |
terraform init
        |
terraform validate
        |
terraform plan -out=tfplan
        |
terraform show -json tfplan > tfplan.json
        |
OPA policy evaluation
        |
   +----+----+
   |         |
  Pass      Fail
   |         |
Approval   Fail pipeline
   |
terraform apply tfplan
```

Important commands:

```bash
terraform plan -out=tfplan

terraform show -json tfplan > tfplan.json
```

The first creates a saved Terraform plan. The second converts it to JSON
so a policy engine can inspect the planned changes.

### Important input difference: HCP vs local plan JSON

The HCP Terraform OPA input wraps the plan under `input.plan`.

A local JSON file generated by:

```bash
terraform show -json tfplan > tfplan.json
```

has `resource_changes` at its root.

Therefore, for local Jenkins evaluation, adapt the policy input
reference:

HCP Terraform:

```rego
import input.plan as plan
```

Local plan JSON:

```rego
import input as plan
```

Do not use the HCP input reference unchanged against a raw local plan
JSON file.

You can evaluate the local policy using OPA:

```bash
opa eval \
  --data policies/ \
  --input tfplan.json \
  'data.terraform.deny'
```

The result contains the violations. Your Jenkins stage should inspect
that result and fail the build if the violation list is non-empty.

**Apply the exact saved plan that passed policy evaluation:**

```bash
terraform apply tfplan
```

Do not generate a fresh plan after policy evaluation and blindly apply
it. A new plan can contain changes that have not passed policy checks.

For production:

-   Protect the plan artifact.
-   Restrict who can modify the policy repository.
-   Test policy evaluation failures.
-   Ensure policy failures cannot be silently ignored.

------------------------------------------------------------------------

## 7. Enforcement levels: warning versus blocking

In HCP Terraform, exact enforcement options depend on the framework.

  -----------------------------------------------------------------------
| Enforcement | Meaning |
| --- | --- |
| Advisory | Report violations but do not block the run |
| Mandatory overridable | Block by default, but an authorized user can override |
| Mandatory | Block the run until the violation is fixed |

For Sentinel, the corresponding names are:

-   Advisory
-   Soft mandatory
-   Hard mandatory

OPA policy enforcement in HCP Terraform uses pass/fail behavior rather
than those three Sentinel levels.

### Recommended rollout

1.  Start new policies as advisory.
2.  Observe violations and fix false positives.
3.  Communicate the rule to engineering teams.
4.  Move important security controls to mandatory enforcement.
5.  Keep a controlled exception process for genuine emergencies.

Do not make every rule mandatory on day one. An incomplete policy can
accidentally block legitimate production work.

Example rollout:

| Policy | Suggested starting mode |
| --- | --- |
| Mandatory `Owner` tag | Advisory, then mandatory |
| No public SSH | Mandatory |
| Approved instance types | Advisory initially |
| EBS encryption | Mandatory |
| Deployment time window | Advisory initially |

## 8. How to create a policy set in HCP Terraform

A **policy** is an individual rule. A **policy set** is a collection of
policies applied to selected workspaces or other supported scopes.

Example policy set: `AWS Production Guardrails`

-   Prevent public SSH access.
-   Require mandatory resource tags.
-   Require EBS encryption.
-   Require RDS storage encryption.
-   Restrict approved resource configurations.

### Practical setup

1.  Open your HCP Terraform organization.
2.  Go to **Settings → Policies / Policy Sets**.
3.  Create or connect a policy set.
4.  Select the policy framework.
5.  Add individual policies or connect a version-controlled policy
    repository.
6.  Configure enforcement levels.
7.  Choose the target scope: organization, project, workspace, or
    supported tags.
8.  Run a Terraform plan and inspect policy results.

For a team, storing policy code in Git is generally preferable to
maintaining many policies manually in the UI. This gives you pull
requests, reviews, version history, and automated testing.

A policy set can contain policies written in one framework. Multiple
policy sets using different frameworks can be attached to the same
eligible workspace.

------------------------------------------------------------------------

## 9. What else can Terraform policies enforce?

  -----------------------------------------------------------------------
| Category | Example policy |
| --- | --- |
| Security | Block public SSH and unrestricted database ingress |
| Encryption | Require encrypted EBS, RDS, and supported storage resources |
| Governance | Require owner, environment, and cost-centre tags |
| Region control | Allow deployments only in approved AWS regions |
| Cost control | Restrict expensive instance families or large database sizes |
| Availability | Require production resources to use approved availability configurations |
| Compliance | Enforce selected CIS, PCI DSS, or organizational controls |
| Naming | Enforce standard resource naming conventions |
| Deployment process | Prevent deployments during restricted windows |
| Resource lifecycle | Require review for planned destruction of critical resources |
| Module governance | Require approved module sources and pinned versions |

Some rules need careful implementation. For example, preventing all
destruction of a production database can be too restrictive. Legitimate
migrations and decommissioning still need an approved process.

------------------------------------------------------------------------

## 10. Production considerations and limitations

### Policies evaluate what they can see

Some resource attributes are unknown until apply. A security rule should
not treat an unknown value as automatically safe.

### Test policies like application code

Test compliant and non-compliant plans, resource creation, updates,
deletion, replacement, and missing or null attributes.

### Scope policies carefully

A global policy can unintentionally affect development, test, and
production workspaces differently. Use workspace/project targeting and
documented exceptions.

### Keep an exception process

A policy should have an owner, a reason, an approval path, and an expiry
or review date for exceptions.

### Do not confuse policy enforcement with security scanning

A policy checks whether a proposed change follows a rule. A scanner may
inspect code, dependencies, images, or deployed resources for
vulnerabilities and misconfigurations. Both are useful.

### Combine with cloud-side controls

A Terraform plan policy does not automatically intercept someone
creating a resource manually through the AWS console or another tool.

For defense in depth, combine:

-   Terraform policy checks for infrastructure changes through
    Terraform.
-   AWS Organizations SCPs and IAM permissions for AWS API-level
    restrictions.
-   AWS Config or equivalent controls for detecting non-compliant
    deployed resources.
-   Security scanning for vulnerabilities and misconfigurations.
-   Monitoring and alerting for runtime conditions.

These controls solve related but different problems.

### Framework maturity

HashiCorp's current documentation identifies the native Terraform policy
framework as beta. Check its current maturity and support status before
adopting it for production. Sentinel and OPA are the established
alternatives in the documented HCP Terraform policy workflow.

------------------------------------------------------------------------

## 11. Recommended learning path

For a DevOps engineer moving toward platform engineering:

1.  Terraform variable validation, preconditions, postconditions, and
    checks.
2.  OPA fundamentals: Rego syntax, input documents, rules, and tests.
3.  Terraform plan JSON structure.
4.  OPA evaluation in a Jenkins pipeline.
5.  HCP Terraform policy sets and Sentinel.
6.  Production governance: policy ownership, exceptions, testing, and
    AWS Organizations guardrails.

## Final takeaway

Terraform policies turn infrastructure standards into automated
controls. Instead of relying on every engineer to remember the rules,
you make the rules part of the deployment process.