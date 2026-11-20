# Terraform Create, Destroy, and Replacement Ordering

## 1. The Core Idea

Terraform does not simply execute resources in the order they appear in
a `.tf` file. It builds a dependency graph and uses that graph to
determine which operations must happen before others.

The graph allows Terraform to: - Create dependencies before the
resources that rely on them. - Destroy dependent resources before the
resources they rely on. - Run independent operations in parallel,
subject to the parallelism limit. - Order replacement operations safely
according to lifecycle rules and dependency constraints.

## 2. Creation Ordering

Consider an AWS environment with this dependency chain:

``` text
VPC -> Subnet -> EC2 Instance
```

The EC2 instance needs a subnet, and the subnet needs a VPC. Terraform
therefore creates them in this order:

1.  VPC
2.  Subnet
3.  EC2 instance

Example:

``` hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "app" {
  ami           = "ami-0123456789abcdef0"
  instance_type = "t3.medium"
  subnet_id     = aws_subnet.app.id
}
```

References such as `aws_vpc.main.id` and `aws_subnet.app.id` create
implicit dependencies. Terraform can infer the required order from those
references.

``` text
Create VPC
   |
   v
Create Subnet
   |
   v
Create EC2
```

The order of resource blocks in the file does not determine this
sequence.

## 3. Destroy Ordering

Destroy ordering is the reverse of creation ordering.

For the same dependency chain:

``` text
VPC -> Subnet -> EC2
```

Terraform destroys:

1.  EC2 instance
2.  Subnet
3.  VPC

Why? The EC2 instance depends on the subnet, and the subnet depends on
the VPC. Terraform must remove the dependent objects before removing the
infrastructure they rely on.

``` text
Destroy EC2
    |
    v
Destroy Subnet
    |
    v
Destroy VPC
```

This prevents Terraform from trying to delete a VPC while resources that
depend on it still exist.

## 4. Parallel Execution

Not every resource needs to wait for every other resource.

For example, if an EC2 instance and an S3 bucket have no dependency
relationship, Terraform may create them concurrently:

``` text
             +--> Create EC2
Start --------|
             +--> Create S3 bucket
```

Terraform's default parallelism limit is 10 operations. You can change
it with:

``` bash
terraform apply -parallelism=5
```

Parallelism is constrained by dependencies: Terraform can run
independent graph operations together, but it cannot violate required
ordering.

## 5. How Terraform Decides Whether Replacement Is Required

When a resource already exists, Terraform compares: - The desired
configuration. - The current information refreshed from the remote
provider/API (when refresh is enabled). - The previous state recorded in
Terraform state.

The provider schema identifies which changed attributes can be updated
in place and which require replacement. If a change requires
replacement, Terraform plans a destroy-and-create operation rather than
an in-place update.

For example, changing an EC2 instance's `instance_type` is commonly an
in-place update, while changing its `subnet_id` generally requires
replacement. Exact behavior depends on the provider and resource schema
version.

## 6. Default Replacement: Destroy Before Create

By default, Terraform generally destroys the old object before creating
its replacement when replacement is required.

A plan may show:

``` text
-/+ resource "aws_instance" "app" {
      # forces replacement
  }
```

The symbol `-/+` means: 1. Destroy the existing object. 2. Create the
replacement object.

Conceptually:

``` text
Destroy old EC2
      |
      v
Create new EC2
```

This can cause downtime because the old instance is removed before the
new one is ready.

## 7. Create Before Destroy

You can change the replacement order with the `create_before_destroy`
lifecycle rule:

``` hcl
resource "aws_instance" "app" {
  ami           = "ami-0123456789abcdef0"
  instance_type = "t3.medium"
  subnet_id     = aws_subnet.app.id

  lifecycle {
    create_before_destroy = true
  }
}
```

When replacement is required, Terraform attempts to:

1.  Create the new object.
2.  Destroy the old object after the new one has been created.

A plan may show:

``` text
+/- resource "aws_instance" "app" {
      # forces replacement
  }
```

Conceptually:

``` text
Create new EC2
      |
      v
Destroy old EC2
```

This can reduce downtime, but it does not guarantee zero downtime.

### Important limitations

-   The platform must allow both old and new objects to exist
    simultaneously.
-   Unique names, fixed IP addresses, quotas, or other constraints may
    prevent the new object from being created first.
-   Creating a new EC2 instance does not automatically move application
    traffic to it.
-   For a robust low-downtime rollout, use mechanisms such as load
    balancer target registration, health checks, and controlled traffic
    switching.

## 8. Replacement Ordering and Dependencies

Terraform represents operations and their dependencies in its execution
graph. A replacement is not just an isolated "delete then create"
instruction; Terraform must also respect dependencies between the
resource and other objects.

With `create_before_destroy`, the new object is created before the old
one is removed, while Terraform continues to honor the dependency
constraints in the graph.

The `create_before_destroy` behavior can propagate to dependencies in
order to preserve valid ordering. Terraform records this behavior in
state, so it can affect later operations too.

## 9. Explicit Dependencies with `depends_on`

Terraform normally infers dependencies from references. If an ordering
requirement exists that Terraform cannot infer from an argument
reference, use `depends_on`.

Example:

``` hcl
resource "aws_instance" "app" {
  ami           = "ami-0123456789abcdef0"
  instance_type = "t3.medium"
  subnet_id     = aws_subnet.app.id

  depends_on = [
    aws_iam_role_policy_attachment.app
  ]
}
```

This tells Terraform that the instance operation must wait for the
policy attachment operation.

Dependencies also affect destroy ordering: Terraform reverses the
relationship when planning destruction, so the dependent object is
destroyed before the object it depends on.

Use `depends_on` only when necessary. Prefer direct references because
they express the dependency more precisely.

## 10. Practical CI/CD Example

A Jenkins pipeline might run:

``` bash
terraform init
terraform validate
terraform plan -out=tfplan
```

After review and approval:

``` bash
terraform apply tfplan
```

Terraform uses the dependency graph in the saved plan to order the
operations. The pipeline should review replacement actions carefully,
especially when a replacement may cause downtime or affect shared
infrastructure.

## 11. Quick Reference

  -----------------------------------------------------------------------
  Situation                           Terraform behavior
  ----------------------------------- -----------------------------------
  Create dependent resources          Dependencies are created first

  Destroy dependent resources         Dependents are destroyed first

  Independent operations              May run in parallel

  Replacement by default              Destroy old, then create new
                                      (`-/+`)

  Replacement with                    Create new, then destroy old
  `create_before_destroy`             (`+/-`)

  Explicit hidden ordering            Use `depends_on` when a reference
  requirement                         cannot express it
  -----------------------------------------------------------------------

## 12. Key Takeaway

Terraform builds and walks a dependency graph. The graph controls
creation order, reverse destruction order, and which operations can run
in parallel. When a resource must be replaced, Terraform follows the
replacement strategy selected by the resource/provider behavior and
lifecycle configuration.

`create_before_destroy` can reduce downtime, but it is not a complete
zero-downtime deployment strategy. Application traffic management and
infrastructure constraints still matter.
