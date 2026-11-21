# Terraform Taint and Resource Replacement — Production Scenarios

## 1. What does “tainted” mean in Terraform?

A Terraform-managed resource instance is **tainted** when Terraform believes that the remote object may be damaged, incomplete, or not fully functional. A tainted instance is still present in the infrastructure and in Terraform state, but Terraform plans to destroy and recreate it.

Tainting is about Terraform's state and lifecycle decision. It is **not** the same as:
- Marking a cloud resource unhealthy in AWS, Azure, or GCP.
- Changing a resource's tags or metadata.
- Removing a resource from Terraform management.
- Recreating a resource immediately.

The actual replacement happens during a subsequent apply.

### Why does taint exist?

Terraform manages infrastructure through provider APIs. It can compare configured attributes with remote attributes, but it cannot always determine whether the software or workload running inside a resource is healthy.

For example, an EC2 instance can still exist and match its configured instance type, subnet, and security groups while its operating system or application is broken. If you have diagnosed the instance as unrecoverable, you may decide to replace that specific instance.

## 2. Important: `terraform taint` is deprecated

The manual `terraform taint` command is deprecated. For Terraform v0.15.2 and later, HashiCorp recommends using the `-replace` option with `terraform plan` or `terraform apply`.

Prefer:

```bash
terraform plan -replace="aws_instance.app"
terraform apply -replace="aws_instance.app"
```

The key benefit is that the replacement request appears in the plan before infrastructure is changed. With the old `terraform taint` workflow, the state was modified first; another operator could create a plan against that tainted state before the replacement impact had been reviewed.

Use the modern `-replace` workflow for new operational runbooks and CI/CD pipelines. Know the legacy commands because you may encounter them in older documentation or automation.

## 3. What happens during replacement?

Suppose the configuration contains:

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = "t3.large"
  subnet_id     = var.subnet_id

  tags = {
    Name = "production-app"
  }
}
```

The instance is running, but the application installation on it is corrupted. Terraform configuration has not changed, so a normal plan may show no changes.

Request a replacement:

```bash
terraform plan -replace="aws_instance.app"
```

Terraform plans a destroy-and-create action for that resource instance. The plan commonly shows the action as:

```text
-/+ resource "aws_instance" "app" {
      # ...
    }
```

The exact ordering depends on the resource lifecycle and provider behavior. By default, replacement commonly destroys the old object before creating the new one. Do not assume that replacement is zero-downtime.

Review the plan carefully, then apply:

```bash
terraform apply -replace="aws_instance.app"
```

The replacement uses the resource configuration already declared in Terraform. It does not mean “repair the existing instance in place.”

## 4. Resource addressing: replacing the correct instance

Use `terraform state list` to find the exact address recorded in the current state:

```bash
terraform state list
```

Examples:

| Resource shape | Example address |
|---|---|
| Single resource | `aws_instance.app` |
| Resource using `count` | `aws_instance.app[0]` |
| Resource using `for_each` | `aws_instance.app["blue"]` |
| Resource inside a module | `module.compute.aws_instance.app` |
| Nested module resource | `module.platform.module.compute.aws_instance.app` |

For a specific `count` instance:

```bash
terraform plan -replace='aws_instance.app[1]'
```

For a specific `for_each` instance, quote the key so the shell passes it as part of the Terraform address:

```bash
terraform plan -replace='aws_instance.app["blue"]'
```

For a resource inside a module:

```bash
terraform plan -replace='module.compute.aws_instance.app'
```

Be precise. Replacing the whole resource collection when only one instance is damaged can cause unnecessary production disruption.

## 5. Production scenarios

### Scenario 1 — Corrupted application on one EC2 instance

**Situation:** An application process is failing repeatedly because the host has a corrupted OS or an incomplete configuration. The instance is still reachable through the cloud API and Terraform sees no configuration drift.

**Recommended workflow:**

1. Confirm the affected instance through monitoring, incident records, and cloud inventory.
2. Identify its Terraform address with `terraform state list`.
3. Check whether the instance is part of an Auto Scaling Group, an instance fleet, or a standalone resource. Do not replace an ASG-managed instance independently through Terraform if the ASG is responsible for its lifecycle.
4. Generate and review a targeted replacement plan.

```bash
terraform plan -replace='aws_instance.app["worker-03"]' -out=replace-worker.tfplan
terraform show replace-worker.tfplan
terraform apply replace-worker.tfplan
```

**Production checks:**
- Confirm traffic is drained or the service has enough healthy capacity.
- Check whether the replacement receives a different private or public IP.
- Verify DNS, load balancer registration, monitoring, and configuration management.
- Confirm application health after replacement.

### Scenario 2 — A failed provisioner or incomplete bootstrap

**Situation:** A resource creation succeeds, but a provisioner step fails. Terraform may not be able to guarantee that the object is fully configured. Terraform can automatically mark the resource as tainted in state so a later plan replaces it.

Example of a provisioner:

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = "t3.large"

  provisioner "remote-exec" {
    inline = [
      "sudo /opt/bootstrap/install.sh"
    ]
  }
}
```

