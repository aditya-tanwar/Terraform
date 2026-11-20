# Terraform Refresh, Drift Detection, and Drift Correction

## 1. Starting Point: Everything Is in Sync

Suppose you have an EC2 instance managed by Terraform.

  Source                            EC2 instance type
  --------------------------------- -------------------
  Terraform configuration (`.tf`)   `t2.small`
  Terraform state (`tfstate`)       `t2.small`
  Actual EC2 instance in AWS        `t2.small`

Terraform configuration describes the desired infrastructure. The state
file records Terraform's last-known mapping and attributes for managed
resources. AWS contains the real infrastructure.

## 2. Someone Manually Changes the EC2 Instance

Someone changes the instance type directly in AWS from `t2.small` to
`t2.medium`, outside Terraform.

  Source                             EC2 instance type
  ---------------------------------- -------------------
  Terraform configuration            `t2.small`
  Terraform state (before refresh)   `t2.small`
  Actual EC2 instance in AWS         `t2.medium`

This difference is an example of **configuration drift**.

## 3. What Happens During Refresh?

A normal `terraform plan` refreshes managed resources by default. You
can also explicitly request it:

``` bash
terraform plan -refresh=true
```

Terraform Core asks the AWS provider to read the current EC2 instance
details from AWS. The provider calls AWS APIs and reports the observed
attributes.

Terraform discovers that the actual instance type is `t2.medium`.

  Source                       EC2 instance type
  ---------------------------- -------------------
  Terraform configuration      `t2.small`
  Refreshed state view         `t2.medium`
  Actual EC2 instance in AWS   `t2.medium`

**Important:** Refresh reads the remote object and updates Terraform's
state view. It does not itself change the EC2 instance in AWS.

## 4. What Happens During Planning?

Terraform compares the desired configuration with the refreshed
information:

-   Desired configuration: `t2.small`
-   Observed remote value: `t2.medium`

Terraform proposes changing the instance type back to `t2.small`.

Conceptually, the plan may show:

``` hcl
~ resource "aws_instance" "app" {
    instance_type = "t2.medium" -> "t2.small"
}
```

The `~` indicates an in-place update in the plan. The exact action
depends on the provider's resource schema and the attribute being
changed.

## 5. What Happens During Apply?

Run:

``` bash
terraform apply
```

Terraform performs the normal planning/refresh process, presents the
proposed changes, and asks for approval unless automatic approval is
enabled.

After approval, Terraform asks the AWS provider to perform the update.
If it succeeds, Terraform records the resulting resource information in
state.

The intended final result is:

  Source                       EC2 instance type
  ---------------------------- -------------------
  Terraform configuration      `t2.small`
  Terraform state              `t2.small`
  Actual EC2 instance in AWS   `t2.small`

You can also use:

``` bash
terraform apply -auto-approve
```

This skips the interactive approval prompt. Use it only when your
automation and review controls make that appropriate.

## 6. Detect Drift Without Correcting the Infrastructure

To inspect proposed changes without applying them:

``` bash
terraform plan
```

Terraform refreshes by default and shows the proposed changes. It does
not apply them.

To preview how Terraform state would be updated to reflect the real
infrastructure, use:

``` bash
terraform plan -refresh-only
```

This plans state updates based on remote objects. It does not propose
changing remote infrastructure to match the configuration.

To persist the refreshed state information:

``` bash
terraform apply -refresh-only
```

After this operation, the state can record `t2.medium`, while the
configuration still declares `t2.small`. A later normal plan will
propose reconciling AWS back to `t2.small`.

## 7. The Three Operations to Remember

  -----------------------------------------------------------------------
  Operation                           What it does
  ----------------------------------- -----------------------------------
  Refresh                             Reads remote infrastructure and
                                      updates Terraform's view/state
                                      information

  Plan                                Compares desired configuration with
                                      refreshed infrastructure
                                      information and calculates proposed
                                      actions

  Apply                               Executes the approved actions and
                                      updates state after successful
                                      operations
  -----------------------------------------------------------------------

A useful mental model:

``` text
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

``` bash
terraform plan -refresh=true
```

Not:

``` bash
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
