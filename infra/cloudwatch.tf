resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = 7
  kms_key_id        = aws_kms_key.logs.arn
}

resource "aws_cloudwatch_log_group" "validation_worker" {
  name              = "/aws/lambda/${local.name}-validation-worker"
  retention_in_days = 7
  kms_key_id        = aws_kms_key.logs.arn
}

resource "aws_cloudwatch_log_group" "audit_worker" {
  name              = "/aws/lambda/${local.name}-audit-worker"
  retention_in_days = 7
  kms_key_id        = aws_kms_key.logs.arn
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${local.name}-http"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.logs.arn
}
