resource "null_resource" "lambda_package" {
  triggers = {
    pyproject = filesha256("${local.backend_dir}/pyproject.toml")
    source    = sha256(join("", [for file in fileset("${local.backend_dir}/src", "**/*.py") : filesha256("${local.backend_dir}/src/${file}")]))
    packager  = filesha256(local.packager)
    command   = "cross-platform-working-dir-v2"
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/.."
    command     = "${var.python_executable} scripts/package_lambda.py --source backend/src/tariffguard --project backend --target infra/.terraform-build/${local.name} --install-runtime"
  }
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = local.build_dir
  output_path = local.package_zip

  depends_on = [null_resource.lambda_package]
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  role             = aws_iam_role.lambda.arn
  handler          = "tariffguard.handlers.api.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = merge(local.common_environment, {
      SQS_QUEUE_URL = aws_sqs_queue.validation.url
      USER_POOL_ID  = aws_cognito_user_pool.operators.id
    })
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

resource "aws_lambda_function" "validation_worker" {
  function_name    = "${local.name}-validation-worker"
  role             = aws_iam_role.lambda.arn
  handler          = "tariffguard.handlers.validation_worker.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = local.common_environment
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.validation_worker]
}

resource "aws_lambda_function" "audit_worker" {
  function_name    = "${local.name}-audit-worker"
  role             = aws_iam_role.lambda.arn
  handler          = "tariffguard.handlers.audit_worker.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = local.common_environment
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.audit_worker]
}

resource "aws_lambda_event_source_mapping" "validation_worker" {
  event_source_arn        = aws_sqs_queue.validation.arn
  function_name           = aws_lambda_function.validation_worker.arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}
