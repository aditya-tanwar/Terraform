# Terraform Resource Import Example

This directory demonstrates configuration-driven import using a Terraform `import` block.

## What the configuration does

The current [`import.tf`](./import.tf) maps an existing EC2 instance ID to the Terraform resource address `aws_instance.myec2`:

```hcl
import {
  to = aws_instance.myec2
  id = "i-02d67b40b0c3ff75f6"
}
```

The ID shown above is the value currently present in this repository. Replace it with the ID of the EC2 instance you intend to import.

## Declare the matching resource

An import block identifies the remote object and the Terraform address that should manage it. The configuration must also declare the matching resource:

```hcl
resource "aws_instance" "myec2" {
  # Add configuration that matches the existing instance.
}
```

Inspect the existing instance and configure its arguments before applying. Do not apply an incomplete resource configuration blindly: the resulting plan may propose changes to the imported instance.

## Import workflow

1. Configure the AWS provider for the correct account and region.
2. Verify that the instance ID belongs to the intended environment.
3. Declare `aws_instance.myec2` with configuration matching the existing instance.
4. Set `import.id` to the correct instance ID.
5. Initialize and validate:

   ```bash
   terraform init
   terraform validate
   ```

6. Review the plan:

   ```bash
   terraform plan
   ```

7. Apply only after confirming that the plan imports the intended instance and contains no unexpected updates or replacement:

   ```bash
   terraform apply
   ```

8. Verify that Terraform tracks the instance:

   ```bash
   terraform state show aws_instance.myec2
   ```

After a successful import, keep the resource configuration under version control. You can remove the import block after the import has completed and it is no longer needed for repeatable onboarding.

## Safety checklist

- [ ] Correct AWS account and region selected
- [ ] Instance ID verified
- [ ] Matching Terraform resource block declared
- [ ] Plan reviewed for unexpected updates or replacement
- [ ] Normal state backup and locking practices followed
