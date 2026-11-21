# Terraform State vs Actual Infrastructure: Understanding Refresh

## Contents

- [The key idea](#the-key-idea)
- [1. Example: An EC2 instance changes outside Terraform](#1-example-an-ec2-instance-changes-outside-terraform)
- [2. What happens when you run \`terraform plan\`?](#2-what-happens-when-you-run-terraform-plan)
- [3. Terraform compares three sources](#3-terraform-compares-three-sources)
- [4. What happens to the state file?](#4-what-happens-to-the-state-file)
- [5. Common questions](#5-common-questions)
- [Final mental model](#final-mental-model)
- [1. Starting Point: Everything Is in Sync](#1-starting-point-everything-is-in-sync)
- [2. Someone Manually Changes the EC2 Instance](#2-someone-manually-changes-the-ec2-instance)
- [3. What Happens During Refresh?](#3-what-happens-during-refresh)
- [4. What Happens During Planning?](#4-what-happens-during-planning)
- [5. What Happens During Apply?](#5-what-happens-during-apply)
- [6. Detect Drift Without Correcting the Infrastructure](#6-detect-drift-without-correcting-the-infrastructure)
- [7. The Three Operations to Remember](#7-the-three-operations-to-remember)
- [8. Important Syntax Note](#8-important-syntax-note)
- [9. Key Takeaway](#9-key-takeaway)

---

## The key idea

Terraform **does use the state file to understand the resources it
manages**. However, the state file is not a live connection to the
cloud.

The distinction is:

-   **State file:** What Terraform last recorded about the
    infrastructure.
-   **Provider refresh:** What the provider reads from the remote
    platform now.
-   **Configuration:** What you currently declare as the desired
    infrastructure.

Terraform uses these sources together when calculating a plan.

## 1. Example: An EC2 instance changes outside Terraform

Suppose your Terraform configuration declares:

```hcl
resource "aws_instance" "web" {
  instance_type = "t3.small"
}
```

The Terraform state file previously recorded:

```json
{
  "address": "aws_instance.web",
  "id": "i-123456789",
  "instance_type": "t3.small"
}
```

But someone manually changes the EC2 instance type in the AWS Console:

```text
Instance ID:   i-123456789
Instance type: t3.medium
```

Terraform now has three different views:

| Source | Instance type |
| --- | --- |
| Terraform configuration | `t3.small` |
| Previous Terraform state | `t3.small` |
| Actual AWS infrastructure | `t3.medium` |
This difference is called **configuration drift**.

## 2. What happens when you run `terraform plan`?

Two important activities help Terraform understand the situation.

### Step 1: Read the previous state

Terraform Core reads the existing state from the configured backend.

The state tells Terraform:

-   Which resources it manages.
-   Their Terraform resource addresses.
-   Their cloud resource IDs.
-   Their previously recorded attributes.

For example:

```text
Terraform resource address: aws_instance.web
AWS resource ID:             i-123456789
Previously recorded type:    t3.small
```

### Step 2: Refresh through the provider

Terraform Core coordinates with the AWS provider to read the actual EC2
instance.

The provider calls AWS APIs and returns the current resource
information.

```text
Terraform Core
      |
      | Read previous state
      v
State Backend
      |
      | Previous state: t3.small
      v
Terraform Core
      |
      | Terraform Plugin Protocol (gRPC-based RPC)
      v
AWS Provider
      |
      | AWS SDK / API
      v
AWS EC2
      |
      | Actual value: t3.medium
      v
AWS Provider
      |
      | Refreshed resource data
      v
Terraform Core
```

The AWS/Kubernetes API does not directly return data to Terraform Core.
The provider communicates with the remote API and translates the
response into Terraform resource data.

## 3. Terraform compares three sources

| Source | Value | What it represents |
| --- | --- | --- |
| Configuration | `t3.small` | Desired infrastructure |
| Previous state | `t3.small` | Last recorded information |
| Refreshed AWS data | `t3.medium` | Actual remote infrastructure |
Terraform detects that the remote instance differs from the declared
configuration.

It can therefore propose changing the instance back to `t3.small`,
provided the resource's provider behavior supports that action.

## 4. What happens to the state file?

There is an important distinction between planning and applying.

-   During a normal `terraform plan`, Terraform refreshes resource
    information in memory and calculates proposed changes. It does not
    apply infrastructure changes.
-   During a successful `terraform apply`, Terraform executes the
    planned operations and persists the resulting state to the
    configured backend.
-   A normal plan does not make the proposed infrastructure changes.

### Refresh-only mode

You can also run:

```bash
terraform plan -refresh-only
```

This previews state updates based on the actual remote infrastructure,
without proposing configuration-driven infrastructure changes.

To apply those state updates:

```bash
terraform apply -refresh-only
```

Refresh-only mode is useful when you intentionally want Terraform's
recorded state to reflect changes made outside Terraform, rather than
reverting those changes to match the configuration.

## 5. Common questions

| Question | Answer |
| --- | --- |
| Does Terraform read the state file? | Yes |
| Does Terraform treat state as a live view of AWS? | No |
| Who reads actual remote infrastructure? | The provider |
| Who calls AWS APIs? | The AWS provider |
| Who coordinates comparison and planning? | Terraform Core |
| Does a normal `terraform plan` apply infrastructure changes? | No |
| Does a successful apply persist resulting state? | Yes |
## Final mental model

> State is Terraform's last recorded view of managed infrastructure, not
> a live connection to AWS.

Terraform reads state to understand which resources it manages and what
it previously knew about them. It then uses providers to refresh remote
information and compare that information with the desired configuration.

This is why provider refresh is important: without it, Terraform could
miss changes made manually outside Terraform.

---

# Terraform Refresh, Drift Detection, and Drift Correction

## 1. Starting Point: Everything Is in Sync

Suppose you have an EC2 instance managed by Terraform.

| Source | EC2 instance type |
| --- | --- |
| Terraform configuration (`.tf`) | `t2.small` |
| Terraform state (`tfstate`) | `t2.small` |
| Actual EC2 instance in AWS | `t2.small` |
Terraform configuration describes the desired infrastructure. The state
file records Terraform's last-known mapping and attributes for managed
resources. AWS contains the real infrastructure.

## 2. Someone Manually Changes the EC2 Instance

Someone changes the instance type directly in AWS from `t2.small` to
`t2.medium`, outside Terraform.

| Source | EC2 instance type |
| --- | --- |
| Terraform configuration | `t2.small` |
| Terraform state (before refresh) | `t2.small` |
| Actual EC2 instance in AWS | `t2.medium` |
This difference is an example of **configuration drift**.

## 3. What Happens During Refresh?

A normal `terraform plan` refreshes managed resources by default. You
can also explicitly request it:

```bash
terraform plan -refresh=true
```

Terraform Core asks the AWS provider to read the current EC2 instance
details from AWS. The provider calls AWS APIs and reports the observed
attributes.

Terraform discovers that the actual instance type is `t2.medium`.

| Source | EC2 instance type |
| --- | --- |
| Terraform configuration | `t2.small` |
| Refreshed state view | `t2.medium` |
| Actual EC2 instance in AWS | `t2.medium` |
**Important:** Refresh reads the remote object and updates Terraform's
state view. It does not itself change the EC2 instance in AWS.

## 4. What Happens During Planning?

Terraform compares the desired configuration with the refreshed
information:

-   Desired configuration: `t2.small`
-   Observed remote value: `t2.medium`

Terraform proposes changing the instance type back to `t2.small`.

Conceptually, the plan may show:

```hcl
~ resource "aws_instance" "app" {
    instance_type = "t2.medium" -> "t2.small"
}
```

The `~` indicates an in-place update in the plan. The exact action
depends on the provider's resource schema and the attribute being
changed.

## 5. What Happens During Apply?

Run:

```bash
terraform apply
```

Terraform performs the normal planning/refresh process, presents the
proposed changes, and asks for approval unless automatic approval is
enabled.

After approval, Terraform asks the AWS provider to perform the update.
If it succeeds, Terraform records the resulting resource information in
state.

The intended final result is:

| Source | EC2 instance type |
| --- | --- |
| Terraform configuration | `t2.small` |
| Terraform state | `t2.small` |
| Actual EC2 instance in AWS | `t2.small` |
You can also use:

```bash
terraform apply -auto-approve
```

This skips the interactive approval prompt. Use it only when your
automation and review controls make that appropriate.

## 6. Detect Drift Without Correcting the Infrastructure

To inspect proposed changes without applying them:

```bash
terraform plan
```

Terraform refreshes by default and shows the proposed changes. It does
not apply them.

To preview how Terraform state would be updated to reflect the real
infrastructure, use:

```bash
terraform plan -refresh-only
```

This plans state updates based on remote objects. It does not propose
changing remote infrastructure to match the configuration.

To persist the refreshed state information:

```bash
terraform apply -refresh-only
```

After this operation, the state can record `t2.medium`, while the
configuration still declares `t2.small`. A later normal plan will
propose reconciling AWS back to `t2.small`.

## 7. The Three Operations to Remember

  -----------------------------------------------------------------------
| Operation | What it does |
| --- | --- |
| Refresh | Reads remote infrastructure and updates Terraform's view/state information |
| Plan | Compares desired configuration with refreshed infrastructure information and calculates proposed actions |
| Apply | Executes the approved actions and updates state after successful operations |

A useful mental model:

```text
Terraform configuration
       |
       | desired value: t2.small
       v
Terraform Core <------> AWS Provider <------> AWS API
       |                                      |
       +---- compares desired value ----------+
                    with
              actual value
               t2.medium
                    |
                    v
              Terraform plan
                    |
             approval + apply
                    |
                    v
           AWS returns to t2.small
```

## 8. Important Syntax Note

Use a single hyphen for Terraform CLI options:

```bash
terraform plan -refresh=true
```

Not:

```bash
terraform apply --refresh=true
```

Refresh is enabled by default for normal `terraform plan` and
`terraform apply` operations, so `-refresh=true` is usually unnecessary.

## 9. Key Takeaway

Terraform configuration expresses the desired state. Refresh discovers
the current remote state. Planning calculates the difference. Applying
carries out the approved changes.

In this example, because the configuration still says `t2.small`, a
normal plan/apply workflow detects the manual change to `t2.medium` and
proposes reverting it to `t2.small`.

If the manual change was intentional and should become the new desired
configuration, update the Terraform code to `t2.medium` instead of
allowing Terraform to revert it.