If the provisioner fails after the instance has been created, inspect the apply output and state before taking action. Do not assume that every provisioner failure means the instance was tainted; inspect the actual state and plan.

```bash
terraform state show aws_instance.app
terraform plan
```

If the instance is tainted or you have confirmed that it must be rebuilt, review the replacement plan. For new designs, prefer image baking, cloud-init, configuration management, or immutable deployment workflows over relying heavily on provisioners.

### Scenario 3 — One unhealthy node in a production fleet

**Situation:** One node is unhealthy, but the fleet has multiple nodes behind a load balancer.

**Recommended approach:**
- First check whether an Auto Scaling Group, Managed Instance Group, Kubernetes node group, or another controller already replaces unhealthy nodes automatically.
- Avoid having both the cloud controller and Terraform independently trying to replace the same instance.
- If Terraform directly manages the individual node and replacement is operationally appropriate, replace only its instance address.
- Ensure the fleet has sufficient spare capacity and that the load balancer health check has removed the unhealthy node from service.

A Terraform replacement is not a substitute for an autoscaling or self-healing mechanism.

### Scenario 4 — EKS worker node group or Kubernetes node

**Situation:** A worker node is unhealthy or a node group needs rebuilding.

**Important distinction:**
- If Terraform manages an EKS managed node group, replace the **node group resource** only when the node group itself must be recreated. This can affect many worker nodes.
- If one EC2 worker instance in an Auto Scaling Group is unhealthy, the node group's autoscaling mechanism should normally replace that instance.
- If a Kubernetes workload pod is unhealthy, Kubernetes controllers should normally recreate the pod. Terraform taint is generally the wrong tool for an individual pod managed by a Deployment or StatefulSet.

Before changing node group infrastructure, check PodDisruptionBudgets, workload replicas, capacity, cluster autoscaler behavior, and node draining strategy.

### Scenario 5 — Replacing a production database instance

**Situation:** A database host or database resource is degraded and a replacement is being considered.

**Do not blindly run `-replace` on a production database.**

First identify the exact resource type and its replacement semantics:
- Is it an RDS instance, an Aurora cluster, a database subnet group, or another resource?
- Will replacement cause data loss or endpoint changes?
- Is the database backed by snapshots, automated backups, or a tested restore process?
- Is there a replica or failover mechanism?
- Does the provider create a new database before destroying the old one, or is replacement destructive?

For a database, a safer operational recovery may be a provider-native failover, restore, or replica promotion rather than Terraform replacement. Coordinate with the database owner and follow the tested recovery runbook.

Only use `-replace` after confirming the data-protection and recovery implications in the plan and provider documentation.

### Scenario 6 — TLS certificate, launch template, or other dependent resources

**Situation:** A resource is replaced and other resources consume its ID, ARN, IP address, or other computed attributes.

Terraform's dependency graph may cause downstream resources to update or be replaced as a consequence. For example, replacing a launch template can cause an Auto Scaling Group or related deployment process to roll instances, depending on the configuration and provider behavior.

Before applying:
- Inspect every resource in the plan, not only the one named in `-replace`.
- Check whether a changed ID, ARN, endpoint, or IP will propagate.
- Confirm rollout and rollback procedures.
- Avoid assuming that a one-resource replacement will always produce a one-resource change.

## 6. Controlling downtime with `create_before_destroy`

Terraform normally destroys the old object before creating its replacement when the provider/resource lifecycle requires replacement. You can sometimes request the opposite ordering:

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = "t3.large"
  subnet_id     = var.subnet_id

  lifecycle {
    create_before_destroy = true
  }
}
```

With `create_before_destroy = true`, Terraform attempts to create the replacement before destroying the old object.

This can reduce downtime, but it is not a universal zero-downtime switch. Consider:
- Whether the cloud provider permits both objects to exist simultaneously.
- Whether names, IP addresses, ports, or other unique attributes conflict.
- Whether quotas and temporary capacity allow both objects to exist.
- Whether a load balancer, DNS record, or service discovery mechanism can safely shift traffic.
- Whether the application supports overlapping instances.

Validate the actual plan and resource documentation. A rolling deployment or blue/green design is often more appropriate for critical services.

## 7. Legacy commands: `terraform taint` and `terraform untaint`

### Legacy manual taint

`terraform taint` marks a resource instance as tainted in state. It does not immediately destroy or recreate the remote object.

```bash
terraform taint aws_instance.app
terraform plan
terraform apply
```

This command is deprecated. Prefer:

```bash
terraform plan -replace='aws_instance.app'
terraform apply -replace='aws_instance.app'
```

### Removing a taint marker

If Terraform has marked an object as tainted but investigation proves that it is healthy and should not be replaced, the legacy `terraform untaint` command removes the taint marker from state:

```bash
terraform untaint aws_instance.app
```

This changes Terraform state, not the real infrastructure. It should only be used after verifying that the object is actually healthy. If it is later found to be degraded, use `-replace` to request a replacement.

## 8. Production CI/CD workflow

A production pipeline should make the replacement visible and reviewable before applying it.

Example manual workflow:

```bash
# 1. Initialize the working directory
terraform init

