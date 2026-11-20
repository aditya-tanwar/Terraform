# Terraform State vs Actual Infrastructure: Understanding Refresh

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

``` hcl
resource "aws_instance" "web" {
  instance_type = "t3.small"
}
```

The Terraform state file previously recorded:

``` json
{
  "address": "aws_instance.web",
  "id": "i-123456789",
  "instance_type": "t3.small"
}
```

But someone manually changes the EC2 instance type in the AWS Console:

``` text
Instance ID:   i-123456789
Instance type: t3.medium
```

Terraform now has three different views:

  Source                      Instance type
  --------------------------- ---------------
  Terraform configuration     `t3.small`
  Previous Terraform state    `t3.small`
  Actual AWS infrastructure   `t3.medium`

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

``` text
Terraform resource address: aws_instance.web
AWS resource ID:             i-123456789
Previously recorded type:    t3.small
```

### Step 2: Refresh through the provider

Terraform Core coordinates with the AWS provider to read the actual EC2
instance.

The provider calls AWS APIs and returns the current resource
information.

``` text
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

  Source               Value         What it represents
  -------------------- ------------- ------------------------------
  Configuration        `t3.small`    Desired infrastructure
  Previous state       `t3.small`    Last recorded information
  Refreshed AWS data   `t3.medium`   Actual remote infrastructure

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

``` bash
terraform plan -refresh-only
```

This previews state updates based on the actual remote infrastructure,
without proposing configuration-driven infrastructure changes.

To apply those state updates:

``` bash
terraform apply -refresh-only
```

Refresh-only mode is useful when you intentionally want Terraform's
recorded state to reflect changes made outside Terraform, rather than
reverting those changes to match the configuration.

## 5. Common questions

  Question                                                       Answer
  -------------------------------------------------------------- ------------------
  Does Terraform read the state file?                            Yes
  Does Terraform treat state as a live view of AWS?              No
  Who reads actual remote infrastructure?                        The provider
  Who calls AWS APIs?                                            The AWS provider
  Who coordinates comparison and planning?                       Terraform Core
  Does a normal `terraform plan` apply infrastructure changes?   No
  Does a successful apply persist resulting state?               Yes

## Final mental model

> State is Terraform's last recorded view of managed infrastructure, not
> a live connection to AWS.

Terraform reads state to understand which resources it manages and what
it previously knew about them. It then uses providers to refresh remote
information and compare that information with the desired configuration.

This is why provider refresh is important: without it, Terraform could
miss changes made manually outside Terraform.
