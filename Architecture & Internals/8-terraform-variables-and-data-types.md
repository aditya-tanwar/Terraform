# Terraform Variables and Data Types

## Contents

- [Part 1: Variable declarations](#part-1-variable-declarations)
- [Part 2: Terraform data types](#part-2-terraform-data-types)
- [Part 3: Summary tables](#part-3-summary-tables)
- [Part 4: What matters most for senior DevOps interviews?](#part-4-what-matters-most-for-senior-devops-interviews)
- [Final mental model](#final-mental-model)

---

Terraform concepts described as "types of variables" can refer to two
things:

1.  **Variable declarations:** input variables, local values, and output
    values.
2.  **Data types:** string, number, bool, list, set, map, object, tuple,
    and any.

## Part 1: Variable declarations

### 1. Input variables (`variable`)

Input variables make a module configurable. Think of them as function
parameters.

```hcl
variable "instance_type" {
  type    = string
  default = "t3.micro"
}
```

Use one in a resource:

```hcl
resource "aws_instance" "web" {
  instance_type = var.instance_type
}
```

Reference it with `var.instance_type`.

### 2. Local values (`locals`)

Locals store computed or reusable expressions and help avoid repetition.

```hcl
locals {
  bucket_name = "${var.project}-${var.environment}"
}
```

Use and reference the value:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = local.bucket_name
}
```

Reference locals with `local.bucket_name`. Think of them as variables
inside a function.

### 3. Output values (`output`)

Outputs expose selected values from a module. They are useful when one
module needs to provide information to another.

```hcl
output "vpc_id" {
  value = aws_vpc.main.id
}
```

After applying, inspect outputs:

```bash
terraform output
```

Example:

```text
vpc_id = "vpc-123456"
```

### 4. Environment variables (`TF_VAR_*`)

Operating system environment variables can provide values for Terraform
input variables.

```bash
export TF_VAR_region=us-east-1
```

Terraform maps this to the input variable named `region`:

```hcl
variable "region" {
  type = string
}
```

Reference it in configuration using `var.region`.

### 5. Data sources (`data`) --- not variables

Data sources read information about existing infrastructure or external
data. They do not declare input variables and do not manage the
lifecycle of the objects they read.

```hcl
data "aws_ami" "ubuntu" {
  most_recent = true

  # Add suitable filters and an owner
  # to identify the AMI you want.
}
```

Use the returned AMI ID:

```hcl
ami = data.aws_ami.ubuntu.id
```

**Remember:** a variable supplies a value; a data source retrieves
information from an external source.

------------------------------------------------------------------------

## Part 2: Terraform data types

Input variables can have type constraints that describe the kind of
value they accept.

### 1. String

A string represents text.

```hcl
variable "name" {
  type = string
}
```

Example: `name = "production"`

### 2. Number

A number can be an integer or a floating-point value.

```hcl
variable "cpu" {
  type = number
}
```

Example: `cpu = 4` or `cpu = 3.14`

### 3. Boolean (`bool`)

A boolean represents either `true` or `false`.

```hcl
variable "public" {
  type = bool
}
```

Example: `public = true`

### 4. List

A list is an ordered collection of values of the same element type.

```hcl
variable "subnets" {
  type = list(string)
}
```

Example:

```hcl
subnets = [
  "subnet-1",
  "subnet-2"
]
```

Access an element using its zero-based index: `var.subnets[0]`.

### 5. Set

A set is a collection of unique values. Unlike a list, it does not
provide stable positional ordering.

```hcl
variable "regions" {
  type = set(string)
}
```

Example:

```hcl
regions = [
  "us-east-1",
  "us-west-2"
]
```

Duplicate values are discarded when converted to a set. For example:

```hcl
toset(["us-east-1", "us-west-2", "us-east-1"])
```

### 6. Map

A map is a collection of key-value pairs. In `map(string)`, each value
must be a string.

```hcl
variable "tags" {
  type = map(string)
}
```

Example:

```hcl
tags = {
  Environment = "prod"
  Owner       = "DevOps"
}
```

Access a value by key: `var.tags["Environment"]`.

### 7. Object

An object is a structured value with named attributes. Each attribute
has its own declared type.

```hcl
variable "server" {
  type = object({
    cpu    = number
    memory = number
    os     = string
  })
}
```

Example:

```hcl
server = {
  cpu    = 4
  memory = 16
  os     = "linux"
}
```

Access an attribute with dot notation: `var.server.cpu`.

Objects are especially useful for reusable modules that accept
structured configuration.

### 8. Tuple

A tuple is an ordered collection in which each position can have a
different type.

```hcl
variable "config" {
  type = tuple([
    string,
    number,
    bool
  ])
}
```

Example:

```hcl
config = [
  "prod",
  4,
  true
]
```

The first element must be a string, the second a number, and the third a
boolean.

### 9. Any

`any` is a special type constraint that lets Terraform infer a suitable
type for the supplied value.

```hcl
variable "value" {
  type = any
}
```

Use it sparingly. More specific type constraints make module inputs
easier to validate and understand.

------------------------------------------------------------------------

## Part 3: Summary tables

### Variable declarations and related constructs

  ----------------------------------------------------------------------------------
  Construct               Purpose                 How to reference or use it
  ----------------------- ----------------------- ----------------------------------
  Input variable          Accept input for a      `var.name`
  (`variable`)            module

  Local value (`locals`)  Store computed or       `local.name`
                          reusable values

  Output value (`output`) Expose a value from a   `terraform output`; callers use
                          module                  `module.<name>.<output>`

  Environment variable    Supply an input         Becomes the corresponding
  (`TF_VAR_*`)            variable through the    `var.name`
                          environment

  Data source (`data`)    Read existing           `data.<type>.<name>.<attribute>`
                          infrastructure or
                          external information
  ----------------------------------------------------------------------------------

### Data types

  Data type         Example
  ----------------- ----------------------------------------------------
  `string`          `"prod"`
  `number`          `4`, `3.14`
  `bool`            `true`
  `list(string)`    `["a", "b"]`
  `set(string)`     `toset(["a", "b"])`
  `map(string)`     `{ key = "value" }`
  `object({...})`   `{ cpu = 4, os = "linux" }`
  `tuple([...])`    `["prod", 4, true]`
  `any`             Any value accepted by the inferred type constraint

------------------------------------------------------------------------

## Part 4: What matters most for senior DevOps interviews?

Focus especially on:

-   **Input variables (`variable`)** --- configure reusable modules.
-   **Local values (`locals`)** --- define computed and reusable
    expressions.
-   **Output values (`output`)** --- expose values from modules, such as
    VPC or subnet IDs.
-   **Data sources (`data`)** --- read information about existing
    infrastructure.
-   **Primitive types** --- `string`, `number`, and `bool`.
-   **Collection and structural types** --- `list`, `set`, `map`,
    `object`, and `tuple`.

In reusable Terraform modules, `object` and `map` are especially useful
for accepting structured configuration, such as server settings, tags,
subnet definitions, and environment-specific values.

## Final mental model

-   **Input variable:** A value provided to your module.
-   **Local value:** A value calculated or reused inside your module.
-   **Output value:** A value your module exposes.
-   **Data source:** Information Terraform reads from somewhere else.
-   **Data type:** The shape and kind of value a variable accepts.