# 2. Confirm the exact resource address
terraform state list

# 3. Create a replacement plan
terraform plan \
  -replace='aws_instance.app["worker-03"]' \
  -out=replace-worker.tfplan

# 4. Inspect the saved plan
terraform show replace-worker.tfplan

# 5. Apply the exact reviewed plan
terraform apply replace-worker.tfplan
```

**Pipeline guardrails:**
- Require an approved incident/change ticket for production replacement.
- Use the correct backend, workspace, account, subscription, or project.
- Use remote state locking; do not disable locking to make a pipeline pass.
- Save and review the plan artifact. Apply the exact saved plan that was approved.
- Restrict who can approve and execute production applies.
- Keep credentials short-lived and least-privileged.
- Record the resource address, reason, plan artifact, approval, and apply result.
- Run health checks after replacement and verify dependent systems.
- Define rollback or recovery steps before replacing stateful or critical resources.

If using Jenkins, GitHub Actions, or another CI system, pass the resource address as a validated input rather than accepting arbitrary shell text from an untrusted user. Prefer an allowlisted change request or reviewed pull request for production.

## 9. Common mistakes and safer alternatives

| Mistake | Why it is risky | Safer approach |
|---|---|---|
| Running `terraform taint` in a new workflow | Deprecated and modifies state before plan review | Use `terraform plan -replace` |
| Replacing an entire `count` or `for_each` collection | Can replace more instances than intended | Use the exact indexed/keyed address |
| Replacing an ASG-managed EC2 instance directly | Conflicts with the ASG lifecycle controller | Use ASG health replacement or a planned instance refresh |
| Replacing an EKS node group for one bad node | Can cause a broad worker-node disruption | Let the node group's autoscaling mechanism replace one node |
| Replacing a database without recovery checks | Can cause data loss or extended outage | Validate snapshots, replicas, failover, and restore procedures |
| Applying without reviewing the plan | Replacement can affect dependent resources | Review the complete plan and obtain approval |
| Using `-target` as a replacement mechanism | Targeting and replacement solve different problems | Use `-replace` for a deliberate resource replacement |
| Disabling state locking | Concurrent operations can corrupt or conflict with state | Keep backend locking enabled |

## 10. Taint vs replace vs destroy vs target

| Operation | Purpose | Changes remote infrastructure immediately? |
|---|---|---|
| `terraform taint ADDRESS` | Legacy command that marks an instance tainted in state | No |
| `terraform untaint ADDRESS` | Legacy command that removes the tainted marker from state | No |
| `terraform plan -replace=ADDRESS` | Plans replacement of a selected instance | No |
| `terraform apply -replace=ADDRESS` | Plans and applies replacement of a selected instance | Yes, after approval |
| `terraform destroy -target=ADDRESS` | Destroys a selected resource target; does not recreate it | Yes |
| `terraform plan -target=ADDRESS` | Produces a targeted plan, generally for exceptional recovery cases | No |

Use `-replace` when the desired outcome is to recreate an existing resource while keeping it managed by the same Terraform configuration.

## 11. Production checklist

Before replacing a resource:

- [ ] Confirm the exact resource address using `terraform state list`.
- [ ] Confirm the correct backend, workspace, and cloud account/project.
- [ ] Verify that the resource is managed directly by Terraform and not by another controller.
- [ ] Check whether the resource is stateful or has persistent data.
- [ ] Check dependent resources and computed attributes in the plan.
- [ ] Check capacity, health checks, traffic draining, and maintenance windows.
- [ ] Verify backups, snapshots, replicas, or restore procedures where relevant.
- [ ] Generate a plan with `-replace` and inspect the full output.
- [ ] Obtain the required production approval.
- [ ] Apply the exact reviewed plan.
- [ ] Verify service health and dependent integrations after replacement.
- [ ] Record the change and its outcome.

## 12. Key takeaways

1. A tainted resource is still present; the tainted marker tells Terraform that the instance should be replaced.
2. The legacy `terraform taint` command is deprecated.
3. Prefer `terraform plan -replace=ADDRESS` to preview a replacement before applying it.
4. Use exact resource addresses, especially with `count`, `for_each`, and modules.
5. Replacement can affect dependent resources and can cause downtime or data loss.
6. In production, check whether a cloud-native controller or application platform should perform the recovery instead.
7. Review, approve, apply, and verify every production replacement.

## Official references

- [Terraform taint command (deprecated)](https://developer.hashicorp.com/terraform/cli/commands/taint)
- [Terraform untaint command](https://developer.hashicorp.com/terraform/cli/commands/untaint)
- [Recreate resources overview](https://docs.hashicorp.com/terraform/cli/state/taint)
- [Terraform state CLI tutorial](https://developer.hashicorp.com/terraform/tutorials/state/state-cli)
- [Terraform resource block and lifecycle meta-arguments](https://developer.hashicorp.com/terraform/language/block/resource)
